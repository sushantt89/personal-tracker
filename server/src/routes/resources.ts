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
import { round2 } from '../utils/money.js';

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
  // ?pay=unset → jobs/shifts still waiting for their actual pay (no amount, or only an estimate); ?pay=set → the rest
  extraFilter: (req, filter) => {
    if (req.query.pay === 'unset') Object.assign(filter, { $and: [{ $or: [{ amount: null }, { amount: 0 }, { amountEstimated: true }] }], status: filter.status ?? { $ne: 'cancelled' } });
    else if (req.query.pay === 'set') Object.assign(filter, { amount: { $gt: 0 }, amountEstimated: { $ne: true } });
  },
  hooks: {
    beforeCreate: async (req, data) => {
      await resolveClient(req.userId!, data, { create: true, address: data.address, incomeSourceId: data.incomeSourceId });
      await applyWorkArrangement(req.userId!, data);
      if (!data.hoursWorked) data.hoursWorked = (minutesBetween(data.startTime, data.endTime) ?? 0) / 60 || undefined;
      if (!data.amount) data.amountEstimated = false; // nothing to be an estimate of
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
 * Change several jobs at once: mark them all completed, or all paid (each at the amount already on it).
 * Cancelled jobs are left alone; jobs with no amount can't be marked paid — those need "Record pay".
 */
jobsRouter.post('/bulk', async (req, res) => {
  const body = parseBody(
    z.object({ jobIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1, 'Select at least one job').max(200), action: z.enum(['completed', 'paid']), paidDate: zDate.optional() }),
    req.body,
  );
  const userId = req.userId!;
  const { today } = await userCtx(req);
  const jobs = await Job.find({ _id: { $in: body.jobIds }, userId }).sort({ date: 1, startTime: 1 });
  const skipped = { cancelled: 0, noPay: 0 };
  let updated = 0;
  for (const job of jobs) {
    if (job.status === 'cancelled') { skipped.cancelled++; continue; }
    const before = job.toJSON();
    if (body.action === 'completed') {
      if (job.status === 'completed') continue;
      job.status = 'completed';
    } else {
      if (!job.amount || job.amount <= 0) { skipped.noPay++; continue; }
      job.amountEstimated = false; // paid at this amount, so it is the real figure
      if (job.date <= today) job.status = 'completed';
      const fields = { amount: job.amount, date: job.date, ...payerOf(job), description: jobIncomeDescription(job), incomeSourceId: job.incomeSourceId, hoursWorked: jobHours(job) || undefined, status: 'paid', paidDate: body.paidDate ?? today };
      const income = await Income.findOne({ userId, jobId: job._id });
      if (income?.status === 'paid' && !job.isModified()) continue; // already paid: nothing to do
      if (income) {
        if (income.status !== 'paid') {
          const prev = income.toJSON();
          income.set(fields);
          await income.save();
          await audit(userId, 'Income', income._id, 'update', prev, income.toJSON(), `Marked paid with job ${job._id}`);
        }
      } else {
        const created = await Income.create({ userId, jobId: job._id, ...fields });
        await audit(userId, 'Income', created._id, 'create', undefined, created.toJSON(), `Marked paid with job ${job._id}`);
      }
    }
    const statusChanged = before.status !== job.status;
    await job.save();
    await audit(userId, 'Job', job._id, 'update', before, job.toJSON(), body.action === 'paid' ? 'Marked paid (bulk)' : 'Marked completed (bulk)');
    if (statusChanged) { queueTravelDay(userId, job.date); queueCalendarSync(userId, 'job', job._id); }
    updated++;
  }
  res.json({ updated, skipped, notFound: body.jobIds.length - jobs.length });
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
      /** 'hours' = in proportion to each job's hours; 'equal' = the same amount for every job */
      split: z.enum(['hours', 'equal']).default('hours'),
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
  const byHours = body.split === 'hours' && hours.every((h) => h > 0);
  const weights = byHours ? hours : jobs.map(() => 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(body.total * 100);
  const shares = weights.map((w) => Math.floor((cents * w) / weightSum));
  shares[shares.length - 1] += cents - shares.reduce((a, b) => a + b, 0);
  const paidDate = body.paidDate ?? today;

  const out: any[] = [];
  for (const [i, job] of jobs.entries()) {
    const before = job.toJSON();
    job.amount = shares[i] / 100;
    job.amountEstimated = false; // this is the real figure now
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
  res.json({ updated: out.length, total: cents / 100, split: byHours ? 'hours' : 'equal', perHour: byHours ? Math.round((cents / weightSum)) / 100 : null, jobs: out });
});
/**
 * Pencil in what you expect to be paid for jobs whose pay isn't known yet, so forecasts (dashboard, Assistant) can count it.
 * The amount is flagged as an estimate and the linked income stays "expected"; Record pay later replaces it with the real figure.
 */
jobsRouter.post('/expected-pay', async (req, res) => {
  const body = parseBody(
    z.object({
      jobIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1, 'Choose at least one job').max(200),
      /** perHour: each job = its hours × value · perJob: each job = value · total: value shared equally across the jobs */
      mode: z.enum(['perHour', 'perJob', 'total']),
      value: zMoney.refine((n) => n > 0, 'Enter an amount above zero'),
    }),
    req.body,
  );
  const userId = req.userId!;
  const jobs = await Job.find({ _id: { $in: body.jobIds }, userId, status: { $ne: 'cancelled' } }).sort({ date: 1, startTime: 1 });
  if (jobs.length !== new Set(body.jobIds).size) throw badRequest('Some of those jobs could not be found (or are cancelled). Refresh and try again.');
  if (jobs.some((j) => j.invoiceId)) throw conflict('One of those jobs is on an invoice — its amount is set by the invoice.');
  if (body.mode === 'perHour' && jobs.some((j) => !(jobHours(j) > 0))) throw badRequest('Some of those jobs have no hours, so an hourly rate can’t be applied. Use “per job” or add their hours first.');
  const cents = Math.round(body.value * 100);
  const each = Math.floor(cents / jobs.length);
  const out: any[] = [];
  let skippedPaid = 0;
  for (const [i, job] of jobs.entries()) {
    const income = await Income.findOne({ userId, jobId: job._id });
    if (income?.status === 'paid') { skippedPaid++; continue; } // already paid for real: leave it alone
    const before = job.toJSON();
    job.amount = body.mode === 'perHour' ? round2(jobHours(job) * body.value) : body.mode === 'perJob' ? body.value : (each + (i === jobs.length - 1 ? cents - each * jobs.length : 0)) / 100;
    job.amountEstimated = true;
    await job.save();
    await audit(userId, 'Job', job._id, 'update', before, job.toJSON(), 'Expected pay set');
    const fields = { amount: job.amount, date: job.date, ...payerOf(job), description: jobIncomeDescription(job), incomeSourceId: job.incomeSourceId, hoursWorked: jobHours(job) || undefined };
    if (income) {
      const prev = income.toJSON();
      income.set({ ...fields, status: income.status === 'cancelled' ? 'expected' : income.status });
      await income.save();
      await audit(userId, 'Income', income._id, 'update', prev, income.toJSON(), `Expected pay set for job ${job._id}`);
    } else {
      const created = await Income.create({ userId, jobId: job._id, status: 'expected', ...fields });
      await audit(userId, 'Income', created._id, 'create', undefined, created.toJSON(), `Expected pay set for job ${job._id}`);
    }
    out.push(job.toJSON());
  }
  res.json({ updated: out.length, skippedPaid, total: round2(out.reduce((a, j) => a + (j.amount ?? 0), 0)), jobs: out });
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
      // Marking a job's income as received confirms the amount: the job stops being an estimate
      if (doc.jobId && doc.status === 'paid' && (before as any).status !== 'paid') await Job.updateOne({ _id: doc.jobId, userId: req.userId, amountEstimated: true }, { amountEstimated: false, amount: doc.amount });
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
const zIds = z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1, 'Select at least one record').max(200);

/** Delete several income records at once. Linked jobs are kept, exactly as when one record is deleted. */
incomeRouter.post('/bulk-delete', async (req, res) => {
  const body = parseBody(z.object({ ids: zIds }), req.body);
  const docs = await Income.find({ _id: { $in: body.ids }, userId: req.userId });
  for (const d of docs) {
    await d.deleteOne();
    await audit(req.userId!, 'Income', d._id, 'delete', d.toJSON(), 'Deleted with others (bulk)');
  }
  res.json({ deleted: docs.length, notFound: body.ids.length - docs.length });
});

/**
 * Mark several income records as received, optionally correcting the amounts to what was actually paid:
 *  - asis:  keep each amount
 *  - each:  an actual amount per record
 *  - total: one amount for all of them, shared by hours (or equally when hours aren't known for every record)
 * `dryRun` returns what would happen without saving, so the screen can show it first.
 */
incomeRouter.post('/bulk-pay', async (req, res) => {
  const body = parseBody(
    z.object({
      ids: zIds,
      mode: z.enum(['asis', 'each', 'total']).default('asis'),
      amounts: z.array(z.object({ id: z.string(), amount: zMoney })).max(200).optional(),
      total: zMoney.optional(),
      split: z.enum(['hours', 'equal']).default('hours'),
      paidDate: zDate.optional(),
      dryRun: z.boolean().default(false),
    }),
    req.body,
  );
  const userId = req.userId!;
  const { today } = await userCtx(req);
  const all = await Income.find({ _id: { $in: body.ids }, userId }).sort({ date: 1, createdAt: 1 });
  const docs = all.filter((d) => d.status !== 'cancelled');
  const cancelled = all.length - docs.length;
  if (!docs.length) throw badRequest('None of the selected records can be marked as paid (they are cancelled or no longer exist).');
  const jobs = new Map((await Job.find({ _id: { $in: docs.map((d) => d.jobId).filter(Boolean) }, userId })).map((j) => [String(j._id), j]));
  const jobOf = (d: any) => (d.jobId ? jobs.get(String(d.jobId)) : undefined);
  const hoursOf = (d: any) => d.hoursWorked || (jobOf(d) ? jobHours(jobOf(d)) : 0) || 0;

  // Work out the new amount for each record, in cents so the shares of a total add up exactly
  let newCents = docs.map((d) => Math.round(d.amount * 100));
  let split: 'hours' | 'equal' | null = null, perHour: number | null = null;
  if (body.mode === 'each') {
    const given = new Map((body.amounts ?? []).map((a) => [a.id, a.amount]));
    newCents = docs.map((d, i) => (given.has(String(d._id)) ? Math.round(given.get(String(d._id))! * 100) : newCents[i]));
  } else if (body.mode === 'total') {
    if (!body.total || body.total <= 0) throw badRequest('Enter the total amount you were paid');
    const hours = docs.map(hoursOf);
    const byHours = body.split === 'hours' && hours.every((h) => h > 0);
    const weights = byHours ? hours : docs.map(() => 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const cents = Math.round(body.total * 100);
    newCents = weights.map((w) => Math.floor((cents * w) / weightSum));
    newCents[newCents.length - 1] += cents - newCents.reduce((a, b) => a + b, 0);
    split = byHours ? 'hours' : 'equal';
    perHour = byHours ? Math.round(cents / weightSum) / 100 : null;
  }
  if (body.mode !== 'asis') {
    const invoiced = docs.filter((d, i) => d.invoiceId && newCents[i] !== Math.round(d.amount * 100));
    if (invoiced.length) throw conflict(`${invoiced.length} of these ${invoiced.length === 1 ? 'is' : 'are'} on an invoice — the amount is set by the invoice. Leave ${invoiced.length === 1 ? 'it' : 'them'} out, or keep the amounts as they are.`);
    if (newCents.some((c) => c <= 0)) throw badRequest('Every record needs an amount above zero');
  }

  const rows = docs.map((d, i) => ({
    id: String(d._id), date: d.date, label: d.clientName || d.description || 'Income', current: d.amount, amount: newCents[i] / 100,
    hours: round2(hoursOf(d)), status: d.status, estimated: Boolean(jobOf(d)?.amountEstimated), invoiced: Boolean(d.invoiceId),
  }));
  const summary = { rows, count: rows.length, total: round2(newCents.reduce((a, b) => a + b, 0) / 100), currentTotal: round2(docs.reduce((a, d) => a + d.amount, 0)), split, perHour, skipped: { cancelled }, notFound: body.ids.length - all.length };
  if (body.dryRun) return res.json({ ...summary, saved: false });

  const paidDate = body.paidDate ?? today;
  for (const [i, d] of docs.entries()) {
    const amount = newCents[i] / 100;
    const before = d.toJSON();
    const wasPaid = d.status === 'paid';
    d.amount = amount;
    d.status = 'paid';
    if (!wasPaid || !d.paidDate) d.paidDate = paidDate;
    if (d.isModified()) {
      await d.save();
      await audit(userId, 'Income', d._id, 'update', before, d.toJSON(), 'Marked paid (bulk)');
    }
    // The job this came from now has its real figure
    const job = jobOf(d);
    if (job && job.status !== 'cancelled') {
      const jb = job.toJSON();
      const statusBefore = job.status;
      if (!job.invoiceId) job.amount = amount;
      job.amountEstimated = false;
      if (job.date <= today) job.status = 'completed';
      if (job.isModified()) {
        await job.save();
        await audit(userId, 'Job', job._id, 'update', jb, job.toJSON(), 'Pay recorded from income (bulk)');
        if (statusBefore !== job.status) { queueTravelDay(userId, job.date); queueCalendarSync(userId, 'job', job._id); }
      }
    }
  }
  res.json({ ...summary, saved: true });
});
incomeRouter.use('/', incomeCrud);

// ---------- Expenses ----------
export const expensesRouter = crudRouter({
  model: Expense, entity: 'Expense', schema: expenseSchema,
  refs: { categoryId: Category, billId: RecurringBill, contractorId: Client },
  searchFields: ['merchant', 'description', 'notes', 'paymentMethod'],
  filterFields: ['categoryId', 'paymentMethod', 'billId', 'isRecurring', 'contractorId'],
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
  hooks: {
    // "Add to Google Calendar" on the form is stored on the record's sync settings (dotted paths keep the linked event id)
    beforeCreate: (_req, data) => {
      if (data.addToGoogle !== undefined) data.sync = { calendarInclude: data.addToGoogle === true, calendarOptOut: data.addToGoogle === false };
      delete data.addToGoogle;
    },
    beforeUpdate: (_req, data) => {
      if (data.addToGoogle !== undefined) { data['sync.calendarInclude'] = data.addToGoogle === true; data['sync.calendarOptOut'] = data.addToGoogle === false; }
      delete data.addToGoogle;
    },
  },
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
