import { Types } from 'mongoose';
import { Income, Expense, RecurringBill, Job, Invoice, Task, Budget, Category, IncomeSource, Client } from '../models/index.js';
import { addDays, addMonths, diffDays, lastNMonths, minutesBetween, monthEnd, monthKey, monthStart, weekStart } from '../utils/dates.js';
import { round2, sum } from '../utils/money.js';
import { billOccurrences, monthlyEquivalent, taskOccurrences, type BillLike } from './recurrence.js';
import { effectiveStatus } from './invoices.js';
import { travelSummary } from './travel/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FinanceFilters {
  from: string;
  to: string;
  today: string;
  incomeSourceId?: string;
  categoryId?: string;
}

export const jobHours = (j: any): number => j.hoursWorked ?? (minutesBetween(j.startTime, j.endTime) ?? 0) / 60;

/** Bills due in [from,to] with paid flag (a linked expense exists for that occurrence). */
export async function billsDue(userId: string, from: string, to: string) {
  const bills = await RecurringBill.find({ userId, active: true }).lean();
  const payments = await Expense.find({ userId, billId: { $in: bills.map((b) => b._id) }, billOccurrence: { $gte: from, $lte: to } })
    .select('billId billOccurrence amount')
    .lean();
  const paid = new Set(payments.map((p) => `${p.billId}|${p.billOccurrence}`));
  const out: { billId: string; name: string; amount: number; dueDate: string; paid: boolean; categoryId: any; paymentMethod?: string | null; autoPay?: boolean | null }[] = [];
  for (const b of bills) {
    for (const d of billOccurrences(b as unknown as BillLike, from, to)) {
      out.push({ billId: String(b._id), name: b.name, amount: b.amount, dueDate: d, paid: paid.has(`${b._id}|${d}`), categoryId: b.categoryId, paymentMethod: b.paymentMethod, autoPay: b.autoPay });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Monthly bills + expected variable spending + savings target = minimum income required. */
export async function requiredIncome(userId: string) {
  const [bills, budget] = await Promise.all([RecurringBill.find({ userId, active: true }).lean(), Budget.findOne({ userId }).lean()]);
  const breakdown = bills.map((b) => ({ id: String(b._id), name: b.name, frequency: b.frequency, amount: b.amount, monthly: monthlyEquivalent(b as unknown as BillLike) }));
  const monthlyBills = sum(breakdown.map((b) => b.monthly));
  const variable = budget?.expectedVariableExpenses ?? 0;
  const savings = budget?.monthlySavingsTarget ?? 0;
  return {
    monthlyBills,
    expectedVariableExpenses: variable,
    savingsTarget: savings,
    minimumMonthlyIncome: round2(monthlyBills + variable + savings),
    incomeTarget: budget?.monthlyIncomeTarget ?? 0,
    billsBreakdown: breakdown.sort((a, b) => b.monthly - a.monthly),
  };
}

function bucket<T>(items: T[], key: (t: T) => string, val: (t: T) => number) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), round2((m.get(key(it)) ?? 0) + val(it)));
  return m;
}

export async function dashboard(userId: string, f: FinanceFilters) {
  const uid = new Types.ObjectId(userId);
  const months = lastNMonths(f.to, 12);
  const windowFrom = [months[0] + '-01', f.from].sort()[0];
  const windowTo = [f.to, addDays(f.today, 30)].sort().reverse()[0];
  const curMonthFrom = monthStart(f.today), curMonthTo = monthEnd(f.today);

  const incomeQ: any = { userId: uid, date: { $gte: windowFrom, $lte: windowTo }, status: { $ne: 'cancelled' } };
  const jobQ: any = { userId: uid, date: { $gte: windowFrom, $lte: windowTo } };
  if (f.incomeSourceId) {
    incomeQ.incomeSourceId = f.incomeSourceId;
    jobQ.incomeSourceId = f.incomeSourceId;
  }
  const expenseQ: any = { userId: uid, date: { $gte: windowFrom, $lte: windowTo } };
  if (f.categoryId) expenseQ.categoryId = f.categoryId;

  const [incomes, expenses, jobs, invoices, categories, sources, budget, req, clients] = await Promise.all([
    Income.find(incomeQ).lean(),
    Expense.find(expenseQ).lean(),
    Job.find(jobQ).lean(),
    Invoice.find({ userId: uid, status: { $ne: 'cancelled' } }).select('number clientName total status dueDate issueDate paidDate').lean(),
    Category.find({ userId: uid }).lean(),
    IncomeSource.find({ userId: uid }).lean(),
    Budget.findOne({ userId: uid }).lean(),
    requiredIncome(userId),
    Client.find({ userId: uid }).select('name').lean(),
  ]);

  const inRange = (d: string, from = f.from, to = f.to) => d >= from && d <= to;
  const catName = new Map(categories.map((c) => [String(c._id), { name: c.name, color: c.color }]));
  const srcName = new Map(sources.map((s) => [String(s._id), { name: s.name, color: s.color }]));
  const clientName = new Map(clients.map((c) => [String(c._id), c.name]));

  const rIncome = incomes.filter((i) => inRange(i.date));
  const rPaid = rIncome.filter((i) => i.status === 'paid');
  const rExpenses = expenses.filter((e) => inRange(e.date));
  const incomeReceived = sum(rPaid.map((i) => i.amount));
  const incomeExpected = sum(rIncome.filter((i) => i.status !== 'paid').map((i) => i.amount));
  const expensesTotal = sum(rExpenses.map((e) => e.amount));

  // Current month (independent of filter range) for "required income" comparisons
  const mIncome = incomes.filter((i) => inRange(i.date, curMonthFrom, curMonthTo));
  const mPaid = sum(mIncome.filter((i) => i.status === 'paid').map((i) => i.amount));
  const mAll = sum(mIncome.map((i) => i.amount));
  const mExpenses = sum(expenses.filter((e) => inRange(e.date, curMonthFrom, curMonthTo)).map((e) => e.amount));
  const monthBills = await billsDue(userId, curMonthFrom, curMonthTo);
  const unpaidBillsRemaining = sum(monthBills.filter((b) => !b.paid && b.dueDate >= f.today).map((b) => b.amount));
  const upcomingBills = (await billsDue(userId, f.today, addDays(f.today, 30))).filter((b) => !b.paid);

  // Invoices
  const invWithStatus = invoices.map((i) => ({ ...i, id: String(i._id), effectiveStatus: effectiveStatus(i, f.today) }));
  const outstanding = invWithStatus.filter((i) => i.effectiveStatus === 'sent' || i.effectiveStatus === 'overdue');
  const overdue = invWithStatus.filter((i) => i.effectiveStatus === 'overdue');
  const paidInv = invWithStatus.filter((i) => i.status === 'paid');
  const unpaidInv = invWithStatus.filter((i) => i.status !== 'paid');

  // Averages
  const daysElapsed = Math.max(1, diffDays(f.from, f.to < f.today ? f.to : f.today) + 1);
  const twelveWeeksAgo = addDays(weekStart(f.today), -7 * 12);
  const weeklyIncome = sum(incomes.filter((i) => i.status === 'paid' && i.date >= twelveWeeksAgo && i.date < weekStart(f.today)).map((i) => i.amount));
  const monthly = months.map((m) => {
    const inc = incomes.filter((i) => monthKey(i.date) === m);
    return {
      month: m,
      income: sum(inc.filter((i) => i.status === 'paid').map((i) => i.amount)),
      expectedIncome: sum(inc.filter((i) => i.status !== 'paid').map((i) => i.amount)),
      expenses: sum(expenses.filter((e) => monthKey(e.date) === m).map((e) => e.amount)),
    };
  }).map((r) => ({ ...r, net: round2(r.income - r.expenses) }));
  const pastMonthsWithData = monthly.filter((m) => m.month < monthKey(f.today) && (m.income > 0 || m.expenses > 0));
  const avgMonthlyIncome = pastMonthsWithData.length ? round2(sum(pastMonthsWithData.map((m) => m.income)) / pastMonthsWithData.length) : mPaid;
  const avgMonthlyExpenses = pastMonthsWithData.length ? round2(sum(pastMonthsWithData.map((m) => m.expenses)) / pastMonthsWithData.length) : mExpenses;

  // Work
  const ws = weekStart(f.today);
  const completed = jobs.filter((j) => j.status === 'completed');
  const rJobs = completed.filter((j) => inRange(j.date));
  const rJobIncome = sum(rJobs.map((j) => j.amount ?? 0));
  const rHours = round2(sum(rJobs.map(jobHours)));
  const upcomingJobs = jobs
    .filter((j) => j.date >= f.today && j.date <= addDays(f.today, 7) && (j.status === 'scheduled' || j.status === 'in_progress'))
    .sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));

  // Today
  const allTasks = await Task.find({ userId: uid, $or: [{ date: { $lte: f.today }, 'recurrence.frequency': { $ne: 'none' } }, { date: f.today }] }).lean();
  const todayTasks = allTasks
    .filter((t) => taskOccurrences(t as any, f.today, f.today).length)
    .map((t) => ({ ...t, id: String(t._id), status: (t.occurrenceStatus as any)?.[f.today] ?? t.status }));
  const todayJobs = jobs.filter((j) => j.date === f.today).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  // Charts
  const expenseByCategory = Array.from(bucket(rExpenses, (e) => String(e.categoryId ?? 'none'), (e) => e.amount))
    .map(([id, value]) => ({ id, name: catName.get(id)?.name ?? 'Uncategorised', color: catName.get(id)?.color ?? '#94a3b8', value }))
    .sort((a, b) => b.value - a.value);
  const incomeBySource = Array.from(bucket(rIncome, (i) => String(i.incomeSourceId ?? 'none'), (i) => i.amount))
    .map(([id, value]) => ({ id, name: srcName.get(id)?.name ?? 'Unassigned', color: srcName.get(id)?.color ?? '#94a3b8', value }))
    .sort((a, b) => b.value - a.value);
  const incomeByClient = Array.from(bucket(rIncome.filter((i) => i.clientId || i.clientName), (i) => (i.clientId ? clientName.get(String(i.clientId)) : undefined) ?? i.clientName ?? 'Unknown', (i) => i.amount))
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const days: string[] = [];
  for (let d = f.from; d <= f.to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const spendByDay = bucket(rExpenses, (e) => e.date, (e) => e.amount);
  const incByDay = bucket(rPaid, (i) => i.date, (i) => i.amount);
  let running = 0;
  const cashFlow = days.map((d) => {
    const inc = incByDay.get(d) ?? 0, exp = spendByDay.get(d) ?? 0;
    running = round2(running + inc - exp);
    return { date: d, income: inc, expenses: exp, net: round2(inc - exp), cumulative: running };
  });
  const weekly: { week: string; spending: number; income: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const w = addDays(ws, -7 * i), we = addDays(w, 6);
    weekly.push({
      week: w,
      spending: sum(expenses.filter((e) => e.date >= w && e.date <= we).map((e) => e.amount)),
      income: sum(incomes.filter((x) => x.status === 'paid' && x.date >= w && x.date <= we).map((x) => x.amount)),
    });
  }
  const workMonthly = months.map((m) => {
    const js = completed.filter((j) => monthKey(j.date) === m);
    const hrs = sum(js.map(jobHours));
    const amt = sum(js.map((j) => j.amount ?? 0));
    return { month: m, jobs: js.length, income: amt, hours: round2(hrs), perJob: js.length ? round2(amt / js.length) : 0, perHour: hrs ? round2(amt / hrs) : 0 };
  });

  const travel = await travelSummary(userId, f.from, f.to);

  const categoryBudgets = (budget?.categoryBudgets ?? []).map((cb) => {
    const spent = sum(expenses.filter((e) => String(e.categoryId) === String(cb.categoryId) && inRange(e.date, curMonthFrom, curMonthTo)).map((e) => e.amount));
    return { categoryId: String(cb.categoryId), name: catName.get(String(cb.categoryId))?.name ?? 'Category', budget: cb.amount, spent };
  });

  return {
    range: { from: f.from, to: f.to, today: f.today },
    money: {
      incomeReceived,
      incomeExpected,
      incomeTotal: round2(incomeReceived + incomeExpected),
      expenses: expensesTotal,
      net: round2(incomeReceived - expensesTotal),
      projectedNet: round2(incomeReceived + incomeExpected - expensesTotal),
      avgDailySpending: round2(expensesTotal / daysElapsed),
      avgWeeklyIncome: round2(weeklyIncome / 12),
      avgMonthlyIncome,
      avgMonthlyExpenses,
    },
    month: {
      from: curMonthFrom,
      to: curMonthTo,
      incomeReceived: mPaid,
      incomeIncludingExpected: mAll,
      expenses: mExpenses,
      unpaidBillsRemaining,
      remainingDisposable: round2(mPaid - mExpenses - unpaidBillsRemaining),
      requiredIncome: req.minimumMonthlyIncome,
      shortfall: round2(Math.max(0, req.minimumMonthlyIncome - mAll)),
      savingsThisMonth: round2(mPaid - mExpenses),
    },
    required: req,
    savings: {
      current: budget?.currentSavings ?? 0,
      monthlyTarget: budget?.monthlySavingsTarget ?? 0,
      emergencyFund: budget?.currentEmergencyFund ?? 0,
      emergencyFundTarget: budget?.emergencyFundTarget ?? 0,
    },
    bills: { upcoming: upcomingBills.slice(0, 10), upcomingTotal: sum(upcomingBills.map((b) => b.amount)), thisMonth: monthBills },
    invoices: {
      outstandingCount: outstanding.length,
      outstandingAmount: sum(outstanding.map((i) => i.total)),
      overdueCount: overdue.length,
      overdueAmount: sum(overdue.map((i) => i.total)),
      paidCount: paidInv.length,
      paidAmount: sum(paidInv.map((i) => i.total)),
      unpaidCount: unpaidInv.length,
      unpaidAmount: sum(unpaidInv.map((i) => i.total)),
      dueSoon: outstanding.filter((i) => i.dueDate <= addDays(f.today, 14)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
    },
    work: {
      jobsThisWeek: completed.filter((j) => j.date >= ws && j.date <= f.today).length,
      jobsThisMonth: completed.filter((j) => j.date >= curMonthFrom && j.date <= curMonthTo).length,
      jobsInRange: rJobs.length,
      jobIncome: rJobIncome,
      hoursWorked: rHours,
      avgPerJob: rJobs.length ? round2(rJobIncome / rJobs.length) : 0,
      avgPerHour: rHours ? round2(rJobIncome / rHours) : 0,
      upcoming: upcomingJobs.slice(0, 10).map((j) => ({ ...j, id: String(j._id) })),
      pastUncompleted: jobs.filter((j) => j.date < f.today && j.status === 'scheduled').length,
      /** Past shifts/jobs where the pay hasn't been entered yet */
      payNotSet: jobs.filter((j) => j.date < f.today && j.status !== 'cancelled' && !j.amount).length,
      travel: { enabled: travel.settings.enabled, ...travel.totals, daily: travel.rows },
      byArrangement: (['own', 'subcontract', 'employee'] as const).map((w) => {
        const js = rJobs.filter((j) => (j.workType ?? 'own') === w);
        return { workType: w, jobs: js.length, income: sum(js.map((j) => j.amount ?? 0)) };
      }),
      byContractor: Array.from(bucket(rJobs.filter((j) => j.workType === 'subcontract'), (j) => j.contractorName ?? 'Unknown contractor', (j) => j.amount ?? 0)).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      perJob: rJobs.sort((a, b) => a.date.localeCompare(b.date)).map((j) => ({ id: String(j._id), date: j.date, client: j.clientName, amount: j.amount ?? 0, hours: round2(jobHours(j)) })),
    },
    today: {
      date: f.today,
      tasks: todayTasks,
      jobs: todayJobs.map((j) => ({ ...j, id: String(j._id) })),
      billsDue: monthBills.filter((b) => b.dueDate === f.today),
      invoicesDue: outstanding.filter((i) => i.dueDate === f.today),
    },
    budget: {
      incomeTarget: budget?.monthlyIncomeTarget ?? 0,
      spendingLimit: budget?.monthlySpendingLimit ?? 0,
      categoryBudgets,
    },
    charts: { monthly, expenseByCategory, incomeBySource, incomeByClient, cashFlow, weekly, workMonthly, billsBreakdown: req.billsBreakdown },
  };
}

export { addMonths };
