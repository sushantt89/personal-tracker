import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z } from 'zod';
import { DocumentModel, Expense, Category, Invoice } from '../models/index.js';
import { documentMetaSchema } from './schemas.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { storage } from '../services/storage.js';
import { audit } from '../services/audit.js';
import { assertOwnedRefs, escapeRegex } from '../services/crud.js';
import { env } from '../config/env.js';
import { ocrService } from '../services/integrations/index.js';
import { scanReceipt } from '../services/ocr/index.js';
import { heicToJpeg, isHeic } from '../services/ocr/engine.js';
import { userCtx } from '../utils/userCtx.js';
import { queueDocumentUpload, uploadDocument, readDocumentFile, queueDriveDelete } from '../services/google/drive.js';
import { googleApis } from '../services/google/client.js';
import { zDate, zMoney, zOptId, zOptStr } from '../utils/zod.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r = Router();
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  // Some browsers send HEIC photos with an empty or generic type, so also accept by file extension
  fileFilter: (_req, file, cb) => (ALLOWED.includes(file.mimetype) || /\.hei[cf]$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only PDF and image files are allowed'))),
});
const refs = { categoryId: Category, expenseId: Expense, invoiceId: Invoice };

r.get('/', async (req, res) => {
  const filter: any = { userId: req.userId };
  if (typeof req.query.kind === 'string' && req.query.kind) filter.kind = req.query.kind;
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const re = new RegExp(escapeRegex(req.query.q.trim()), 'i');
    filter.$or = [{ title: re }, { merchant: re }, { originalName: re }, { notes: re }];
  }
  if (typeof req.query.expenseId === 'string') filter.expenseId = req.query.expenseId;
  const items = await DocumentModel.find(filter).sort({ createdAt: -1 }).limit(500);
  res.json({ items: items.map((d) => d.toJSON()), total: items.length, ocrAvailable: ocrService.available() });
});

const withUpload = (req: any, res: any, next: any) => upload.single('file')(req, res, (err: any) => (err ? next(badRequest(err.message)) : next()));

/** Read a receipt without saving anything: returns suggested fields for the review form. */
r.post('/scan', withUpload, async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  const { today } = await userCtx(req);
  try {
    res.json(await scanReceipt(req.file.buffer, isHeic(req.file.mimetype, req.file.originalname) ? 'image/heic' : req.file.mimetype, today));
  } catch (e) {
    throw badRequest((e as Error).message);
  }
});

/** Read an already-uploaded receipt. */
r.post('/:id/scan', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId }).select('+storageKey');
  if (!doc) throw notFound('Document not found');
  const { today } = await userCtx(req);
  try {
    res.json(await scanReceipt(await readDocumentFile(req.userId!, doc), doc.mimeType ?? '', today));
  } catch (e) {
    throw badRequest((e as Error).message);
  }
});

r.post('/', (req, res, next) => upload.single('file')(req, res, (err) => (err ? next(badRequest(err.message)) : next())), async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  // iPhone HEIC photos are stored as JPEG so every browser can show them and OCR can read them
  if (isHeic(req.file.mimetype, req.file.originalname)) {
    try {
      req.file.buffer = await heicToJpeg(req.file.buffer);
      req.file.mimetype = 'image/jpeg';
      req.file.originalname = req.file.originalname.replace(/\.hei[cf]$/i, '') + '.jpg';
      req.file.size = req.file.buffer.length;
    } catch {
      throw badRequest('This HEIC photo could not be converted. Try exporting it as JPG.');
    }
  }
  const rawMeta = typeof req.body.meta === 'string' ? JSON.parse(req.body.meta || '{}') : req.body;
  const meta: any = parseBody(documentMetaSchema, rawMeta);
  const expenseInput: any = rawMeta.createExpense ? parseBody(z.object({ date: zDate, amount: zMoney, merchant: zOptStr(120), categoryId: zOptId, paymentMethod: zOptStr(60), gst: zMoney.optional(), notes: zOptStr(2000) }), rawMeta.createExpense) : null;
  if (expenseInput) await assertOwnedRefs(req.userId!, expenseInput, refs);
  await assertOwnedRefs(req.userId!, meta, refs);
  const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const existing = await DocumentModel.findOne({ userId: req.userId, sha256 });
  if (existing) return res.status(200).json({ ...existing.toJSON(), duplicate: true });
  const kind = meta.kind ?? 'other';
  const folder = `${kind === 'receipt' ? 'receipts' : kind === 'invoice' ? 'invoices' : 'documents'}/${(meta.date ?? new Date().toISOString()).slice(0, 4)}`;
  const saved = await storage.save(req.userId!, req.file.buffer, req.file.originalname, folder);
  const doc = await DocumentModel.create({
    ...meta, userId: req.userId, kind, title: meta.title || req.file.originalname, originalName: req.file.originalname,
    mimeType: req.file.mimetype, size: req.file.size, storage: storage.name, storageKey: saved.key, sha256,
  });
  if (meta.expenseId) await Expense.updateOne({ _id: meta.expenseId, userId: req.userId }, { receiptId: doc._id });
  await audit(req.userId!, 'Document', doc._id, 'create', undefined, doc.toJSON());
  let expense = null;
  if (expenseInput && !meta.expenseId) {
    expense = await Expense.create({ ...expenseInput, userId: req.userId, description: expenseInput.merchant ? `Receipt – ${expenseInput.merchant}` : 'Receipt', receiptId: doc._id });
    doc.set({ expenseId: expense._id, amount: expenseInput.amount, date: expenseInput.date, merchant: expenseInput.merchant, categoryId: expenseInput.categoryId, gst: expenseInput.gst });
    await doc.save();
    await audit(req.userId!, 'Expense', expense._id, 'create', undefined, expense.toJSON(), `From receipt ${doc._id}`);
  }
  queueDocumentUpload(req.userId!, doc._id);
  res.status(201).json({ ...doc.toJSON(), expense: expense?.toJSON() ?? null });
});

r.get('/:id/file', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId }).select('+storageKey');
  if (!doc) throw notFound('Document not found');
  let data: Buffer;
  try {
    data = await readDocumentFile(req.userId!, doc);
  } catch (e) {
    if ((e as { code?: string }).code === 'FILE_GONE') throw notFound((e as Error).message);
    throw e;
  }
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${(doc.originalName || 'file').replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(data);
});

r.patch('/:id', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) throw notFound('Document not found');
  const data: any = parseBody(documentMetaSchema.partial(), req.body);
  await assertOwnedRefs(req.userId!, data, refs);
  const before = doc.toJSON();
  doc.set(data);
  await doc.save();
  if (data.expenseId) await Expense.updateOne({ _id: data.expenseId, userId: req.userId }, { receiptId: doc._id });
  await audit(req.userId!, 'Document', doc._id, 'update', before, doc.toJSON());
  res.json(doc.toJSON());
});

/** Create an expense from a receipt's (reviewed) details and link them. */
r.post('/:id/create-expense', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) throw notFound('Document not found');
  if (doc.expenseId) throw badRequest('This receipt is already linked to an expense');
  const body: any = parseBody(z.object({ date: zDate, amount: zMoney, merchant: zOptStr(120), categoryId: zOptId, paymentMethod: zOptStr(60), gst: zMoney.optional(), notes: zOptStr(2000) }), req.body);
  await assertOwnedRefs(req.userId!, body, refs);
  const exp = await Expense.create({ ...body, userId: req.userId, description: body.merchant ? `Receipt – ${body.merchant}` : 'Receipt', receiptId: doc._id });
  doc.set({ expenseId: exp._id, date: body.date, amount: body.amount, merchant: body.merchant, categoryId: body.categoryId, gst: body.gst });
  await doc.save();
  await audit(req.userId!, 'Expense', exp._id, 'create', undefined, exp.toJSON(), `From receipt ${doc._id}`);
  res.status(201).json({ expense: exp.toJSON(), document: doc.toJSON() });
});

/** Copy this file to Google Drive (Receipts/<year>, Invoices/<year>/<month> or Financial Documents). */
r.post('/:id/drive', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId }).select('_id').lean();
  if (!doc) throw notFound('Document not found');
  if (!(await googleApis(req.userId!))) return res.status(409).json({ error: 'Google Drive is not connected. Connect it in Settings → Integrations.' });
  try {
    res.json({ uploaded: true, ...(await uploadDocument(req.userId!, doc._id)) });
  } catch (e) {
    res.status(502).json({ error: `Upload to Google Drive failed: ${(e as Error).message}` });
  }
});

r.delete('/:id', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId }).select('+storageKey');
  if (!doc) throw notFound('Document not found');
  await storage.remove(doc.storageKey).catch(() => undefined);
  await Expense.updateMany({ userId: req.userId, receiptId: doc._id }, { receiptId: null });
  await doc.deleteOne();
  await audit(req.userId!, 'Document', doc._id, 'delete', doc.toJSON());
  queueDriveDelete(req.userId!, doc.sync?.googleDriveFileId, doc.title || 'a document');
  res.json({ ok: true });
});

export default r;
