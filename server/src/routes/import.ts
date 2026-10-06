import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import { parseMessage, parseRoster, parseShiftCard, normaliseForHash, formatAddress, type ParseResult } from '../services/parser/index.js';
import { extractText, isHeic, OCR_IMAGE_TYPES } from '../services/ocr/engine.js';
import { env } from '../config/env.js';
import { ImportBatch, Job, Income, IncomeSource, Invoice, Settings, Client } from '../models/index.js';
import { WORK_TYPES } from '../models/Job.js';
import { queueCalendarSync } from '../services/google/calendar.js';
import { queueTravelDay } from '../services/travel/index.js';
import { googleApis } from '../services/google/client.js';
import { parseBody } from '../middleware/validate.js';
import { userCtx } from '../utils/userCtx.js';
import { escapeRegex } from '../services/crud.js';
import { resolveClient, applyWorkArrangement, payerOf } from '../services/clients.js';
import { jobIncomeDescription } from './resources.js';
import { audit } from '../services/audit.js';
import { conflict, badRequest } from '../utils/httpError.js';
import { zDate, zOptTime, zOptMoney, zMoney, zOptId, zOptStr, zAddress } from '../utils/zod.js';
import { minutesBetween } from '../utils/dates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r = Router();
const hashOf = (text: string) => crypto.createHash('sha256').update(normaliseForHash(text)).digest('hex');

async function findDuplicateJob(userId: string, j: { date?: string; startTime?: string; clientName?: string }) {
  if (!j.date || !j.clientName) return null;
  const q: any = { userId, date: j.date, clientName: new RegExp(`^${escapeRegex(j.clientName.trim())}$`, 'i'), status: { $ne: 'cancelled' } };
  if (j.startTime) q.startTime = j.startTime;
  const dup = await Job.findOne(q).select('_id').lean();
  return dup ? String(dup._id) : null;
}

/** Shared by pasted text and uploaded roster photos: add duplicate checks, payment matches and suggestions. Nothing is saved. */
async function reviewPayload(userId: string, text: string, result: ParseResult, format: 'roster' | 'message') {

  for (const j of result.jobs) j.duplicateOfJobId = await findDuplicateJob(userId, j);

  // Suggest matching expected income / invoices for payment messages
  const paymentMatches: Record<string, { incomeId?: string; invoiceId?: string; label: string }[]> = {};
  for (const p of result.payments) {
    const matches: { incomeId?: string; invoiceId?: string; label: string }[] = [];
    if (p.reference) {
      const inv = await Invoice.findOne({ userId, number: new RegExp(`^${escapeRegex(p.reference)}$`, 'i') }).lean();
      if (inv) matches.push({ invoiceId: String(inv._id), label: `Invoice ${inv.number} · ${inv.clientName} · $${inv.total}` });
    }
    const q: any = { userId, status: { $in: ['expected', 'pending'] }, amount: p.amount };
    if (p.payer) q.clientName = new RegExp(escapeRegex(p.payer.split(' ')[0]), 'i');
    const incomes = await Income.find(q).sort({ date: -1 }).limit(5).lean();
    for (const i of incomes) matches.push({ incomeId: String(i._id), label: `${i.date} · ${i.clientName ?? i.description ?? 'Income'} · $${i.amount} (${i.status})` });
    paymentMatches[p.tempId] = matches;
  }

  const hash = hashOf(text);
  const previous = await ImportBatch.findOne({ userId, messageHash: hash }).sort({ createdAt: -1 }).lean();
  const jobSources = await IncomeSource.find({ userId, archived: { $ne: true } }).sort({ isJobBased: -1, name: 1 }).lean();
  // A roster is shift work for an employer: prefer an income source already set up that way
  const employeeSource = format === 'roster' ? jobSources.find((s) => s.workType === 'employee') : undefined;
  if (format === 'roster') return {
    ...result,
    format,
    messageHash: hash,
    alreadyImported: previous ? { at: previous.createdAt, jobCount: previous.jobIds.length } : null,
    suggestedIncomeSourceId: employeeSource ? String(employeeSource._id) : null,
    suggestedWorkType: 'employee',
    suggestedContractorId: null,
    paymentMatches,
  };
  return {
    ...result,
    format,
    messageHash: hash,
    alreadyImported: previous ? { at: previous.createdAt, jobCount: previous.jobIds.length } : null,
    suggestedIncomeSourceId: jobSources[0] ? String(jobSources[0]._id) : null,
    suggestedWorkType: jobSources[0]?.workType ?? 'own',
    suggestedContractorId: jobSources[0]?.contractorId ? String(jobSources[0].contractorId) : null,
    paymentMatches,
    ...(await publisherSuggestion(userId, (result as any).publisher, jobSources)),
  };
}

/**
 * A shift screen names who published it. Use that as the contractor the work is done under:
 * an existing contractor with that name (and its income source) if there is one, otherwise the name for a new one.
 */
async function publisherSuggestion(userId: string, publisher: string | undefined, sources: any[]) {
  if (!publisher) return {};
  const existing = await Client.findOne({ userId, name: new RegExp(`^${escapeRegex(publisher)}$`, 'i') }).lean();
  const source = existing ? sources.find((s) => String(s.contractorId ?? '') === String(existing._id)) : undefined;
  return {
    suggestedWorkType: source?.workType === 'employee' ? 'employee' : 'subcontract',
    suggestedContractorId: existing ? String(existing._id) : null,
    suggestedContractorName: existing?.name ?? publisher,
    ...(source ? { suggestedIncomeSourceId: String(source._id) } : {}),
  };
}

/** A roster (labelled start/finish times or a list of dated shifts) is read by the roster parser, anything else as a message. */
function analyse(text: string, today: string, employer?: string): { result: ParseResult; format: 'roster' | 'message' } {
  // A single "shift details" screen from a rostering app: one job at a client's place, published by an agency
  const card = parseShiftCard(text, { today });
  if (card) return { result: card, format: 'message' };
  const roster = parseRoster(text, { today, employer });
  return roster ? { result: roster, format: 'roster' } : { result: parseMessage(text, { today }), format: 'message' };
}

/** Step 1: analyse pasted text. Nothing is saved. */
r.post('/parse', async (req, res) => {
  const { text, employer } = parseBody(z.object({ text: z.string().min(1, 'Paste a message first').max(10000, 'Message is too long'), employer: zOptStr(120) }), req.body);
  const { today } = await userCtx(req);
  const { result, format } = analyse(text, today, employer ?? undefined);
  res.json(await reviewPayload(req.userId!, text, result, format));
});

const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => ([...OCR_IMAGE_TYPES, 'application/pdf'].includes(file.mimetype) || isHeic(file.mimetype, file.originalname) ? cb(null, true) : cb(new Error('Upload a screenshot or photo (JPG, PNG, WebP, HEIC) or a PDF'))),
});

/** Step 1 for a roster screenshot/photo: read the text out of the image, then analyse it like pasted text. Nothing is saved. */
r.post('/roster', rosterUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose a roster screenshot or photo first');
  const { employer } = parseBody(z.object({ employer: zOptStr(120) }), req.body ?? {});
  const { today } = await userCtx(req);
  const mime = isHeic(req.file.mimetype, req.file.originalname) ? 'image/heic' : req.file.mimetype;
  let ocr;
  try {
    ocr = await extractText(req.file.buffer, mime);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const text = ocr.text.trim().slice(0, 10000);
  if (!text) throw badRequest('No text could be read from that image. Try a sharper screenshot, or paste the roster as text instead.');
  const { result, format } = analyse(text, today, employer ?? undefined);
  if (ocr.source !== 'pdf-text' && ocr.confidence < 60) result.warnings.unshift('The image was hard to read — please check every date and time.');
  if (!result.jobs.length && !result.payments.length) result.warnings.unshift('No shifts could be found in that image. The text that was read is shown in the box so you can fix it and analyse again.');
  res.json({ ...(await reviewPayload(req.userId!, text, result, format)), text, ocrConfidence: ocr.confidence });
});

const commitJob = z.object({
  clientName: z.string().trim().min(1, 'Client name is required').max(120),
  date: zDate,
  startTime: zOptTime,
  endTime: zOptTime,
  amount: zOptMoney,
  /** The amount is an estimate (e.g. roster hours × expected hourly rate); real pay is recorded later */
  amountEstimated: z.boolean().optional(),
  hoursWorked: z.coerce.number().min(0).max(24).optional().nullable(),
  address: zAddress,
  description: zOptStr(2000),
  tasks: z.array(z.string().max(300)).max(50).optional(),
  rooms: z.coerce.number().int().min(0).max(100).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).max(100).optional().nullable(),
  specialInstructions: zOptStr(2000),
  meetingPoint: zOptStr(300),
  sourceText: zOptStr(5000),
  incomeSourceId: zOptId,
  workType: z.enum(WORK_TYPES).optional(),
  contractorId: zOptId,
  contractorName: zOptStr(120),
});
const commitPayment = z.object({
  amount: zMoney,
  date: zDate,
  payer: zOptStr(120),
  reference: zOptStr(60),
  description: zOptStr(500),
  incomeSourceId: zOptId,
  matchIncomeId: zOptId,
  paymentMethod: zOptStr(60),
});

/** Step 2: create records from the reviewed (and possibly edited) data. */
r.post('/commit', async (req, res) => {
  const body = parseBody(
    z.object({
      sourceMessage: z.string().max(10000).default(''),
      incomeSourceId: zOptId,
      workType: z.enum(WORK_TYPES).optional(),
      contractorId: zOptId,
      contractorName: zOptStr(120),
      createIncome: z.boolean().default(true),
      /** false = keep these jobs out of Google Calendar */
      syncCalendar: z.boolean().default(true),
      allowDuplicates: z.boolean().default(false),
      jobs: z.array(commitJob).max(100).default([]),
      payments: z.array(commitPayment).max(100).default([]),
    }),
    req.body,
  );
  const userId = req.userId!;
  if (!body.jobs.length && !body.payments.length) throw badRequest('Nothing to import');
  if (body.incomeSourceId && !(await IncomeSource.exists({ _id: body.incomeSourceId, userId }))) throw badRequest('Unknown income source');

  const hash = body.sourceMessage ? hashOf(body.sourceMessage) : undefined;
  if (!body.allowDuplicates) {
    if (hash && (await ImportBatch.exists({ userId, messageHash: hash }))) throw conflict('This message has already been imported. Tick "import anyway" to import it again.');
    const dups: string[] = [];
    for (const j of body.jobs) if (await findDuplicateJob(userId, j)) dups.push(`${j.clientName} on ${j.date}${j.startTime ? ' at ' + j.startTime : ''}`);
    if (dups.length) throw conflict(`Possible duplicate jobs already exist: ${dups.join('; ')}`, { duplicates: dups });
  }

  const createdJobs: any[] = [], createdIncome: any[] = [], updatedIncome: any[] = [];
  try {
    for (const j of body.jobs) {
      const incomeSourceId = j.incomeSourceId ?? body.incomeSourceId ?? null;
      const address = j.address ? { ...j.address, formatted: j.address.formatted || formatAddress(j.address) } : undefined;
      const data: any = {
        ...j, incomeSourceId, address, sourceMessage: body.sourceMessage?.slice(0, 10000),
        hoursWorked: j.hoursWorked ?? ((minutesBetween(j.startTime, j.endTime) ?? 0) / 60 || undefined),
        status: 'scheduled', title: j.description ? undefined : undefined,
      };
      delete data.sourceText;
      if (!data.amount) data.amountEstimated = false;
      data.workType = j.workType ?? body.workType;
      data.contractorId = j.contractorId ?? body.contractorId ?? null;
      data.contractorName = j.contractorName ?? body.contractorName;
      if (data.workType === undefined) delete data.workType; // inherit from income source
      await resolveClient(userId, data, { create: true, address, incomeSourceId });
      await applyWorkArrangement(userId, data);
      const job = await Job.create({ ...data, userId, ...(body.syncCalendar ? {} : { sync: { calendarOptOut: true } }) });
      createdJobs.push(job);
      await audit(userId, 'Job', job._id, 'create', undefined, job.toJSON(), 'Paste & Import');
      if (body.createIncome && job.amount && job.amount > 0) {
        const inc = await Income.create({
          userId, date: job.date, amount: job.amount, incomeSourceId, ...payerOf(job),
          description: jobIncomeDescription(job), hoursWorked: job.hoursWorked, status: 'expected', jobId: job._id,
        });
        createdIncome.push(inc);
        await audit(userId, 'Income', inc._id, 'create', undefined, inc.toJSON(), 'Paste & Import');
      }
    }
    for (const p of body.payments) {
      if (p.matchIncomeId) {
        const inc = await Income.findOne({ _id: p.matchIncomeId, userId });
        if (!inc) throw badRequest('Matched income record not found');
        const prev = inc.toJSON();
        inc.set({ status: 'paid', paidDate: p.date, paymentMethod: p.paymentMethod ?? inc.paymentMethod });
        await inc.save();
        updatedIncome.push(inc);
        await audit(userId, 'Income', inc._id, 'update', prev, inc.toJSON(), 'Payment message import');
      } else {
        const data: any = { date: p.date, amount: p.amount, clientName: p.payer, description: p.description || `Payment${p.payer ? ' from ' + p.payer : ''}`, status: 'paid', paidDate: p.date, incomeSourceId: p.incomeSourceId ?? body.incomeSourceId ?? null, invoiceNumber: p.reference, paymentMethod: p.paymentMethod ?? 'Bank transfer' };
        await resolveClient(userId, data, { create: false });
        const inc = await Income.create({ ...data, userId });
        createdIncome.push(inc);
        await audit(userId, 'Income', inc._id, 'create', undefined, inc.toJSON(), 'Payment message import');
      }
    }
  } catch (err) {
    // Roll back partial imports so the user can retry cleanly
    await Income.deleteMany({ _id: { $in: createdIncome.map((x) => x._id) } });
    await Job.deleteMany({ _id: { $in: createdJobs.map((x) => x._id) } });
    throw err;
  }

  const batch = hash
    ? await ImportBatch.create({ userId, messageHash: hash, sourceMessage: body.sourceMessage, kind: body.jobs.length && body.payments.length ? 'mixed' : body.jobs.length ? 'schedule' : 'payment', jobIds: createdJobs.map((j) => j._id), incomeIds: createdIncome.map((i) => i._id) })
    : null;
  if (batch) await Job.updateMany({ _id: { $in: createdJobs.map((j) => j._id) } }, { importBatchId: batch._id });
  for (const j of createdJobs) queueCalendarSync(userId, 'job', j._id);
  queueTravelDay(userId, ...createdJobs.map((j) => j.date));
  const cal = (await Settings.findOne({ userId }).lean())?.integrations?.googleCalendar;
  const calendarOn = Boolean(body.syncCalendar && cal?.enabled && cal.syncTypes?.includes('job') && (await googleApis(userId)));

  res.status(201).json({
    jobs: createdJobs.map((j) => j.toJSON()),
    incomeCreated: createdIncome.length,
    incomeUpdated: updatedIncome.length,
    calendarSync: calendarOn ? 'queued' : 'off',
    batchId: batch ? String(batch._id) : null,
  });
});

r.get('/history', async (req, res) => {
  const items = await ImportBatch.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items: items.map((b) => ({ id: String(b._id), createdAt: b.createdAt, kind: b.kind, jobCount: b.jobIds.length, incomeCount: b.incomeIds.length, preview: b.sourceMessage?.slice(0, 160) })) });
});

export default r;
