import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { dashboard, billsDue, jobHours } from '../services/finance.js';
import { insights } from '../services/insights.js';
import { alertInbox, markAlerts } from '../services/alerts.js';
import { userCtx } from '../utils/userCtx.js';
import { parseBody } from '../middleware/validate.js';
import { zDate, zOptId } from '../utils/zod.js';
import { monthEnd, monthStart, monthKey, weekStart } from '../utils/dates.js';
import { Income, Expense, Job, Category, IncomeSource, Invoice, Task, Client, RecurringBill, DocumentModel } from '../models/index.js';
import { round2, sum } from '../utils/money.js';
import { toCsv } from '../utils/csv.js';
import { buildReport, type GroupBy } from '../services/reports.js';
import { materialiseRecurringIncome } from '../services/recurringIncome.js';
import { queueCalendarPull } from '../services/google/calendar.js';
import { reportsToXlsx, reportsToPdf, XLSX_TYPE } from '../services/reportExport.js';
import { escapeRegex } from '../services/crud.js';
import { taskOccurrences } from '../services/recurrence.js';
import { effectiveStatus } from '../services/invoices.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r = Router();

r.get('/dashboard', async (req, res) => {
  const { today } = await userCtx(req);
  const q = parseBody(z.object({ from: zDate.optional(), to: zDate.optional(), incomeSourceId: zOptId, categoryId: zOptId }), req.query);
  const from = q.from ?? monthStart(today), to = q.to ?? monthEnd(today);
  await materialiseRecurringIncome(req.userId!, today).catch((e) => console.error('[recurring income]', e));
  res.json(await dashboard(req.userId!, { from, to: to < from ? from : to, today, incomeSourceId: q.incomeSourceId ?? undefined, categoryId: q.categoryId ?? undefined }));
});

r.get('/insights', async (req, res) => {
  const { today, currency } = await userCtx(req);
  res.json({ items: await insights(req.userId!, today, currency) });
});

r.get('/alerts', async (req, res) => {
  const { today, currency } = await userCtx(req);
  res.json(await alertInbox(req.userId!, today, currency));
});

/** Mark notifications read / unread, or dismiss them. `all: true` applies to everything currently showing. */
r.post('/alerts/:action', async (req, res) => {
  const { action } = parseBody(z.object({ action: z.enum(['read', 'unread', 'dismiss']) }), req.params);
  const body = parseBody(z.object({ keys: z.array(z.string().max(300)).max(500).optional(), all: z.boolean().optional() }), req.body ?? {});
  const { today, currency } = await userCtx(req);
  const keys = body.all ? (await alertInbox(req.userId!, today, currency)).items.map((a) => a.key) : body.keys ?? [];
  await markAlerts(req.userId!, action, keys);
  res.json(await alertInbox(req.userId!, today, currency));
});

/** Merged calendar feed: tasks (with recurrences), jobs, bill due dates and invoice due dates. */
r.get('/calendar', async (req, res) => {
  const q = parseBody(z.object({ from: zDate, to: zDate }), req.query);
  const userId = req.userId!;
  queueCalendarPull(userId); // two-way sync: pick up edits made in Google Calendar (throttled, in the background)
  const { today } = await userCtx(req);
  const uid = new Types.ObjectId(userId);
  const [tasks, jobs, bills, invoices] = await Promise.all([
    Task.find({ userId: uid, date: { $lte: q.to }, $or: [{ date: { $gte: q.from } }, { 'recurrence.frequency': { $ne: 'none' } }] }).lean(),
    Job.find({ userId: uid, date: { $gte: q.from, $lte: q.to } }).lean(),
    billsDue(userId, q.from, q.to),
    Invoice.find({ userId: uid, status: { $in: ['sent', 'draft'] }, dueDate: { $gte: q.from, $lte: q.to } }).lean(),
  ]);
  const events: any[] = [];
  for (const t of tasks) {
    for (const d of taskOccurrences(t as any, q.from, q.to)) {
      events.push({ id: `task-${t._id}-${d}`, type: 'task', refId: String(t._id), date: d, startTime: t.startTime, endTime: t.endTime, title: t.title, category: t.category, priority: t.priority, status: (t.occurrenceStatus as any)?.[d] ?? t.status, location: t.location, recurring: t.recurrence?.frequency !== 'none' });
    }
  }
  for (const j of jobs) events.push({ id: `job-${j._id}`, type: 'job', refId: String(j._id), date: j.date, startTime: j.startTime, endTime: j.endTime, title: j.clientName || j.title || 'Job', amount: j.amount, status: j.status, location: j.address?.formatted });
  for (const b of bills) events.push({ id: `bill-${b.billId}-${b.dueDate}`, type: 'bill', refId: b.billId, date: b.dueDate, title: b.name, amount: b.amount, status: b.paid ? 'paid' : 'due' });
  for (const i of invoices) events.push({ id: `inv-${i._id}`, type: 'invoice', refId: String(i._id), date: i.dueDate, title: `Invoice ${i.number} due`, amount: i.total, status: effectiveStatus(i, today) });
  events.sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  res.json({ items: events });
});

/** Global search across records. Matches text, amounts (e.g. "30" or "$30.00") and dates (YYYY-MM-DD or YYYY-MM). */
r.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) return res.json({ results: [] });
  const uid = new Types.ObjectId(req.userId);
  const re = new RegExp(escapeRegex(q), 'i');
  const num = /^\$?\d+(\.\d{1,2})?$/.test(q) ? Number(q.replace('$', '')) : undefined;
  const dateQ = /^\d{4}-\d{2}(-\d{2})?$/.test(q) ? new RegExp('^' + escapeRegex(q)) : undefined;
  const or = (fields: string[], amountField?: string, dateField?: string) => {
    const c: any[] = fields.map((f) => ({ [f]: re }));
    if (num !== undefined && amountField) c.push({ [amountField]: num });
    if (dateQ && dateField) c.push({ [dateField]: dateQ });
    return { userId: uid, $or: c };
  };
  const L = 8;
  const [clients, jobs, incomes, invoices, expenses, bills, docs, tasks] = await Promise.all([
    Client.find(or(['name', 'email', 'phone', 'address.formatted'])).limit(L).lean(),
    Job.find(or(['clientName', 'contractorName', 'title', 'description', 'address.formatted', 'address.suburb'], 'amount', 'date')).sort({ date: -1 }).limit(L).lean(),
    Income.find(or(['clientName', 'description', 'invoiceNumber', 'notes'], 'amount', 'date')).sort({ date: -1 }).limit(L).lean(),
    Invoice.find(or(['number', 'clientName', 'items.description', 'notes'], 'total', 'issueDate')).sort({ issueDate: -1 }).limit(L).lean(),
    Expense.find(or(['merchant', 'description', 'notes'], 'amount', 'date')).sort({ date: -1 }).limit(L).lean(),
    RecurringBill.find(or(['name', 'notes'], 'amount', 'dueDate')).limit(L).lean(),
    DocumentModel.find(or(['title', 'merchant', 'originalName', 'notes'], 'amount', 'date')).limit(L).lean(),
    Task.find(or(['title', 'description', 'location'], undefined, 'date')).sort({ date: -1 }).limit(L).lean(),
  ]);
  const results = [
    ...clients.map((c) => ({ type: c.type === 'contractor' ? 'contractor' : 'client', id: String(c._id), title: c.name, subtitle: c.address?.formatted ?? c.email ?? '', link: `/clients` })),
    ...jobs.map((j) => ({ type: 'job', id: String(j._id), title: `${j.clientName ?? j.title ?? 'Job'}`, subtitle: `${j.date}${j.startTime ? ' ' + j.startTime : ''}${j.contractorName ? ' · via ' + j.contractorName : ''} · ${j.address?.formatted ?? ''}`, amount: j.amount, date: j.date, link: `/jobs?focus=${j._id}` })),
    ...incomes.map((i) => ({ type: 'income', id: String(i._id), title: i.clientName ?? i.description ?? 'Income', subtitle: `${i.date} · ${i.status}`, amount: i.amount, date: i.date, link: `/income?focus=${i._id}` })),
    ...invoices.map((i) => ({ type: 'invoice', id: String(i._id), title: `Invoice ${i.number}`, subtitle: `${i.clientName} · ${i.status}`, amount: i.total, date: i.issueDate, link: `/invoices/${i._id}` })),
    ...expenses.map((e) => ({ type: 'expense', id: String(e._id), title: e.merchant ?? e.description ?? 'Expense', subtitle: e.date, amount: e.amount, date: e.date, link: `/expenses?focus=${e._id}` })),
    ...bills.map((b) => ({ type: 'bill', id: String(b._id), title: b.name, subtitle: `${b.frequency} · next from ${b.dueDate}`, amount: b.amount, link: `/bills` })),
    ...docs.map((d) => ({ type: 'document', id: String(d._id), title: d.title, subtitle: `${d.kind}${d.merchant ? ' · ' + d.merchant : ''}`, amount: d.amount, date: d.date, link: `/documents?focus=${d._id}` })),
    ...tasks.map((t) => ({ type: 'task', id: String(t._id), title: t.title, subtitle: `${t.date}${t.startTime ? ' ' + t.startTime : ''}`, date: t.date, link: `/my-day?date=${t.date}` })),
  ];
  res.json({ results });
});

/** Reports: income / expenses / cashflow / work, grouped by period or dimension. Formats: json, csv, xlsx, pdf. */
r.get('/reports/:type', async (req, res) => {
  const type = z.enum(['income', 'expenses', 'cashflow', 'work', 'all']).parse(req.params.type);
  const q = parseBody(
    z.object({ from: zDate, to: zDate, groupBy: z.enum(['day', 'week', 'month', 'year', 'source', 'client', 'contractor', 'workType', 'category', 'merchant', 'paymentMethod']).default('month'), format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'), detail: z.enum(['true', 'false']).optional() }),
    req.query,
  );
  const { currency, user } = await userCtx(req);
  const name = `${type}-report-${q.from}-to-${q.to}`;
  if (type === 'all') {
    // Full workbook: every report by month plus detail sheets
    const reports = await Promise.all((['income', 'expenses', 'cashflow', 'work'] as const).map((t) => buildReport(req.userId!, t, q.from, q.to, 'month')));
    const buf = q.format === 'pdf' ? await reportsToPdf(reports, { currency, owner: user?.name }) : await reportsToXlsx(reports, { currency, includeDetail: true });
    res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="financial-report-${q.from}-to-${q.to}.${q.format === 'pdf' ? 'pdf' : 'xlsx'}"`);
    return res.send(buf);
  }
  const g = (type === 'cashflow' && !['day', 'week', 'month', 'year'].includes(q.groupBy) ? 'month' : q.groupBy) as GroupBy;
  const report = await buildReport(req.userId!, type, q.from, q.to, g);
  if (q.format === 'csv') {
    const useDetail = q.detail === 'true' && report.detail.length;
    const cols = useDetail ? report.detailColumns : report.columns;
    const data = useDetail ? report.detail : report.rows;
    const csv = toCsv(data.map((row) => Object.fromEntries(cols.map((c) => [c.label, row[c.key]]))), cols.map((c) => c.label));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send('\ufeff' + csv);
  }
  if (q.format === 'xlsx') {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return res.send(await reportsToXlsx([report], { currency, includeDetail: true }));
  }
  if (q.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    return res.send(await reportsToPdf([report], { currency, owner: user?.name, includeDetail: q.detail === 'true' }));
  }
  res.json({ ...report, detail: report.detail.slice(0, 1000) });
});

export default r;
