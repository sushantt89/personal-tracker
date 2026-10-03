import { Types } from 'mongoose';
import { Budget, Category, Expense, Income, Job, User } from '../models/index.js';
import { addDays, diffDays, monthEnd, monthStart } from '../utils/dates.js';
import { round2, sum } from '../utils/money.js';
import { billsDue, dashboard, jobHours } from './finance.js';

/**
 * The Assistant: plain arithmetic over the user's own records — no AI and nothing leaves the server.
 * It answers "can I afford this?", "how much is safe to spend?", "what's coming up?" and "how do I reach a savings goal?"
 * and always shows the numbers behind the answer. It is a guide based on what has been entered, not financial advice.
 */

const HORIZON = 30; // days looked ahead for "safe to spend"
const SIM_DAYS = 120; // how far ahead "when could I afford it?" searches

export interface Snapshot {
  today: string;
  currency: string;
  /** Money available now. `known` is false until the user has entered a balance. */
  balance: { amount: number; known: boolean; enteredAmount?: number; asOf?: string; incomeSince: number; expensesSince: number };
  bills: { total: number; items: { name: string; amount: number; dueDate: string }[] };
  income: { total: number; items: { label: string; amount: number; date: string }[]; nextDate: string | null; overdueExpected: number };
  everyday: { monthly: number; daily: number; source: 'budget' | 'average' | 'none' };
  savingsTarget: number;
  monthlyBills: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  avgPerHour: number;
  /** Balance + income expected − bills due − everyday spending, over the next 30 days */
  free30: number;
  /** …and after also putting this month's savings target aside */
  free30AfterSavings: number;
  /** A small cushion: about a week of normal outgoings */
  buffer: number;
  /** Cash position each day for the next SIM_DAYS, used to find when something becomes affordable */
  timeline: { date: string; cash: number }[];
  month: { shortfall: number; requiredIncome: number; incomeIncludingExpected: number };
  topCategories: { name: string; thisMonth: number; lastMonth: number }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function snapshot(userId: string, today: string): Promise<Snapshot> {
  const uid = new Types.ObjectId(userId);
  const horizonEnd = addDays(today, HORIZON), simEnd = addDays(today, SIM_DAYS);
  const lastMonthStart = monthStart(addDays(monthStart(today), -1));
  const [user, budget, d, billsAhead, expected, overdue, recentJobs, recentExpenses, categories] = await Promise.all([
    User.findById(userId).select('currency').lean(),
    Budget.findOne({ userId: uid }).lean(),
    dashboard(userId, { from: monthStart(today), to: monthEnd(today), today }),
    billsDue(userId, today, simEnd),
    Income.find({ userId: uid, status: { $in: ['expected', 'pending'] }, date: { $gte: today, $lte: simEnd } }).sort({ date: 1 }).lean(),
    Income.find({ userId: uid, status: { $in: ['expected', 'pending'] }, date: { $lt: today, $gte: addDays(today, -60) } }).lean(),
    Job.find({ userId: uid, status: 'completed', date: { $gte: addDays(today, -90), $lte: today }, amount: { $gt: 0 } }).lean(),
    Expense.find({ userId: uid, date: { $gte: addDays(lastMonthStart, -62), $lte: today } }).select('date amount billId categoryId').lean(),
    Category.find({ userId: uid }).select('name').lean(),
  ]);

  // --- Balance: what the user last entered, rolled forward with what has been recorded since ---
  const entered = budget?.balance?.asOf && typeof budget.balance.amount === 'number' ? { amount: budget.balance.amount, asOf: budget.balance.asOf } : null;
  let balance: Snapshot['balance'];
  if (entered) {
    const [inc, exp] = await Promise.all([
      Income.find({ userId: uid, status: 'paid', $or: [{ paidDate: { $gt: entered.asOf, $lte: today } }, { paidDate: null, date: { $gt: entered.asOf, $lte: today } }] }).select('amount').lean(),
      Expense.find({ userId: uid, date: { $gt: entered.asOf, $lte: today } }).select('amount').lean(),
    ]);
    const incomeSince = sum(inc.map((i) => i.amount)), expensesSince = sum(exp.map((e) => e.amount));
    balance = { amount: round2(entered.amount + incomeSince - expensesSince), known: true, enteredAmount: entered.amount, asOf: entered.asOf, incomeSince, expensesSince };
  } else {
    // No balance entered: fall back to what is left of this month's income so far
    balance = { amount: round2(Math.max(0, d.month.incomeReceived - d.month.expenses)), known: false, incomeSince: 0, expensesSince: 0 };
  }

  // --- Everyday (non-bill) spending: the budget figure if set, otherwise the average of the last two full months ---
  let everyday: Snapshot['everyday'];
  if ((budget?.expectedVariableExpenses ?? 0) > 0) everyday = { monthly: budget!.expectedVariableExpenses, daily: round2(budget!.expectedVariableExpenses / 30.4), source: 'budget' };
  else {
    const from = monthStart(addDays(lastMonthStart, -1));
    const past = recentExpenses.filter((e) => !e.billId && e.date >= from && e.date < monthStart(today));
    const monthly = past.length ? round2(sum(past.map((e) => e.amount)) / 2) : 0;
    everyday = { monthly, daily: round2(monthly / 30.4), source: monthly ? 'average' : 'none' };
  }

  const unpaid = billsAhead.filter((b) => !b.paid);
  const bills30 = unpaid.filter((b) => b.dueDate <= horizonEnd);
  const income30 = expected.filter((i) => i.date <= horizonEnd);
  const billsTotal = sum(bills30.map((b) => b.amount)), incomeTotal = sum(income30.map((i) => i.amount));
  const savingsTarget = budget?.monthlySavingsTarget ?? 0;
  const free30 = round2(balance.amount + incomeTotal - billsTotal - everyday.daily * HORIZON);
  const hours = sum(recentJobs.map((j) => jobHours(j)));
  const avgPerHour = hours > 0 ? round2(sum(recentJobs.map((j) => j.amount ?? 0)) / hours) : 0;

  // --- Day-by-day cash for the coming months ---
  const timeline: Snapshot['timeline'] = [];
  let cash = balance.amount;
  for (let i = 0; i <= SIM_DAYS; i++) {
    const date = addDays(today, i);
    cash += sum(expected.filter((x) => x.date === date).map((x) => x.amount)) - sum(unpaid.filter((b) => b.dueDate === date).map((b) => b.amount)) - (i === 0 ? 0 : everyday.daily);
    timeline.push({ date, cash: round2(cash) });
  }

  // --- Where the money goes: this month against last month ---
  const names = new Map<string, string>(categories.map((c) => [String(c._id), c.name]));
  const byCat = (from: string, to: string) => {
    const m = new Map<string, number>();
    for (const e of recentExpenses) if (e.date >= from && e.date <= to) m.set(String(e.categoryId ?? ''), (m.get(String(e.categoryId ?? '')) ?? 0) + e.amount);
    return m;
  };
  const cur = byCat(monthStart(today), today), prev = byCat(lastMonthStart, monthEnd(lastMonthStart));
  const topCategories = [...new Set([...cur.keys(), ...prev.keys()])]
    .map((id) => ({ name: names.get(id) ?? 'Uncategorised', thisMonth: round2(cur.get(id) ?? 0), lastMonth: round2(prev.get(id) ?? 0) }))
    .sort((a, b) => b.thisMonth - a.thisMonth || b.lastMonth - a.lastMonth).slice(0, 6);

  return {
    today, currency: user?.currency || 'AUD', balance,
    bills: { total: billsTotal, items: bills30.map((b) => ({ name: b.name, amount: b.amount, dueDate: b.dueDate })) },
    income: { total: incomeTotal, items: income30.map((i) => ({ label: i.clientName || i.description || 'Income', amount: i.amount, date: i.date })), nextDate: expected[0]?.date ?? null, overdueExpected: sum(overdue.map((i) => i.amount)) },
    everyday, savingsTarget, monthlyBills: d.required.monthlyBills, avgMonthlyIncome: d.money.avgMonthlyIncome, avgMonthlyExpenses: d.money.avgMonthlyExpenses, avgPerHour,
    free30, free30AfterSavings: round2(free30 - savingsTarget),
    buffer: Math.max(50, Math.round((everyday.monthly + d.required.monthlyBills) / 4.33)),
    timeline,
    month: { shortfall: d.month.shortfall, requiredIncome: d.month.requiredIncome, incomeIncludingExpected: d.month.incomeIncludingExpected },
    topCategories,
  };
}

export type Verdict = 'yes' | 'tight' | 'wait' | 'no' | 'unknown';
export interface Check { key: string; status: 'pass' | 'warn' | 'fail'; title: string; detail: string }
export interface AffordResult {
  amount: number; verdict: Verdict; headline: string; summary: string; checks: Check[];
  /** First day it could be bought while keeping the cushion, if that is within the next few months */
  affordableFrom: string | null;
  facts: { label: string; value: string }[];
  suggestions: string[];
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Should I buy this? Works through the same questions a careful person would, in order. */
export function assessPurchase(s: Snapshot, amount: number): AffordResult {
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: s.currency }).format(n);
  const checks: Check[] = [];
  const suggestions: string[] = [];
  const hasData = s.balance.known || s.balance.amount > 0 || s.income.total > 0 || s.avgMonthlyIncome > 0;
  if (!hasData) {
    return { amount, verdict: 'unknown', headline: 'I need a bit more to go on', summary: 'Enter how much money you have right now (above), or record some income, and I can give you a real answer.', checks: [], affordableFrom: null, facts: [], suggestions: [] };
  }

  // 1. Is the money there today?
  const afterToday = round2(s.balance.amount - amount);
  checks.push(afterToday >= 0
    ? { key: 'cash', status: 'pass', title: 'You have the money today', detail: `You have about ${money(s.balance.amount)}, so ${money(afterToday)} would be left.` }
    : { key: 'cash', status: 'fail', title: 'You don’t have this much right now', detail: `You have about ${money(s.balance.amount)} — ${money(-afterToday)} short of ${money(amount)}.` });

  // 2. Bills and living costs until the next money comes in
  const until = s.income.nextDate && diffDays(s.today, s.income.nextDate) <= 21 ? s.income.nextDate : addDays(s.today, 14);
  const daysUntil = Math.max(1, diffDays(s.today, until));
  const billsBefore = sum(s.bills.items.filter((b) => b.dueDate <= until).map((b) => b.amount));
  const needBefore = round2(billsBefore + s.everyday.daily * daysUntil);
  const untilText = s.income.nextDate === until ? `your next expected income on ${fmtDay(until)}` : `the next two weeks`;
  const gapBefore = round2(afterToday - needBefore);
  if (afterToday >= 0) {
    checks.push(gapBefore >= 0
      ? { key: 'bridge', status: 'pass', title: 'Bills are still covered', detail: `Before ${untilText} you need about ${money(needBefore)} (${money(billsBefore)} in bills plus everyday spending). You’d still have ${money(gapBefore)} spare.` }
      : { key: 'bridge', status: 'fail', title: 'It would leave you short for bills', detail: `Before ${untilText} you need about ${money(needBefore)} (${money(billsBefore)} in bills plus everyday spending). After buying this you’d be ${money(-gapBefore)} short.` });
  }

  // 3. The next 30 days as a whole
  const after30 = round2(s.free30 - amount);
  checks.push(after30 >= s.buffer
    ? { key: 'month', status: 'pass', title: 'The next 30 days still work', detail: `After income (${money(s.income.total)} expected), bills (${money(s.bills.total)}) and everyday spending, you’d have about ${money(after30)} left over.` }
    : after30 >= 0
      ? { key: 'month', status: 'warn', title: 'It leaves very little slack', detail: `Over the next 30 days you’d be left with about ${money(after30)} — less than a week’s normal costs (${money(s.buffer)}). One surprise bill would hurt.` }
      : { key: 'month', status: 'fail', title: 'The next 30 days don’t add up', detail: `Counting expected income (${money(s.income.total)}), bills (${money(s.bills.total)}) and everyday spending, you’d be ${money(-after30)} in the red.` });

  // 4. Savings target
  if (s.savingsTarget > 0) {
    const afterSavings = round2(s.free30AfterSavings - amount);
    checks.push(afterSavings >= 0
      ? { key: 'savings', status: 'pass', title: 'Your savings target is safe', detail: `You could still put aside your ${money(s.savingsTarget)} this month.` }
      : { key: 'savings', status: 'warn', title: 'It eats into your savings target', detail: `You’d fall ${money(Math.min(-afterSavings, s.savingsTarget))} short of the ${money(s.savingsTarget)} you aim to save each month.` });
  }

  // 5. How big is it for you?
  if (s.avgMonthlyIncome > 0) {
    const pct = Math.round((amount / s.avgMonthlyIncome) * 100);
    if (pct >= 40) checks.push({ key: 'size', status: 'warn', title: 'This is a big purchase for you', detail: `It’s about ${pct}% of what you usually earn in a month (${money(s.avgMonthlyIncome)}).` });
  }
  if (!s.balance.known) checks.push({ key: 'balance', status: 'warn', title: 'I’m guessing your balance', detail: 'You haven’t told me how much money you have, so I used what’s left of this month’s income. Enter your balance above for a firmer answer.' });

  // When does it become comfortable? The first day cash covers it and still leaves the cushion.
  let affordableFrom: string | null = null;
  for (let i = 0; i < s.timeline.length; i++) {
    if (s.timeline[i].cash - amount < s.buffer) continue;
    let ok = true;
    // …and stays above zero for the two weeks after (income further out usually isn't recorded yet, so looking further would be too gloomy)
    for (let j = i; j < Math.min(s.timeline.length, i + 15); j++) if (s.timeline[j].cash - amount < 0) { ok = false; break; }
    if (ok) { affordableFrom = s.timeline[i].date; break; }
  }

  const fails = checks.filter((c) => c.status === 'fail'), warns = checks.filter((c) => c.status === 'warn' && c.key !== 'balance');
  let verdict: Verdict, headline: string, summary: string;
  if (!fails.length && !warns.length) {
    verdict = 'yes'; headline = 'Yes — you can afford this';
    summary = `Your bills are covered, the next 30 days still work${s.savingsTarget > 0 ? ' and your savings target is untouched' : ''}.`;
  } else if (!fails.length) {
    verdict = 'tight'; headline = 'You can, but think about it';
    summary = `The money is there and your bills are covered, but ${warns.map((w) => w.title.charAt(0).toLowerCase() + w.title.slice(1)).join(', and ')}.`;
  } else if (affordableFrom && affordableFrom > s.today && diffDays(s.today, affordableFrom) <= 60) {
    verdict = 'wait'; headline = `Not yet — wait until ${fmtDay(affordableFrom)}`;
    summary = `Right now ${fails[0].title.charAt(0).toLowerCase() + fails[0].title.slice(1)}. From ${fmtDay(affordableFrom)}, once more of your expected income has arrived, it fits without touching your bills.`;
  } else {
    verdict = 'no'; headline = 'No — not right now';
    summary = `${fails[0].title}. ${fails[0].detail}`;
  }

  // What would change the answer
  const worstGap = Math.max(0, -Math.min(afterToday, afterToday >= 0 ? gapBefore : 0, after30));
  if (verdict === 'no' || verdict === 'wait') {
    if (worstGap > 0 && s.avgPerHour > 0) suggestions.push(`Earning ${money(worstGap)} more would close the gap — about ${Math.ceil(worstGap / s.avgPerHour)} more hour${Math.ceil(worstGap / s.avgPerHour) === 1 ? '' : 's'} of work at your usual ${money(s.avgPerHour)}/hour.`);
    else if (worstGap > 0) suggestions.push(`You’d need about ${money(worstGap)} more to make this work.`);
    const cheaper = round2(Math.max(0, Math.min(s.balance.amount - needBefore, s.free30 - s.buffer)));
    if (cheaper >= 5 && cheaper < amount) suggestions.push(`Right now, up to about ${money(Math.floor(cheaper))} would be comfortable.`);
    if (s.income.overdueExpected > 0) suggestions.push(`${money(s.income.overdueExpected)} of income you were expecting hasn’t been marked as received. If it has arrived, mark it paid and check again.`);
    suggestions.push('Add it to your wishlist below and I’ll keep checking it for you.');
  } else if (verdict === 'tight' && affordableFrom && affordableFrom > s.today) {
    suggestions.push(`Waiting until ${fmtDay(affordableFrom)} would make it comfortable.`);
  }

  const facts: AffordResult['facts'] = [];
  if (s.avgPerHour > 0) facts.push({ label: 'Hours of work', value: `${(amount / s.avgPerHour).toFixed(1)} h at ${money(s.avgPerHour)}/h` });
  if (s.avgMonthlyIncome > 0) facts.push({ label: 'Of a typical month’s income', value: `${Math.round((amount / s.avgMonthlyIncome) * 100)}%` });
  if (s.everyday.daily > 0) facts.push({ label: 'Days of everyday spending', value: `${Math.round(amount / s.everyday.daily)} days` });
  facts.push({ label: 'Left today if you buy it', value: money(afterToday) });
  return { amount, verdict, headline, summary, checks, affordableFrom, facts, suggestions };
}

export interface GoalResult { target: number; byDate: string; weeks: number; perWeek: number; typicalWeeklySurplus: number; onTrack: boolean; headline: string; detail: string[]; reachDate: string | null }

/** "I want to have $X saved by <date>": how much a week that is, and whether your usual surplus gets you there. */
export function planGoal(s: Snapshot, target: number, byDate: string, alreadySaved = 0): GoalResult {
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: s.currency }).format(n);
  const days = Math.max(1, diffDays(s.today, byDate));
  const weeks = Math.max(1, Math.round((days / 7) * 10) / 10);
  const remaining = Math.max(0, round2(target - alreadySaved));
  const perWeek = round2(remaining / weeks);
  const surplus = round2((s.avgMonthlyIncome - s.avgMonthlyExpenses) / 4.33);
  const onTrack = remaining === 0 || surplus >= perWeek;
  const detail: string[] = [];
  let reachDate: string | null = null;
  if (remaining === 0) detail.push('You already have this much saved.');
  else {
    detail.push(`That is ${money(perWeek)} a week for ${weeks} week${weeks === 1 ? '' : 's'}${alreadySaved > 0 ? `, on top of the ${money(alreadySaved)} you already have` : ''}.`);
    if (s.avgMonthlyIncome <= 0) detail.push('I don’t have enough past months of income to say whether that is realistic yet.');
    else if (onTrack) detail.push(`On average you have about ${money(surplus)} a week left after spending, so this fits with ${money(round2(surplus - perWeek))} a week to spare.`);
    else {
      detail.push(surplus > 0 ? `On average you have about ${money(surplus)} a week left after spending — ${money(round2(perWeek - surplus))} a week short.` : 'On average you currently spend as much as you earn, so there is nothing left over to save yet.');
      const gap = round2(perWeek - Math.max(0, surplus));
      if (s.avgPerHour > 0) detail.push(`About ${(gap / s.avgPerHour).toFixed(1)} extra hours of work a week (at ${money(s.avgPerHour)}/hour) would cover it — or trim ${money(gap)} a week from spending.`);
      if (surplus > 0) { reachDate = addDays(s.today, Math.ceil((remaining / surplus) * 7)); detail.push(`At your usual pace you’d get there around ${fmtDay(reachDate)} ${reachDate.slice(0, 4)}.`); }
    }
  }
  const headline = remaining === 0 ? 'Already there' : onTrack ? `On track — ${money(perWeek)} a week` : `A stretch — ${money(perWeek)} a week needed`;
  return { target, byDate, weeks, perWeek, typicalWeeklySurplus: surplus, onTrack, headline, detail, reachDate };
}

/** Everything the Assistant page shows before any question is asked. */
export async function overview(userId: string, today: string) {
  const s = await snapshot(userId, today);
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: s.currency }).format(n);
  const uid = new Types.ObjectId(userId);
  const weekEnd = addDays(today, 7);
  const jobs = await Job.find({ userId: uid, date: { $gte: today, $lte: weekEnd }, status: { $in: ['scheduled', 'in_progress'] } }).sort({ date: 1, startTime: 1 }).lean();
  const week = {
    bills: s.bills.items.filter((b) => b.dueDate <= weekEnd),
    income: s.income.items.filter((i) => i.date <= weekEnd),
    jobs: jobs.length,
    jobHours: round2(sum(jobs.map((j) => jobHours(j)))),
    jobIncome: sum(jobs.map((j) => j.amount ?? 0)),
  };
  const perDay = s.free30 > 0 ? round2(s.free30 / HORIZON) : 0;
  const lowest = s.timeline.slice(0, HORIZON + 1).reduce((m, x) => (x.cash < m.cash ? x : m), s.timeline[0]);
  const notes: { status: 'pass' | 'warn' | 'fail'; text: string }[] = [];
  if (!s.balance.known) notes.push({ status: 'warn', text: 'Tell me how much money you have right now and every answer here gets more accurate.' });
  if (lowest.cash < 0) notes.push({ status: 'fail', text: `On ${fmtDay(lowest.date)} you are on course to be ${money(-lowest.cash)} short for bills, unless more income comes in before then.` });
  else if (lowest.cash < s.buffer && lowest.date !== today) notes.push({ status: 'warn', text: `Money gets tight around ${fmtDay(lowest.date)} (about ${money(lowest.cash)} left).` });
  if (s.income.overdueExpected > 0) notes.push({ status: 'warn', text: `${money(s.income.overdueExpected)} of expected income is past its date and not marked as received.` });
  if (s.month.shortfall > 0) {
    notes.push({ status: 'warn', text: `This month you are ${money(s.month.shortfall)} below the income you need${s.avgPerHour > 0 ? ` — about ${Math.ceil(s.month.shortfall / s.avgPerHour)} more hours of work at ${money(s.avgPerHour)}/hour` : ''}.` });
  }
  if (!notes.length) notes.push({ status: 'pass', text: 'Bills for the next 30 days are covered and nothing needs your attention.' });
  return {
    today, currency: s.currency, balance: s.balance,
    safeToSpend: { amount: Math.max(0, round2(s.free30AfterSavings)), beforeSavings: s.free30, perDay, incomeExpected: s.income.total, billsDue: s.bills.total, everyday: round2(s.everyday.daily * HORIZON), everydaySource: s.everyday.source, savingsTarget: s.savingsTarget, days: HORIZON },
    notes, week,
    workNeeded: { shortfall: s.month.shortfall, avgPerHour: s.avgPerHour, hours: s.avgPerHour > 0 ? Math.ceil(s.month.shortfall / s.avgPerHour) : null, requiredIncome: s.month.requiredIncome, incomeIncludingExpected: s.month.incomeIncludingExpected },
    topCategories: s.topCategories,
    averages: { monthlyIncome: s.avgMonthlyIncome, monthlyExpenses: s.avgMonthlyExpenses },
  };
}
