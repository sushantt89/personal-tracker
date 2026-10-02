import { Types } from 'mongoose';
import { Expense, Category, Budget } from '../models/index.js';
import { addMonths, monthEnd, monthStart } from '../utils/dates.js';
import { round2 } from '../utils/money.js';
import { dashboard } from './finance.js';

export interface Insight {
  id: string;
  kind: 'income' | 'expense' | 'bills' | 'work' | 'budget' | 'savings';
  tone: 'neutral' | 'positive' | 'attention';
  text: string;
  value?: number;
}

/** Factual summaries only — no recommendations or decisions. */
export async function insights(userId: string, today: string, currency: string): Promise<Insight[]> {
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(n);
  const from = monthStart(today), to = monthEnd(today);
  const d = await dashboard(userId, { from, to, today });
  const out: Insight[] = [];

  out.push({ id: 'avg-income', kind: 'income', tone: 'neutral', text: `Your average monthly income (received) is ${money(d.money.avgMonthlyIncome)}.`, value: d.money.avgMonthlyIncome });
  out.push({ id: 'avg-expenses', kind: 'expense', tone: 'neutral', text: `Your average monthly expenses are ${money(d.money.avgMonthlyExpenses)}.`, value: d.money.avgMonthlyExpenses });
  out.push({ id: 'month-income', kind: 'income', tone: 'neutral', text: `So far this month you have received ${money(d.month.incomeReceived)}, with ${money(d.month.incomeIncludingExpected - d.month.incomeReceived)} more expected.` });

  if (d.charts.expenseByCategory.length) {
    const top = d.charts.expenseByCategory[0];
    out.push({ id: 'top-category', kind: 'expense', tone: 'neutral', text: `Your largest expense category this month is ${top.name} (${money(top.value)}).`, value: top.value });
  }

  // Category month-over-month changes
  const uid = new Types.ObjectId(userId);
  const prevFrom = addMonths(from, -1), prevToSameDay = addMonths(today, -1);
  const [cur, prev, cats] = await Promise.all([
    Expense.find({ userId: uid, date: { $gte: from, $lte: today } }).select('amount categoryId').lean(),
    Expense.find({ userId: uid, date: { $gte: prevFrom, $lte: prevToSameDay } }).select('amount categoryId').lean(),
    Category.find({ userId: uid }).select('name').lean(),
  ]);
  const byCat = (xs: typeof cur) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(String(x.categoryId), round2((m.get(String(x.categoryId)) ?? 0) + x.amount));
    return m;
  };
  const c = byCat(cur), p = byCat(prev);
  const changes = cats
    .map((cat) => ({ name: cat.name, diff: round2((c.get(String(cat._id)) ?? 0) - (p.get(String(cat._id)) ?? 0)) }))
    .filter((x) => Math.abs(x.diff) >= 20)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);
  for (const ch of changes) {
    out.push({
      id: `mom-${ch.name}`,
      kind: 'expense',
      tone: ch.diff > 0 ? 'attention' : 'positive',
      text: `You spent ${money(Math.abs(ch.diff))} ${ch.diff > 0 ? 'more' : 'less'} on ${ch.name} this month than at the same point last month.`,
      value: ch.diff,
    });
  }

  const upcoming = d.bills.upcomingTotal;
  out.push({ id: 'upcoming-bills', kind: 'bills', tone: upcoming > 0 ? 'attention' : 'neutral', text: `You have ${money(upcoming)} in recurring bills due in the next 30 days (${d.bills.upcoming.length} bill${d.bills.upcoming.length === 1 ? '' : 's'}).`, value: upcoming });
  out.push({ id: 'required', kind: 'bills', tone: 'neutral', text: `Your minimum monthly income required (bills ${money(d.required.monthlyBills)} + expected variable spending ${money(d.required.expectedVariableExpenses)} + savings ${money(d.required.savingsTarget)}) is ${money(d.required.minimumMonthlyIncome)}.`, value: d.required.minimumMonthlyIncome });
  if (d.required.minimumMonthlyIncome > 0) {
    out.push(
      d.month.shortfall > 0
        ? { id: 'shortfall', kind: 'income', tone: 'attention', text: `You need approximately ${money(d.month.shortfall)} additional income this month to reach your minimum required income (counting expected income).`, value: d.month.shortfall }
        : { id: 'shortfall', kind: 'income', tone: 'positive', text: `Received and expected income this month covers your minimum required income.` },
    );
  }
  const budget = await Budget.findOne({ userId: uid }).lean();
  if (budget?.monthlyIncomeTarget) {
    const gap = round2(budget.monthlyIncomeTarget - d.month.incomeIncludingExpected);
    out.push({ id: 'target', kind: 'income', tone: gap > 0 ? 'attention' : 'positive', text: gap > 0 ? `You are ${money(gap)} short of your monthly income target of ${money(budget.monthlyIncomeTarget)}.` : `You have reached your monthly income target of ${money(budget.monthlyIncomeTarget)}.`, value: gap });
  }

  out.push({ id: 'jobs-month', kind: 'work', tone: 'neutral', text: `You completed ${d.work.jobsThisMonth} job${d.work.jobsThisMonth === 1 ? '' : 's'} this month.`, value: d.work.jobsThisMonth });
  if (d.work.jobsInRange) {
    out.push({ id: 'per-job', kind: 'work', tone: 'neutral', text: `Your average income per job this month is ${money(d.work.avgPerJob)}.`, value: d.work.avgPerJob });
    if (d.work.avgPerHour) out.push({ id: 'per-hour', kind: 'work', tone: 'neutral', text: `Your average income per hour worked on jobs this month is ${money(d.work.avgPerHour)}.`, value: d.work.avgPerHour });
  }
  if (d.work.pastUncompleted) out.push({ id: 'uncompleted', kind: 'work', tone: 'attention', text: `${d.work.pastUncompleted} past job${d.work.pastUncompleted === 1 ? ' is' : 's are'} still marked as scheduled.` });

  for (const cb of d.budget.categoryBudgets) {
    if (cb.budget > 0 && cb.spent > cb.budget) out.push({ id: `over-${cb.categoryId}`, kind: 'budget', tone: 'attention', text: `${cb.name} spending (${money(cb.spent)}) is over its budget of ${money(cb.budget)}.` });
  }
  if (d.invoices.overdueCount) out.push({ id: 'overdue', kind: 'income', tone: 'attention', text: `${d.invoices.overdueCount} invoice${d.invoices.overdueCount === 1 ? ' is' : 's are'} overdue, totalling ${money(d.invoices.overdueAmount)}.` });

  const daysLeft = Math.max(0, Number(to.slice(8)) - Number(today.slice(8)));
  if (daysLeft > 0) out.push({ id: 'days-left', kind: 'savings', tone: 'neutral', text: `There ${daysLeft === 1 ? 'is 1 day' : `are ${daysLeft} days`} left this month. Net so far: ${money(d.month.savingsThisMonth)}.` });
  return out;
}
