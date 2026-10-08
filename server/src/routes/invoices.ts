import { Router } from 'express';
import { z } from 'zod';
import { Invoice, Job, Income, Settings, Client, IncomeSource, User, DocumentModel } from '../models/index.js';
import { readDocumentFile } from '../services/google/drive.js';
import { invoiceSchema } from './schemas.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { zDate, zOptId } from '../utils/zod.js';
import { audit } from '../services/audit.js';
import { assertOwnedRefs, escapeRegex } from '../services/crud.js';
import { computeTotals, effectiveStatus, nextInvoiceNumber, releaseInvoiceNumber, renderInvoicePdf } from '../services/invoices.js';
import { userCtx } from '../utils/userCtx.js';
import { addDays } from '../utils/dates.js';
import { uploadInvoice, queueInvoiceUpload, queueDriveDelete } from '../services/google/drive.js';
import { queueCalendarSync, queueCalendarDelete } from '../services/google/calendar.js';
import { googleApis } from '../services/google/client.js';
import { queueTravelDay } from '../services/travel/index.js';
import { payerOf } from '../services/clients.js';
import { jobHours } from '../services/finance.js';
import { round2 } from '../utils/money.js';
import { emailRoute, sendUserEmailDetailed, type SendResult } from '../services/email.js';

const jobIncomeDescription = (job: any) => job.title || `Job – ${job.clientName ?? ''}${job.workType === 'subcontract' && job.contractorName ? ` (via ${job.contractorName})` : ''}`.trim();

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
  if (inv.status === 'paid') await settleInvoice(req.userId!, inv, today);
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
  if (inv.status === 'paid') await settleInvoice(req.userId!, inv, today); // saved as paid, or lines changed on a paid invoice
  await audit(req.userId!, 'Invoice', inv._id, 'update', before, inv.toJSON());
  queueCalendarSync(req.userId!, 'invoice', inv._id);
  queueInvoiceUpload(req.userId!, inv._id);
  res.json(withStatus(inv, today));
});

/**
 * An invoice has been paid, so the jobs on it have been paid: their income is marked received (created if a job had none),
 * at the amount on the invoice line, and each job gets that amount as its real figure.
 */
async function settleInvoice(userId: string, inv: any, today: string, paymentMethod?: string) {
  const paidDate = inv.paidDate ?? today;
  const lines = new Map<string, number>();
  for (const it of inv.items ?? []) if (it.jobId) lines.set(String(it.jobId), round2((lines.get(String(it.jobId)) ?? 0) + (it.amount ?? 0)));
  let incomeUpdated = 0, jobsUpdated = 0;
  const jobs = lines.size ? await Job.find({ _id: { $in: [...lines.keys()] }, userId }) : [];
  for (const job of jobs) {
    const amount = lines.get(String(job._id)) ?? job.amount ?? 0;
    const jb = job.toJSON();
    const statusBefore = job.status;
    if (amount > 0) job.amount = amount;
    job.amountEstimated = false;
    if (job.status !== 'cancelled' && job.date <= today) job.status = 'completed';
    if (job.isModified()) {
      await job.save();
      jobsUpdated++;
      await audit(userId, 'Job', job._id, 'update', jb, job.toJSON(), `Invoice ${inv.number} paid`);
      if (statusBefore !== job.status) { queueTravelDay(userId, job.date); queueCalendarSync(userId, 'job', job._id); }
    }
    if (!(amount > 0)) continue;
    const fields = { amount, date: job.date, ...payerOf(job), description: jobIncomeDescription(job), incomeSourceId: job.incomeSourceId, hoursWorked: jobHours(job) || undefined, status: 'paid', paidDate, invoiceId: inv._id, invoiceNumber: inv.number, ...(paymentMethod ? { paymentMethod } : {}) };
    const income = await Income.findOne({ userId, jobId: job._id });
    if (!income) {
      const created = await Income.create({ userId, jobId: job._id, ...fields });
      incomeUpdated++;
      await audit(userId, 'Income', created._id, 'create', undefined, created.toJSON(), `Invoice ${inv.number} paid`);
    } else if (income.status !== 'paid' || income.amount !== amount) {
      const prev = income.toJSON();
      income.set({ ...fields, paidDate: income.status === 'paid' && income.paidDate ? income.paidDate : paidDate });
      await income.save();
      incomeUpdated++;
      await audit(userId, 'Income', income._id, 'update', prev, income.toJSON(), `Invoice ${inv.number} paid`);
    }
  }
  // Income attached to the invoice without a job (e.g. added by hand)
  const others = await Income.find({ userId, invoiceId: inv._id, status: { $nin: ['paid', 'cancelled'] }, jobId: { $nin: [...lines.keys()] } });
  for (const i of others) {
    const prev = i.toJSON();
    i.status = 'paid'; i.paidDate = paidDate;
    if (paymentMethod) i.paymentMethod = paymentMethod;
    await i.save();
    incomeUpdated++;
    await audit(userId, 'Income', i._id, 'update', prev, i.toJSON(), `Invoice ${inv.number} paid`);
  }
  return { incomeUpdated, jobsUpdated };
}

/** Change status. Marking an invoice paid marks its jobs and their income paid too (pass updateIncome: false to leave them alone). */
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
  let incomeUpdated = 0, jobsUpdated = 0;
  if (body.status === 'paid' && body.updateIncome !== false) {
    ({ incomeUpdated, jobsUpdated } = await settleInvoice(req.userId!, inv, today, body.paymentMethod));
  } else if (body.status !== 'paid' && (body.updateIncome ?? before.status === 'paid')) {
    // No longer paid (or sent again): the income goes back to waiting
    const incomes = await Income.find({ userId: req.userId, invoiceId: inv._id, status: { $ne: 'cancelled' } });
    for (const i of incomes) {
      const prev = i.toJSON();
      if (i.status === 'paid') {
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
  res.json({ invoice: withStatus(inv, today), incomeUpdated, jobsUpdated });
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
  await releaseInvoiceNumber(req.userId!, inv.number, inv.issueDate);
  await audit(req.userId!, 'Invoice', inv._id, 'delete', inv.toJSON());
  queueCalendarDelete(req.userId!, inv.sync?.googleCalendarEventId);
  queueDriveDelete(req.userId!, inv.sync?.googleDriveFileId, `invoice ${inv.number}`);
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

/** Who an invoice would be emailed to and what the email would say. The address comes from Clients & contractors. */
/** Parking receipts saved on the jobs this invoice bills — they go out with the invoice. */
async function invoiceReceipts(userId: string, inv: any) {
  const jobIds = [...new Set((inv.items ?? []).map((i: any) => i.jobId && String(i.jobId)).filter(Boolean))];
  if (!jobIds.length) return [];
  const jobs = await Job.find({ userId, _id: { $in: jobIds }, parkingReceiptId: { $ne: null } }).select('parkingReceiptId clientName date').lean<any[]>();
  const docs = await DocumentModel.find({ userId, _id: { $in: jobs.map((j) => j.parkingReceiptId) } }).select('+storageKey').lean<any[]>();
  return docs.map((d) => {
    const job = jobs.find((j) => String(j.parkingReceiptId) === String(d._id));
    const ext = (d.originalName ?? '').match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (d.mimeType === 'application/pdf' ? '.pdf' : '.jpg');
    const filename = `Parking receipt ${job?.date ?? ''} ${job?.clientName ?? ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + ext;
    return { doc: d, id: String(d._id), filename, mimeType: d.mimeType || 'application/octet-stream' };
  });
}

async function sendDetails(userId: string, inv: any) {
  const [settings, user, client] = await Promise.all([
    Settings.findOne({ userId }).lean(), User.findById(userId).lean(),
    inv.clientId ? Client.findOne({ _id: inv.clientId, userId }).select('name email contactName').lean() : null,
  ]);
  const currency = user?.currency ?? 'AUD';
  const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(n);
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const business = settings?.invoice?.businessName || user?.name || '';
  const to = (client?.email || inv.clientEmail || '').trim();
  const greetName = ((client as any)?.contactName || inv.clientName || '').trim();
  const lines = [
    `Hi${greetName ? ` ${greetName}` : ''},`, '',
    `Please find attached invoice ${inv.number} for ${money(inv.total)}${inv.periodFrom && inv.periodTo ? `, covering ${day(inv.periodFrom)} to ${day(inv.periodTo)}` : ''}.`,
    ...(inv.dueDate ? [`Payment is due by ${day(inv.dueDate)}.`] : []),
    ...(inv.paymentDetails ? ['', `Payment details: ${inv.paymentDetails}`] : []),
    '', 'Thank you,', business,
  ];
  const receipts = await invoiceReceipts(userId, inv);
  if (receipts.length) lines.splice(lines.indexOf('Thank you,') - 1, 0, '', `${receipts.length === 1 ? 'The parking receipt is' : `${receipts.length} parking receipts are`} attached as well.`);
  return {
    to, toSource: client?.email ? 'client' as const : inv.clientEmail ? 'invoice' as const : null, clientId: inv.clientId ? String(inv.clientId) : null,
    subject: `Invoice ${inv.number}${business ? ` from ${business}` : ''}`, message: lines.join('\n').trim(),
    receipts, via: await emailRoute(userId), business, replyTo: settings?.invoice?.email || user?.email || undefined, settings, currency,
  };
}

r.get('/:id/send-details', async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  const d = await sendDetails(req.userId!, inv);
  res.json({ receipts: d.receipts.map((x) => ({ id: x.id, filename: x.filename, mimeType: x.mimeType })), to: d.to, toSource: d.toSource, clientId: d.clientId, subject: d.subject, message: d.message, via: d.via, sentAt: inv.sentAt ?? null, sentTo: inv.sentTo ?? null });
});

/** Email the invoice as a PDF. Goes to the address in Clients & contractors unless another is given; a draft becomes "sent". */
r.post('/:id/send', async (req, res) => {
  const { today } = await userCtx(req);
  const body = parseBody(z.object({ to: z.string().trim().email('Enter a valid email address').max(200).optional(), subject: z.string().trim().min(1).max(200).optional(), message: z.string().trim().min(1).max(5000).optional() }), req.body ?? {});
  const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'cancelled') throw badRequest('This invoice is cancelled.');
  const d = await sendDetails(req.userId!, inv);
  const to = body.to || d.to;
  if (!to) throw badRequest(`There is no email address for ${inv.clientName}. Add one in Clients & contractors, then send again.`);
  if (!z.string().email().safeParse(to).success) throw badRequest(`“${to}” is not a valid email address. Fix it in Clients & contractors.`);
  // Invoices only ever go out from the user's own Google account, so the client sees their address and it lands in their Gmail Sent
  if (d.via !== 'gmail') throw badRequest('Invoices are sent from your own Google account. Connect it in Settings → Integrations and allow it to send email, then send again.');
  const pdf = await renderInvoicePdf(inv, d.settings, d.currency);
  const filename = `${inv.number.replace(/[^\w.-]/g, '_')}.pdf`;
  // Parking receipts ride along (a missing file is skipped rather than stopping the invoice); Gmail allows 25 MB in all
  const extra: { filename: string; content: Buffer; contentType: string }[] = [];
  let bytes = pdf.length;
  for (const r of d.receipts) {
    try { const content = await readDocumentFile(req.userId!, r.doc); if (bytes + content.length > 20 * 1024 * 1024) continue; bytes += content.length; extra.push({ filename: r.filename, content, contentType: r.mimeType }); } catch { /* file gone */ }
  }
  let sent: SendResult;
  try {
    sent = await sendUserEmailDetailed(req.userId!, to, body.subject || d.subject, body.message || d.message, undefined, { attachments: [{ filename, content: pdf, contentType: 'application/pdf' }, ...extra], fromName: d.business || undefined, replyTo: d.replyTo }, { gmailOnly: true });
  } catch (e) {
    return res.status(502).json({ error: `The email could not be sent from your Google account: ${(e as Error).message}. Reconnect Google in Settings → Integrations if this keeps happening.` });
  }
  // Never call it sent unless a mail service really accepted it
  if (!sent.via) return res.status(502).json({ error: 'The email was not sent — no mail service accepted it. Reconnect your Google account in Settings → Integrations and allow it to send email.' });
  const before = inv.toJSON();
  inv.sentAt = new Date();
  inv.sentTo = to;
  if (inv.status === 'draft') inv.status = 'sent';
  await inv.save();
  await audit(req.userId!, 'Invoice', inv._id, 'update', before, inv.toJSON(), `Emailed to ${to}`);
  // A sent invoice's income is waiting to be paid
  if (before.status === 'draft') await Income.updateMany({ userId: req.userId, invoiceId: inv._id, status: 'expected' }, { status: 'pending' });
  queueCalendarSync(req.userId!, 'invoice', inv._id);
  res.json({ invoice: withStatus(inv, today), to, via: sent.via, receipts: extra.length, from: sent.from ?? null, googleError: sent.googleError ?? null });
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
