import { Types } from 'mongoose';
import { Settings, Job, Budget, AlertState } from '../models/index.js';
import { addDays, diffDays, monthEnd, monthStart } from '../utils/dates.js';
import { dashboard } from './finance.js';

export interface Alert {
  id: string;
  type: 'bill' | 'invoice' | 'job' | 'budget' | 'income' | 'savings' | 'task';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  date?: string;
  link?: string;
}

/** Computes in-app notifications from current data and the user's notification settings. */
export async function computeAlerts(userId: string, today: string, currency: string): Promise<Alert[]> {
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(n);
  const settings = await Settings.findOne({ userId }).lean();
  const n = settings?.notifications ?? ({} as Record<string, unknown>);
  const d = await dashboard(userId, { from: monthStart(today), to: monthEnd(today), today });
  const out: Alert[] = [];
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const clock = (t?: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

  if (n.billReminders !== false) {
    const days = Number(n.billReminderDays ?? 3);
    for (const b of d.bills.upcoming.filter((b) => b.dueDate <= addDays(today, days))) {
      const inDays = diffDays(today, b.dueDate);
      out.push({ id: `bill-${b.billId}-${b.dueDate}`, type: 'bill', severity: inDays <= 1 ? 'warning' : 'info', title: `${b.name} due ${inDays === 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`, message: `${money(b.amount)} · ${day(b.dueDate)}`, date: b.dueDate, link: '/bills' });
    }
  }
  if (n.invoiceReminders !== false) {
    for (const inv of d.invoices.dueSoon) {
      const overdue = inv.effectiveStatus === 'overdue';
      out.push({ id: `inv-${inv.id}`, type: 'invoice', severity: overdue ? 'error' : 'info', title: overdue ? `Invoice ${inv.number} is overdue` : `Invoice ${inv.number} due ${day(inv.dueDate)}`, message: `${inv.clientName} · ${money(inv.total)}`, date: inv.dueDate, link: `/invoices/${inv.id}` });
    }
    if (d.invoices.overdueCount > d.invoices.dueSoon.filter((i) => i.effectiveStatus === 'overdue').length) {
      out.push({ id: 'inv-overdue-total', type: 'invoice', severity: 'error', title: `${d.invoices.overdueCount} overdue invoices`, message: `${money(d.invoices.overdueAmount)} outstanding`, link: '/invoices?status=overdue' });
    }
  }
  if (n.jobReminders !== false) {
    const tomorrow = addDays(today, 1);
    const jobs = await Job.find({ userId: new Types.ObjectId(userId), date: { $in: [today, tomorrow] }, status: 'scheduled' }).sort({ date: 1, startTime: 1 }).lean();
    for (const j of jobs) {
      out.push({ id: `job-${j._id}`, type: 'job', severity: 'info', title: `${j.date === today ? 'Today' : 'Tomorrow'} ${clock(j.startTime)} · ${j.clientName ?? j.title ?? 'Job'}`, message: j.address?.formatted ?? '', date: j.date, link: '/my-day' });
    }
    if (d.work.pastUncompleted) out.push({ id: 'job-uncompleted', type: 'job', severity: 'warning', title: `${d.work.pastUncompleted} past job(s) not marked completed`, message: 'Mark them completed or cancelled so income stats stay accurate.', link: '/jobs' });
  }
  if (n.budgetAlerts !== false) {
    for (const cb of d.budget.categoryBudgets) {
      if (cb.budget > 0 && cb.spent >= cb.budget) out.push({ id: `budget-${cb.categoryId}`, type: 'budget', severity: 'warning', title: `${cb.name} budget exceeded`, message: `${money(cb.spent)} of ${money(cb.budget)}`, link: '/budgets' });
      else if (cb.budget > 0 && cb.spent >= cb.budget * 0.85) out.push({ id: `budget-${cb.categoryId}`, type: 'budget', severity: 'info', title: `${cb.name} budget at ${Math.round((cb.spent / cb.budget) * 100)}%`, message: `${money(cb.spent)} of ${money(cb.budget)}`, link: '/budgets' });
    }
    if (d.budget.spendingLimit > 0 && d.month.expenses > d.budget.spendingLimit) out.push({ id: 'spending-limit', type: 'budget', severity: 'warning', title: 'Monthly spending limit exceeded', message: `${money(d.month.expenses)} of ${money(d.budget.spendingLimit)}`, link: '/budgets' });
    if (d.required.minimumMonthlyIncome > 0 && d.month.incomeIncludingExpected < d.required.minimumMonthlyIncome) {
      out.push({ id: 'income-below-required', type: 'income', severity: 'warning', title: 'Expected income is below required income', message: `${money(d.month.incomeIncludingExpected)} of ${money(d.required.minimumMonthlyIncome)} needed this month`, link: '/budgets' });
    }
    const budget = await Budget.findOne({ userId }).lean();
    const dayOfMonth = Number(today.slice(8)), daysInMonth = Number(monthEnd(today).slice(8));
    if (budget?.monthlySavingsTarget && dayOfMonth > 7) {
      const expectedByNow = (budget.monthlySavingsTarget * dayOfMonth) / daysInMonth;
      if (d.month.savingsThisMonth < expectedByNow * 0.8) out.push({ id: 'savings-behind', type: 'savings', severity: 'info', title: 'Savings behind target pace', message: `Net this month ${money(d.month.savingsThisMonth)} vs ${money(budget.monthlySavingsTarget)} target`, link: '/budgets' });
    }
  }
  if (n.taskReminders !== false) {
    const high = d.today.tasks.filter((t) => t.priority === 'high' && t.status !== 'completed' && t.status !== 'cancelled');
    for (const t of high) out.push({ id: `task-${t.id}`, type: 'task', severity: 'info', title: `Important: ${t.title}`, message: t.startTime ? `Today at ${clock(t.startTime)}` : 'Today', link: '/my-day' });
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Stable identity of one notification "stage" (e.g. "due tomorrow" and "due today" are separate). */
export function alertKey(a: Alert, today: string) {
  return ['budget', 'income', 'savings'].includes(a.type) ? `${a.id}|${today.slice(0, 7)}` : `${a.id}|${a.title}`;
}

export interface InboxAlert extends Alert { key: string; read: boolean; firstSeenAt: string }

/** Current notifications with read state. Dismissed ones are left out; new ones are remembered so "new" is the same on every device. */
export async function alertInbox(userId: string, today: string, currency: string): Promise<{ items: InboxAlert[]; unread: number }> {
  const alerts = await computeAlerts(userId, today, currency);
  const keys = alerts.map((a) => alertKey(a, today));
  const uid = new Types.ObjectId(userId);
  const states = await AlertState.find({ userId: uid, key: { $in: keys } }).lean();
  const byKey = new Map(states.map((s) => [s.key, s]));
  const missing = [...new Set(keys.filter((k) => !byKey.has(k)))];
  const now = new Date();
  if (missing.length) {
    await AlertState.bulkWrite(missing.map((key) => ({ updateOne: { filter: { userId: uid, key }, update: { $setOnInsert: { firstSeenAt: now, createdAt: now } }, upsert: true } })), { ordered: false });
  }
  const items: InboxAlert[] = [];
  alerts.forEach((a, i) => {
    const st = byKey.get(keys[i]);
    if (st?.dismissedAt) return;
    items.push({ ...a, key: keys[i], read: !!st?.readAt, firstSeenAt: (st?.firstSeenAt ?? now).toISOString() });
  });
  return { items, unread: items.filter((a) => !a.read).length };
}

export async function markAlerts(userId: string, action: 'read' | 'unread' | 'dismiss', keys: string[]) {
  if (!keys.length) return;
  const now = new Date();
  const update: Record<string, unknown> = action === 'read' ? { $set: { readAt: now } } : action === 'unread' ? { $unset: { readAt: 1 } } : { $set: { dismissedAt: now, readAt: now } };
  const uid = new Types.ObjectId(userId);
  await AlertState.bulkWrite(keys.map((key) => ({ updateOne: { filter: { userId: uid, key }, update: { ...update, $setOnInsert: { firstSeenAt: now, createdAt: now } }, upsert: true } })) as never, { ordered: false });
}
