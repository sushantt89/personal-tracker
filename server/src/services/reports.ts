import { Types } from 'mongoose';
import { Income, Expense, Job, Category, IncomeSource, TravelDay } from '../models/index.js';
import { monthKey, weekStart } from '../utils/dates.js';
import { round2, sum } from '../utils/money.js';
import { jobHours } from './finance.js';
import { travelSettings, fuelFor } from './travel/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ReportType = 'income' | 'expenses' | 'cashflow' | 'work';
export type GroupBy = 'day' | 'week' | 'month' | 'year' | 'source' | 'client' | 'contractor' | 'workType' | 'category' | 'merchant' | 'paymentMethod';
export type ColumnKind = 'text' | 'date' | 'money' | 'int' | 'number' | 'km';
export interface Column { key: string; label: string; kind: ColumnKind }
export interface Report {
  type: ReportType; title: string; from: string; to: string; groupBy: GroupBy;
  columns: Column[]; rows: Record<string, any>[]; totals: Record<string, number>;
  detailColumns: Column[]; detail: Record<string, any>[];
}

export const REPORT_TITLES: Record<ReportType, string> = { income: 'Income', expenses: 'Expenses', cashflow: 'Profit & cash flow', work: 'Work' };
export const GROUP_LABELS: Record<GroupBy, string> = {
  day: 'Day', week: 'Week starting', month: 'Month', year: 'Year', source: 'Income source', client: 'Client', contractor: 'Contractor',
  workType: 'Own business vs contractor', category: 'Category', merchant: 'Merchant', paymentMethod: 'Payment method',
};
const isPeriodGroup = (g: GroupBy) => ['day', 'week', 'month', 'year'].includes(g);

export async function buildReport(userId: string, type: ReportType, from: string, to: string, groupBy: GroupBy): Promise<Report> {
  const uid = new Types.ObjectId(userId);
  const range = { $gte: from, $lte: to };
  const isPeriod = isPeriodGroup(groupBy);
  const period = (d: string) => (groupBy === 'day' ? d : groupBy === 'week' ? weekStart(d) : groupBy === 'month' ? monthKey(d) : d.slice(0, 4));
  const [cats, srcs] = await Promise.all([Category.find({ userId: uid }).lean(), IncomeSource.find({ userId: uid }).lean()]);
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  const srcName = new Map(srcs.map((s) => [String(s._id), s.name]));
  const groupCol: Column = { key: 'group', label: GROUP_LABELS[groupBy], kind: groupBy === 'day' || groupBy === 'week' ? 'date' : 'text' };

  const group = <T>(items: T[], key: (t: T) => string, build: (key: string, items: T[]) => Record<string, any>) => {
    const m = new Map<string, T[]>();
    for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
    const out = Array.from(m.entries()).map(([k, v]) => build(k, v));
    return isPeriod ? out.sort((a, b) => String(a.group).localeCompare(String(b.group))) : out.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  };

  let columns: Column[] = [groupCol];
  let rows: Record<string, any>[] = [];
  let detailColumns: Column[] = [];
  let detail: Record<string, any>[] = [];

  if (type === 'income') {
    const items = await Income.find({ userId: uid, date: range, status: { $ne: 'cancelled' } }).sort({ date: 1 }).lean();
    const key = (i: any) => (isPeriod ? period(i.date) : groupBy === 'source' ? srcName.get(String(i.incomeSourceId)) ?? 'Unassigned' : groupBy === 'paymentMethod' ? i.paymentMethod || '—' : i.clientName ?? 'Unknown');
    rows = group(items, key, (k, v) => ({ group: k, count: v.length, paid: sum(v.filter((i) => i.status === 'paid').map((i) => i.amount)), expected: sum(v.filter((i) => i.status !== 'paid').map((i) => i.amount)), total: sum(v.map((i) => i.amount)), hours: round2(sum(v.map((i) => i.hoursWorked ?? 0))) }));
    columns = [groupCol, { key: 'count', label: 'Records', kind: 'int' }, { key: 'paid', label: 'Received', kind: 'money' }, { key: 'expected', label: 'Expected', kind: 'money' }, { key: 'total', label: 'Total', kind: 'money' }, { key: 'hours', label: 'Hours', kind: 'number' }];
    detailColumns = [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'source', label: 'Source', kind: 'text' }, { key: 'client', label: 'Client / payer', kind: 'text' }, { key: 'description', label: 'Description', kind: 'text' }, { key: 'status', label: 'Status', kind: 'text' }, { key: 'paymentMethod', label: 'Payment', kind: 'text' }, { key: 'invoiceNumber', label: 'Invoice', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money' }];
    detail = items.map((i) => ({ date: i.date, source: srcName.get(String(i.incomeSourceId)) ?? '', client: i.clientName ?? '', description: i.description ?? '', amount: i.amount, status: i.status, paymentMethod: i.paymentMethod ?? '', invoiceNumber: i.invoiceNumber ?? '' }));
  } else if (type === 'expenses') {
    const items = await Expense.find({ userId: uid, date: range }).sort({ date: 1 }).lean();
    const key = (e: any) => (isPeriod ? period(e.date) : groupBy === 'merchant' ? e.merchant || '—' : groupBy === 'paymentMethod' ? e.paymentMethod || '—' : catName.get(String(e.categoryId)) ?? 'Uncategorised');
    rows = group(items, key, (k, v) => ({ group: k, count: v.length, total: sum(v.map((e) => e.amount)), gst: sum(v.map((e) => e.gst ?? 0)) }));
    columns = [groupCol, { key: 'count', label: 'Transactions', kind: 'int' }, { key: 'gst', label: 'GST', kind: 'money' }, { key: 'total', label: 'Total', kind: 'money' }];
    detailColumns = [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'category', label: 'Category', kind: 'text' }, { key: 'merchant', label: 'Merchant', kind: 'text' }, { key: 'description', label: 'Description', kind: 'text' }, { key: 'paymentMethod', label: 'Payment', kind: 'text' }, { key: 'gst', label: 'GST', kind: 'money' }, { key: 'amount', label: 'Amount', kind: 'money' }];
    detail = items.map((e) => ({ date: e.date, category: catName.get(String(e.categoryId)) ?? '', merchant: e.merchant ?? '', description: e.description ?? '', amount: e.amount, paymentMethod: e.paymentMethod ?? '', gst: e.gst ?? null }));
  } else if (type === 'cashflow') {
    const p = isPeriod ? period : (d: string) => monthKey(d);
    const [inc, exp] = await Promise.all([Income.find({ userId: uid, date: range, status: 'paid' }).lean(), Expense.find({ userId: uid, date: range }).lean()]);
    const keys = new Set([...inc.map((i) => p(i.date)), ...exp.map((e) => p(e.date))]);
    let cumulative = 0;
    rows = Array.from(keys).sort().map((k) => {
      const income = sum(inc.filter((i) => p(i.date) === k).map((i) => i.amount));
      const expenses = sum(exp.filter((e) => p(e.date) === k).map((e) => e.amount));
      cumulative = round2(cumulative + income - expenses);
      return { group: k, income, expenses, net: round2(income - expenses), cumulative };
    });
    columns = [{ ...groupCol, label: isPeriod ? GROUP_LABELS[groupBy] : 'Month' }, { key: 'income', label: 'Income received', kind: 'money' }, { key: 'expenses', label: 'Expenses', kind: 'money' }, { key: 'net', label: 'Net cash flow', kind: 'money' }, { key: 'cumulative', label: 'Running total', kind: 'money' }];
  } else {
    const ts = await travelSettings(userId);
    const [jobs, days] = await Promise.all([
      Job.find({ userId: uid, date: range, status: 'completed' }).sort({ date: 1, startTime: 1 }).lean(),
      ts.enabled ? TravelDay.find({ userId: uid, date: range }).lean() : Promise.resolve([] as any[]),
    ]);
    const kmByDay = new Map(days.map((d: any) => [d.date, d.totalKm ?? 0]));
    const key = (j: any) => (isPeriod ? period(j.date) : groupBy === 'source' ? srcName.get(String(j.incomeSourceId)) ?? 'Unassigned'
      : groupBy === 'contractor' ? (j.workType === 'subcontract' ? j.contractorName ?? 'Unknown contractor' : j.workType === 'employee' ? 'Employee (wages)' : 'Own business')
      : groupBy === 'workType' ? (j.workType === 'subcontract' ? 'Working under a contractor' : j.workType === 'employee' ? 'Employee (wages)' : 'Own business') : j.clientName ?? 'Unknown');
    rows = group(jobs, key, (k, v) => {
      const total = sum(v.map((j) => j.amount ?? 0)), hours = round2(sum(v.map(jobHours)));
      const row: Record<string, any> = { group: k, jobs: v.length, total, avgPerJob: v.length ? round2(total / v.length) : 0, hours, avgPerHour: hours ? round2(total / hours) : 0 };
      if (ts.enabled) {
        // Period rows use the full day route (incl. driving home); other groupings use the drive to each job
        const km = isPeriod ? round2(sum([...new Set(v.map((j) => j.date))].map((d) => kmByDay.get(d) ?? 0))) : round2(sum(v.map((j) => j.distanceKm ?? 0)));
        const fuel = fuelFor(km, ts).cost;
        Object.assign(row, { km, fuelCost: fuel, afterFuel: round2(total - fuel), perKm: km ? round2(total / km) : 0 });
      }
      return row;
    });
    columns = [groupCol, { key: 'jobs', label: 'Jobs', kind: 'int' }, { key: 'total', label: 'Income', kind: 'money' }, { key: 'avgPerJob', label: 'Avg / job', kind: 'money' }, { key: 'hours', label: 'Hours', kind: 'number' }, { key: 'avgPerHour', label: 'Avg / hour', kind: 'money' },
      ...(ts.enabled ? [{ key: 'km', label: 'Km driven', kind: 'km' as const }, { key: 'fuelCost', label: 'Fuel cost', kind: 'money' as const }, { key: 'afterFuel', label: 'Income after fuel', kind: 'money' as const }, { key: 'perKm', label: 'Income / km', kind: 'money' as const }] : [])];
    detailColumns = [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'start', label: 'Start', kind: 'text' }, { key: 'client', label: 'Client', kind: 'text' }, { key: 'contractor', label: 'Contractor', kind: 'text' }, { key: 'address', label: 'Address', kind: 'text' }, { key: 'hours', label: 'Hours', kind: 'number' },
      ...(ts.enabled ? [{ key: 'km', label: 'Km to job', kind: 'km' as const }] : []), { key: 'amount', label: 'Amount', kind: 'money' }];
    detail = jobs.map((j) => ({ date: j.date, start: j.startTime ?? '', client: j.clientName ?? '', contractor: j.workType === 'subcontract' ? j.contractorName ?? '' : '', address: j.address?.formatted ?? '', amount: j.amount ?? 0, hours: round2(jobHours(j)), km: j.distanceKm ?? null }));
  }

  const totals: Record<string, number> = {};
  for (const c of columns) {
    if (c.key === 'group' || c.key === 'cumulative' || c.kind === 'text' || c.kind === 'date') continue;
    totals[c.key] = round2(sum(rows.map((r) => Number(r[c.key]) || 0)));
  }
  // Ratios are recomputed from totals, never summed
  if (type === 'work') {
    if ('avgPerJob' in totals) totals.avgPerJob = totals.jobs ? round2(totals.total / totals.jobs) : 0;
    if ('avgPerHour' in totals) totals.avgPerHour = totals.hours ? round2(totals.total / totals.hours) : 0;
    if ('perKm' in totals) totals.perKm = totals.km ? round2(totals.total / totals.km) : 0;
  }
  if (type === 'cashflow' && rows.length) totals.cumulative = rows[rows.length - 1].cumulative;
  return { type, title: REPORT_TITLES[type], from, to, groupBy, columns, rows, totals, detailColumns, detail };
}
