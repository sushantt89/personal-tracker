import { Router } from 'express';
import { z } from 'zod';
import { crudRouter } from '../services/crud.js';
import { Category, IncomeSource, Client, Job, Income, Expense, RecurringBill, Task, InvoiceTemplate } from '../models/index.js';
import { categorySchema, incomeSourceSchema, clientSchema, jobSchema, incomeSchema, expenseSchema, billSchema, taskSchema, invoiceTemplateSchema } from './schemas.js';
import { resolveClient, applyWorkArrangement, payerOf } from '../services/clients.js';
import { audit } from '../services/audit.js';
import { queueCalendarSync } from '../services/google/calendar.js';
import { queueTravelDay } from '../services/travel/index.js';
import { materialiseRecurringIncome } from '../services/recurringIncome.js';
import { conflict, notFound, badRequest } from '../utils/httpError.js';
import { parseBody } from '../middleware/validate.js';
import { zDate, zMoney, zOptStr } from '../utils/zod.js';
import { billsDue, requiredIncome, jobHours } from '../services/finance.js';
import { userCtx } from '../utils/userCtx.js';
import { minutesBetween } from '../utils/dates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- Categories & income sources ----------
export const categoriesRouter = crudRouter({
  model: Category, entity: 'Category', schema: categorySchema, searchFields: ['name'], sort: { name: 1 }, audited: false,
  hooks: {
    beforeDelete: async (req, c) => {
      if (await Expense.exists({ userId: req.userId, categoryId: c._id })) throw conflict('This category is used by expenses. Archive it instead, or move those expenses first.');
    },
  },
});

export const incomeSourcesRouter = crudRouter({
  model: IncomeSource, entity: 'IncomeSource', schema: incomeSourceSchema, searchFields: ['name'], sort: { name: 1 }, audited: false, refs: { contractorId: Client },
  hooks: {
    beforeDelete: async (req, s) => {
      if ((await Income.exists({ userId: req.userId, incomeSourceId: s._id })) || (await Job.exists({ userId: req.userId, incomeSourceId: s._id })))
        throw conflict('This income source has records. Archive it instead.');
    },
  },
});

// ---------- Clients ----------
export const clientsRouter = crudRouter({
  model: Client, entity: 'Client', schema: clientSchema, searchFields: ['name', 'email', 'phone', 'contactName', 'address.formatted', 'address.suburb'], filterFields: ['type'],
  refs: { incomeSourceId: IncomeSource }, sort: { name: 1 }, audited: false,
  hooks: {
    afterUpdate: async (req, doc, before) => {
      if (doc.name !== before.name) {
        await Job.updateMany({ userId: req.userId, clientId: doc._id }, { clientName: doc.name });
        await Income.updateMany({ userId: req.userId, clientId: doc._id }, { clientName: doc.name });
        await Job.updateMany({ userId: req.userId, contractorId: doc._id }, { contractorName: doc.name });
      }
    },
    afterDelete: async (req, c) => {
      await Job.updateMany({ userId: req.userId, clientId: c._id }, { clientId: null });
      await Income.updateMany({ userId: req.userId, clientId: c._id }, { clientId: null });
      await Job.updateMany({ userId: req.userId, contractorId: c._id }, { contractorId: null });
      await IncomeSource.updateMany({ userId: req.userId, contractorId: c._id }, { contractorId: null });
    },
  },
});

// ---------- Jobs (linked to an income record) ----------
const INCOME_SYNC_FIELDS = ['amount', 'date', 'clientId', 'clientName', 'incomeSourceId', 'hoursWorked', 'startTime', 'endTime', 'workType', 'contractorId', 'contractorName'];

/** Income description names the site client; for subcontract work the payer is the contractor. */
export const jobIncomeDescription = (job: any) =>
  job.title || `Job – ${job.clientName ?? ''}${job.workType === 'subcontract' && job.contractorName ? ` (via ${job.contractorName})` : ''}`.trim();

async function createIncomeForJob(userId: string, job: any) {
  if (!job.amount || job.amount <= 0) return null;
  const hours = jobHours(job) || undefined;
  const income = await Income.create({
    userId, date: job.date, amount: job.amount, incomeSourceId: job.incomeSourceId, ...payerOf(job),
    description: jobIncomeDescription(job), hoursWorked: hours, status: 'expected', jobId: job._id,
  });
  await audit(userId, 'Income', income._id, 'create', undefined, income.toJSON(), `Created from job ${job._id}`);
  return income;
}

const jobsCrud = crudRouter({
  model: Job, entity: 'Job', schema: jobSchema,
  refs: { clientId: Client, incomeSourceId: IncomeSource, contractorId: Client },
  searchFields: ['clientName', 'contractorName', 'title', 'description', 'address.formatted', 'address.suburb', 'notes'],
  filterFields: ['status', 'clientId', 'incomeSourceId', 'invoiceId', 'workType', 'contractorId'],
  dateField: 'date', sort: { date: -1, startTime: 1 }, calendarKind: 'job',
  // ?pay=unset → jobs/shifts whose pay hasn't been entered yet; ?pay=set → the rest
  extraFilter: (req, filter) => {
    if (req.query.pay === 'unset') Object.assign(filter, { $and: [{ $or: [{ amount: null }, { amount: 0 }] }], status: filter.status ?? { $ne: 'cancelled' } });
    else if (req.query.pay === 'set') filter.amount = { $gt: 0 };
  },
  hooks: {
    beforeCreate: async (req, data) => {
      await resolveClient(req.userId!, data, { create: true, address: data.address, incomeSourceId: data.incomeSourceId });
      await applyWorkArrangement(req.userId!, data);
      if (!data.hoursWorked) data.hoursWorked = (minutesBetween(data.startTime, data.endTime) ?? 0) / 60 || undefined;
    },
    afterCreate: async (req, job) => {
      if (req.body?.createIncome !== false) await createIncomeForJob(req.userId!, job);
      queueTravelDay(req.userId!, job.date);
    },
    beforeUpdate: async (req, data, existing) => {
      if (data.clientName !== undefined && data.clientId === undefined) {
        data.clientId = null;
        await resolveClient(req.userId!, data, { create: true });
      }
      if (data.workType !== undefined || data.contractorId !== undefined || data.contractorName !== undefined) {
        const merged: any = { workType: data.workType ?? existing.workType, contractorId: data.contractorId !== undefined ? data.contractorId : existing.contractorId, contractorName: data.contractorName, incomeSourceId: data.incomeSourceId ?? existing.incomeSourceId };
        if (data.contractorName !== undefined && data.contractorId === undefined) merged.contractorId = null;
        await applyWorkArrangement(req.userId!, merged, { inheritFromSource: false });
        Object.assign(data, { workType: merged.workType, contractorId: merged.contractorId ?? null, contractorName: merged.contractorName });
      }
    },
    afterUpdate: async (req, job, before) => {
      const routeChanged = ['date', 'startTime', 'status', 'address'].some((f) => JSON.stringify((before as any)[f] ?? null) !== JSON.stringify(job.toJSON()[f] ?? null));
      if (routeChanged) queueTravelDay(req.userId!, before.date, job.date);
      const income = await Income.findOne({ userId: req.userId, jobId: job._id });
      if (!income) {
        if (job.status !== 'cancelled' && job.amount && req.body?.createIncome !== false) await createIncomeForJob(req.userId!, job);
        return;
      }
      const changed = INCOME_SYNC_FIELDS.some((f) => JSON.stringify((before as any)[f] ?? null) !== JSON.stringify(job[f] ?? null));
      const prev = income.toJSON();
      if (job.status === 'cancelled' && income.status !== 'paid') {
        income.status = 'cancelled';
      } else if (changed && income.status !== 'paid') {
        // Linked income mirrors the job until it is paid; paid income is never changed automatically.
        income.set({ amount: job.amount ?? income.amount, date: job.date, ...payerOf(job), description: jobIncomeDescription(job), incomeSourceId: job.incomeSourceId, hoursWorked: jobHours(job) || undefined });
        if (before.status === 'cancelled' && income.status === 'cancelled') income.status = 'expected';
      } else if (before.status === 'cancelled' && job.status !== 'cancelled' && income.status === 'cancelled') {
        income.status = 'expected';
      } else return;
      await income.save();
      await audit(req.userId!, 'Income', income._id, 'update', prev, income.toJSON(), `Synced from job ${job._id}`);
    },
    beforeDelete: async (_req, job) => {
      if (job.invoiceId) throw conflict('This job is on an invoice. Remove it from the invoice (or delete the invoice) first.');
    },
    afterDelete: async (req, job) => {
      queueTravelDay(req.userId!, job.date);
      const income = await Income.findOne({ userId: req.userId, jobId: job._id });
      if (!income) return;
      if (income.status === 'paid') {
        await Income.updateOne({ _id: income._id }, { jobId: null });
      } else {
        await income.deleteOne();
        await audit(req.userId!, 'Income', income._id, 'delete', income.toJSON(), `Job ${job._id} deleted`);
      }
    },
  },
});

export const jobsRouter = Router();
/** Mark all past scheduled jobs (before today) as completed — explicit user action. */
jobsRouter.post('/complete-past', async (req, res) => {
  const { today } = await userCtx(req);
  const body = parseBody(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
  const filter: any = { userId: req.userId, status: 'scheduled', date: { $lt: today } };
  if (body.ids?.length) filter._id = { $in: body.ids };
  const jobs = await Job.find(filter);
  for (const j of jobs) {
    const before = j.toJSON();
    j.status = 'completed';
    await j.save();
    await audit(req.userId!, 'Job', j._id, 'update', before, j.toJSON(), 'Bulk complete past jobs');
  }
  res.json({ updated: jobs.length });
});
/**
 * Record pay after the fact: one amount (e.g. a payslip) shared across the chosen shifts in proportion to their hours.
 * Each shift gets its share as its amount, and its income record is marked as received.
 */
jobsRouter.post('/record-pay', async (req, res) => {
  const body = parseBody(
    z.object({
      jobIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1, 'Choose at least one shift').max(200),
      total: zMoney.refine((n) => n > 0, 'Enter the amount you were paid'),
      paidDate: zDate.optional(),
      paymentMethod: zOptStr(60),
      markCompleted: z.boolean().default(true),
    }),
    req.body,
  );
  const userId = req.userId!;
  const { today } = await userCtx(req);
  const jobs = await Job.find({ _id: { $in: body.jobIds }, userId, status: { $ne: 'cancelled' } }).sort({ date: 1, startTime: 1 });
  if (jobs.length !== new Set(body.jobIds).size) throw badRequest('Some of those shifts could not be found (or are cancelled). Refresh and try again.');
  if (jobs.some((j) => j.invoiceId)) throw conflict('One of those jobs is on an invoice — its amount is set by the invoice.');

  // Share by hours; if no hours are known, share equally. Work in cents so the parts add up exactly.
  const hours = jobs.map((j) => jobHours(j));
  const weights = hours.every((h) => h > 0) ? hours : jobs.map(() => 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(body.total * 100);
  const shares = weights.map((w) => Math.floor((cents * w) / weightSum));
  shares[shares.length - 1] += cents - shares.reduce((a, b) => a + b, 0);
  const paidDate = body.paidDate ?? today;

  const out: any[] = [];
  for (const [i, job] of jobs.entries()) {
    const before = job.toJSON();
    job.amount = shares[i] / 100;
    if (body.markCompleted && job.status !== 'completed' && job.date <= today) job.status = 'completed';
    await job.save();
    await audit(userId, 'Job', job._id, 'update', before, job.toJSON(), 'Pay recorded');
    const fields = { amount: job.amount, date: job.date, ...payerOf(job), description: jobIncomeDescription(job), incomeSourceId: job.incomeSourceId, hoursWorked: jobHours(job) || undefined, status: 'paid', paidDate, ...(body.paymentMethod ? { paymentMethod: body.paymentMethod } : {}) };
    const income = await Income.findOne({ userId, jobId: job._id });
    if (income) {
      const prev = income.toJSON();
      income.set(fields);
      await income.save();
      await audit(userId, 'Income', income._id, 'update', prev, income.toJSON(), `Pay recorded for job ${job._id}`);
    } else {
      const created = await Income.create({ userId, jobId: job._id, ...fields });
      await audit(userId, 'Income', created._id, 'create', undefined, created.toJSON(), `Pay recorded for job ${job._id}`);
    }
    out.push(job.toJSON());
  }
  res.json({ updated: out.length, total: cents / 100, perHour: hours.every((h) => h > 0) ? Math.round((cents / weightSum)) / 100 : null, jobs: out });
});
jobsRouter.use('/', jobsCrud);

// ---------- Income ----------
const incomeCrud = crudRouter({
  model: Income, entity: 'Income', schema: incomeSchema,
  refs: { clientId: Client, incomeSourceId: IncomeSource, jobId: Job },
  searchFields: ['clientName', 'description', 'invoiceNumber', 'notes', 'paymentMethod'],
  filterFields: ['status', 'incomeSourceId', 'clientId', 'jobId', 'paymentMethod', 'recurringParentId'],
  dateField: 'date',
  hooks: {
    beforeCreate: async (req, data) => {
      await resolveClient(req.userId!, data, { create: false });
      if (data.status === 'paid' && !data.paidDate) data.paidDate = data.date;
      if (data.recurring?.enabled && !data.recurring.frequency) data.recurring.frequency = 'monthly';
    },
    afterCreate: async (req, doc) => {
      if (doc.recurring?.enabled) await materialiseRecurringIncome(req.userId!, (await userCtx(req)).today);
    },
    afterUpdate: async (req, doc, before) => {
      if (!doc.recurring?.enabled || doc.recurringParentId) return;
      // Changing the amount/source/etc. of a repeating record updates its future, still-expected entries
      const fields = ['amount', 'incomeSourceId', 'clientId', 'clientName', 'description', 'paymentMethod', 'hoursWorked'];
      const { today } = await userCtx(req);
      if (fields.some((f) => JSON.stringify((before as any)[f] ?? null) !== JSON.stringify(doc.toJSON()[f] ?? null))) {
        await Income.updateMany({ userId: req.userId, recurringParentId: doc._id, status: 'expected', date: { $gte: today } },
          { amount: doc.amount, incomeSourceId: doc.incomeSourceId, clientId: doc.clientId, clientName: doc.clientName, description: doc.description, paymentMethod: doc.paymentMethod, hoursWorked: doc.hoursWorked });
      }
      if (doc.recurring?.until) await Income.deleteMany({ userId: req.userId, recurringParentId: doc._id, status: 'expected', date: { $gt: doc.recurring.until } });
      await materialiseRecurringIncome(req.userId!, today);
    },
    beforeUpdate: async (_req, data, existing) => {
      if (data.status === 'paid' && !data.paidDate && !existing.paidDate) data.paidDate = existing.date;
    },
  },
});

export const incomeRouter = Router();
/** Stop a repeating income: no new entries; optionally remove future expected ones. */
incomeRouter.post('/:id/stop-recurring', async (req, res) => {
  const body = parseBody(z.object({ removeFuture: z.boolean().default(true) }), req.body ?? {});
  const inc = await Income.findOne({ _id: req.params.id, userId: req.userId });
  if (!inc) throw notFound('Income record not found');
  const root = inc.recurringParentId ? await Income.findOne({ _id: inc.recurringParentId, userId: req.userId }) : inc;
  if (!root) throw notFound('The original repeating record no longer exists');
  const { today } = await userCtx(req);
  const before = root.toJSON();
  root.set('recurring.enabled', false);
  await root.save();
  await audit(req.userId!, 'Income', root._id, 'update', before, root.toJSON(), 'Stopped repeating');
  const removed = body.removeFuture ? (await Income.deleteMany({ userId: req.userId, recurringParentId: root._id, status: 'expected', date: { $gt: today } })).deletedCount : 0;
  res.json({ ok: true, removed });
});
incomeRouter.use('/', incomeCrud);

// ---------- Expenses ----------
export const expensesRouter = crudRouter({
  model: Expense, entity: 'Expense', schema: expenseSchema,
  refs: { categoryId: Category, billId: RecurringBill },
  searchFields: ['merchant', 'description', 'notes', 'paymentMethod'],
  filterFields: ['categoryId', 'paymentMethod', 'billId', 'isRecurring'],
  dateField: 'date',
});

// ---------- Recurring bills ----------
const billsCrud = crudRouter({
  model: RecurringBill, entity: 'RecurringBill', schema: billSchema, refs: { categoryId: Category },
  searchFields: ['name', 'notes', 'paymentMethod'], filterFields: ['frequency', 'categoryId', 'active'], sort: { dueDate: 1 }, calendarKind: 'bill',
  hooks: {
    beforeCreate: (_req, data) => { if (data.frequency !== 'custom') data.customIntervalDays = undefined; },
  },
});
export const billsRouter = Router();
billsRouter.get('/due', async (req, res) => {
  const { today } = await userCtx(req);
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : from.slice(0, 8) + '31';
  res.json({ items: await billsDue(req.userId!, parseBody(zDate, from), parseBody(zDate, to)) });
});
billsRouter.get('/summary', async (req, res) => {
  res.json(await requiredIncome(req.userId!));
});
/** Record a payment for a bill occurrence: creates a linked expense (once per occurrence). */
billsRouter.post('/:id/pay', async (req, res) => {
  const bill = await RecurringBill.findOne({ _id: req.params.id, userId: req.userId });
  if (!bill) throw notFound('Bill not found');
  const body = parseBody(z.object({ occurrence: zDate, date: zDate.optional(), amount: zMoney.optional(), paymentMethod: zOptStr(60), notes: zOptStr(2000) }), req.body);
  if (await Expense.exists({ userId: req.userId, billId: bill._id, billOccurrence: body.occurrence })) throw conflict('This bill occurrence is already marked as paid');
  const exp = await Expense.create({
    userId: req.userId, date: body.date ?? body.occurrence, amount: body.amount ?? bill.amount, categoryId: bill.categoryId, description: bill.name,
    merchant: bill.name, paymentMethod: body.paymentMethod ?? bill.paymentMethod, isRecurring: true, billId: bill._id, billOccurrence: body.occurrence, notes: body.notes,
  });
  await audit(req.userId!, 'Expense', exp._id, 'create', undefined, exp.toJSON(), `Payment for bill ${bill.name} (${body.occurrence})`);
  res.status(201).json(exp.toJSON());
});
billsRouter.use('/', billsCrud);

// ---------- Tasks ----------
const tasksCrud = crudRouter({
  model: Task, entity: 'Task', schema: taskSchema, searchFields: ['title', 'description', 'location', 'notes'],
  filterFields: ['status', 'category', 'priority'], dateField: 'date', sort: { date: 1, startTime: 1 }, audited: false, calendarKind: 'task',
});
export const tasksRouter = Router();
/** Set status of a single occurrence of a recurring task. */
tasksRouter.patch('/:id/occurrence', async (req, res) => {
  const body = parseBody(z.object({ date: zDate, status: z.enum(['not_started', 'in_progress', 'completed', 'cancelled']) }), req.body);
  const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
  if (!task) throw notFound('Task not found');
  if ((task.recurrence?.frequency ?? 'none') === 'none') task.status = body.status;
  else task.occurrenceStatus.set(body.date, body.status);
  await task.save();
  queueCalendarSync(req.userId!, 'task', task._id);
  res.json(task.toJSON());
});
tasksRouter.use('/', tasksCrud);


// ---------- Invoice templates ----------
export const invoiceTemplatesRouter = crudRouter({
  model: InvoiceTemplate, entity: 'InvoiceTemplate', schema: invoiceTemplateSchema, refs: { clientId: Client, incomeSourceId: IncomeSource },
  searchFields: ['name', 'clientName'], sort: { name: 1 }, audited: false,
});
