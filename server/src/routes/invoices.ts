import { Router } from 'express';
import { z } from 'zod';
import { Invoice, Job, Income, Settings, Client, IncomeSource, User } from '../models/index.js';
import { invoiceSchema } from './schemas.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { zDate, zOptId } from '../utils/zod.js';
import { audit } from '../services/audit.js';
import { assertOwnedRefs, escapeRegex } from '../services/crud.js';
import { computeTotals, effectiveStatus, nextInvoiceNumber, renderInvoicePdf } from '../services/invoices.js';
import { userCtx } from '../utils/userCtx.js';
import { addDays } from '../utils/dates.js';
import { uploadInvoice, queueInvoiceUpload } from '../services/google/drive.js';
import { queueCalendarSync, queueCalendarDelete } from '../services/google/calendar.js';
import { googleApis } from '../services/google/client.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r = Router();

const withStatus = (inv: any, today: string) => ({ ...inv.toJSON(), effectiveStatus: effectiveStatus(inv, today) });

/** Build items/totals and validate linked jobs belong to the user and aren't on another invoice. */
async function prepare(userId: string, data: any, currentInvoiceId?: string) {
  await assertOwnedRefs(userId, data, { clientId: Client, incomeSourceId: IncomeSource });
  const jobIds = data.items.map((i: any) => i.jobId).filter(Boolean);
  if (jobIds.length) {
    const jobs = await Job.find({ _id: { $in: jobIds }, userId }).select('invoiceId').lean();
    if (jobs.length !== new Set(jobIds.map(String)).size) throw badRequest('One or more jobs were not found');
    const taken = jobs.filter((j) => j.invoiceId && String(j.invoiceId) !== currentInvoiceId);
    if (taken.length) throw conflict(`${taken.length} job(s) are already on another invoice`);
  }
  const settings = await Settings.findOne({ userId }).lean();
  const gstRate = data.gstRate ?? (settings?.invoice?.gstRegistered ? settings.invoice.gstRate : 0);
  const totals = computeTotals(data.items, gstRate);
  data.items = data.items.map((i: any, idx: number) => ({ ...i, amount: totals.lines[idx] }));
  Object.assign(data, { gstRate, subtotal: totals.subtotal, gstAmount: totals.gstAmount, total: totals.total });
  if (data.dueDate && data.dueDate < data.issueDate) throw badRequest('Due date cannot be before the issue date');
  if (data.status === 'paid' && !data.paidDate) data.paidDate = data.issueDate;
  return jobIds;
}

async function linkRecords(userId: string, invoice: any, jobIds: string[]) {
  await Job.updateMany({ userId, invoiceId: invoice._id, _id: { $nin: jobIds } }, { invoiceId: null });
  await Income.updateMany({ userId, invoiceId: invoice._id, jobId: { $nin: jobIds } }, { invoiceId: null, invoiceNumber: null });
  if (jobIds.length) {
    await Job.updateMany({ userId, _id: { $in: jobIds } }, { invoiceId: invoice._id });
    await Income.updateMany({ userId, jobId: { $in: jobIds } }, { invoiceId: invoice._id, invoiceNumber: invoice.number });
  }
}

r.get('/', async (req, res) => {
  const { today } = await userCtx(req);
  const filter: any = { userId: req.userId };
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ number: re }, { clientName: re }, { notes: re }, { 'items.description': re }];
  }
  for (const f of ['clientId', 'incomeSourceId']) if (typeof req.query[f] === 'string' && req.query[f]) filter[f] = req.query[f];
  if (typeof req.query.from === 'string' && req.query.from) filter.issueDate = { ...(filter.issueDate ?? {}), $gte: req.query.from };
  if (typeof req.query.to === 'string' && req.query.to) filter.issueDate = { ...(filter.issueDate ?? {}), $lte: req.query.to };
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status === 'overdue') Object.assign(filter, { status: 'sent', dueDate: { $lt: today } });
  else if (status === 'unpaid') filter.status = { $in: ['draft', 'sent'] };
  else if (status) filter.status = status;
  const items = await Invoice.find(filter).sort({ issueDate: -1, number: -1 }).limit(1000);
  res.json({ items: items.map((i) => withStatus(i, today)), total: items.length });
});

r.get('/next-number', async (req, res) => {
  const { today } = await userCtx(req);
  const date = typeof req.query.date === 'string' ? parseBody(zDate, req.query.date) : today;
  res.json({ number: await nextInvoiceNumber(req.userId!, date, false) });
});

/** Completed (or all) jobs not yet invoiced, for custom date range invoice generation. */
r.get('/candidates', async (req, res) => {
  const q = parseBody(
    z.object({ from: zDate, to: zDate, incomeSourceId: zOptId, clientId: zOptId, contractorId: zOptId, workType: z.enum(['own', 'subcontract']).optional(), includeScheduled: z.enum(['true', 'false']).optional() }),
    req.query,
  );
  const filter: any = { userId: req.userId, date: { $gte: q.from, $lte: q.to }, invoiceId: null, status: q.includeScheduled === 'true' ? { $in: ['completed', 'scheduled', 'in_progress'] } : 'completed' };
  if (q.incomeSourceId) filter.incomeSourceId = q.incomeSourceId;
  if (q.clientId) filter.clientId = q.clientId;
  if (q.contractorId) filter.contractorId = q.contractorId;
  // Billing a contractor → only jobs done under contractors; billing a client directly → only your own jobs
  // Shifts worked as an employee are paid as wages and never go on an invoice
  if (q.workType === 'subcontract') filter.workType = 'subcontract';
  else if (q.workType === 'own') filter.workType = { $nin: ['subcontract', 'employee'] };
  else filter.workType = { $ne: 'employee' };
  const jobs = await Job.find(filter).sort({ date: 1, startTime: 1 });
  const total = jobs.reduce((a, j) => a + (j.amount ?? 0), 0);
  res.json({ items: jobs.map((j) => j.toJSON()), total: Math.round(total * 100) / 100 });
});

r.get('/:id', async (req, res) => {
  const { today } = await userCtx(req);
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  res.json(withStatus(inv, today));
});

r.post('/', async (req, res) => {
  const { today } = await userCtx(req);
  const data: any = parseBody(invoiceSchema, req.body);
  const jobIds = await prepare(req.userId!, data);
  if (data.number) {
    if (await Invoice.exists({ userId: req.userId, number: data.number })) throw conflict(`Invoice number ${data.number} already exists`);
  } else data.number = await nextInvoiceNumber(req.userId!, data.issueDate);
  const inv = await Invoice.create({ ...data, userId: req.userId });
  await linkRecords(req.userId!, inv, jobIds);
  await audit(req.userId!, 'Invoice', inv._id, 'create', undefined, inv.toJSON());
  queueCalendarSync(req.userId!, 'invoice', inv._id);
  queueInvoiceUpload(req.userId!, inv._id);
  res.status(201).json(withStatus(inv, today));
});

r.put('/:id', async (req, res) => {
  const { today } = await userCtx(req);
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  const data: any = parseBody(invoiceSchema, req.body);
  const jobIds = await prepare(req.userId!, data, String(inv._id));
  if (!data.number) data.number = inv.number;
  if (data.number !== inv.number && (await Invoice.exists({ userId: req.userId, number: data.number }))) throw conflict(`Invoice number ${data.number} already exists`);
  const before = inv.toJSON();
  inv.set(data);
  if (!data.dueDate) inv.set('dueDate', undefined); // due date removed
  await inv.save();
  await linkRecords(req.userId!, inv, jobIds);
  await audit(req.userId!, 'Invoice', inv._id, 'update', before, inv.toJSON());
  queueCalendarSync(req.userId!, 'invoice', inv._id);
  queueInvoiceUpload(req.userId!, inv._id);
  res.json(withStatus(inv, today));
});

/** Change status. When marking paid, optionally mark the linked income records paid too (explicit opt-in). */
r.post('/:id/status', async (req, res) => {
  const { today } = await userCtx(req);
  const body = parseBody(z.object({ status: z.enum(['draft', 'sent', 'paid', 'cancelled']), paidDate: zDate.optional(), updateIncome: z.boolean().optional(), paymentMethod: z.string().max(60).optional() }), req.body);
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  const before = inv.toJSON();
  inv.status = body.status;
  inv.paidDate = body.status === 'paid' ? body.paidDate ?? today : undefined;
  await inv.save();
  await audit(req.userId!, 'Invoice', inv._id, 'update', before, inv.toJSON(), `Status → ${body.status}`);
  let incomeUpdated = 0;
  if (body.updateIncome) {
    const incomes = await Income.find({ userId: req.userId, invoiceId: inv._id, status: { $ne: 'cancelled' } });
    for (const i of incomes) {
      const prev = i.toJSON();
      if (body.status === 'paid') {
        i.status = 'paid';
        i.paidDate = inv.paidDate;
        if (body.paymentMethod) i.paymentMethod = body.paymentMethod;
      } else if (i.status === 'paid') {
        i.status = 'pending';
        i.paidDate = undefined;
      } else if (body.status === 'sent') {
        i.status = 'pending';
      } else continue;
      await i.save();
      incomeUpdated++;
      await audit(req.userId!, 'Income', i._id, 'update', prev, i.toJSON(), `Invoice ${inv.number} status → ${body.status}`);
    }
  }
  queueCalendarSync(req.userId!, 'invoice', inv._id);
  queueInvoiceUpload(req.userId!, inv._id);
  res.json({ invoice: withStatus(inv, today), incomeUpdated });
});

r.post('/:id/duplicate', async (req, res) => {
  const { today } = await userCtx(req);
  const src = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!src) throw notFound('Invoice not found');
  const settings = await Settings.findOne({ userId: req.userId }).lean();
  const number = await nextInvoiceNumber(req.userId!, today);
  const copy = await Invoice.create({
    userId: req.userId, number, issueDate: today, dueDate: src.dueDate ? addDays(today, settings?.invoice?.paymentTermsDays ?? 7) : undefined,
    incomeSourceId: src.incomeSourceId, clientId: src.clientId, clientName: src.clientName, billToType: src.billToType, clientAddress: src.clientAddress, clientEmail: src.clientEmail,
    // Job links are not copied: a job can only be invoiced once
    items: src.items.map((i) => ({ date: i.date, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount })),
    subtotal: src.subtotal, gstRate: src.gstRate, gstAmount: src.gstAmount, total: src.total, notes: src.notes, paymentDetails: src.paymentDetails, status: 'draft',
  });
  await audit(req.userId!, 'Invoice', copy._id, 'create', undefined, copy.toJSON(), `Duplicated from ${src.number}`);
  res.status(201).json(withStatus(copy, today));
});

r.delete('/:id', async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  await Job.updateMany({ userId: req.userId, invoiceId: inv._id }, { invoiceId: null });
  await Income.updateMany({ userId: req.userId, invoiceId: inv._id }, { invoiceId: null, invoiceNumber: null });
  await inv.deleteOne();
  await audit(req.userId!, 'Invoice', inv._id, 'delete', inv.toJSON());
  queueCalendarDelete(req.userId!, inv.sync?.googleCalendarEventId);
  res.json({ ok: true });
});

r.get('/:id/pdf', async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!inv) throw notFound('Invoice not found');
  const [settings, user] = await Promise.all([Settings.findOne({ userId: req.userId }).lean(), User.findById(req.userId).lean()]);
  const pdf = await renderInvoicePdf(inv, settings, user?.currency ?? 'AUD');
  const safe = inv.number.replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${safe}.pdf"`);
  res.send(pdf);
});

/** Upload the PDF to Google Drive (or replace the file uploaded before — never a duplicate). */
r.post('/:id/drive', async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).select('_id').lean();
  if (!inv) throw notFound('Invoice not found');
  if (!(await googleApis(req.userId!))) return res.status(409).json({ error: 'Google Drive is not connected. Connect it in Settings → Integrations.' });
  try {
    const result = await uploadInvoice(req.userId!, inv._id);
    res.json({ uploaded: true, ...result });
  } catch (e) {
    res.status(502).json({ error: `Upload to Google Drive failed: ${(e as Error).message}` });
  }
});

export default r;
