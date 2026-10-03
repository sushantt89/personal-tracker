import { Router } from 'express';
import { z } from 'zod';
import { Settings, Budget, Category, AuditLog, TravelDay } from '../models/index.js';
import { geocode, travelProvider } from '../services/travel/index.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest } from '../utils/httpError.js';
import { googleStatus, ocrService } from '../services/integrations/index.js';
import { formatInvoiceNumber } from '../services/invoices.js';
import { zId } from '../utils/zod.js';

const r = Router();

const settingsPatch = z.object({
  paymentMethods: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  notifications: z.object({
    billReminders: z.boolean(), billReminderDays: z.coerce.number().int().min(0).max(60), invoiceReminders: z.boolean(),
    jobReminders: z.boolean(), budgetAlerts: z.boolean(), taskReminders: z.boolean(),
    emailEnabled: z.boolean(), emailHour: z.coerce.number().int().min(0).max(23), pushEnabled: z.boolean(), inAppPopups: z.boolean(),
  }).partial().optional(),
  invoice: z.object({
    businessName: z.string().max(200), abn: z.string().max(30), address: z.string().max(500), email: z.string().max(200), phone: z.string().max(40),
    paymentDetails: z.string().max(2000),
    numberFormat: z.string().max(60).refine((f) => f.includes('{SEQ'), 'Format must include {SEQ}'),
    nextSequence: z.coerce.number().int().min(1).max(1_000_000), paymentTermsDays: z.coerce.number().int().min(0).max(365),
    defaultNotes: z.string().max(2000), gstRegistered: z.boolean(), gstRate: z.coerce.number().min(0).max(100),
    logoDataUrl: z.string().max(400_000).refine((s) => s === '' || /^data:image\/(png|jpe?g);base64,/.test(s), 'Logo must be a PNG or JPEG'),
  }).partial().optional(),
  travel: z.object({
    enabled: z.boolean(), homeAddress: z.string().trim().max(300), startFrom: z.enum(['home', 'first_job']), returnHome: z.boolean(),
    fuelPricePerLitre: z.coerce.number().min(0).max(20), litresPer100km: z.coerce.number().min(0).max(50), countryCode: z.string().length(2).toLowerCase(),
  }).partial().optional(),
  integrations: z.object({
    googleDrive: z.object({ enabled: z.boolean(), rootFolderName: z.string().trim().min(1).max(120), autoUploadInvoices: z.boolean(), autoUploadDocuments: z.boolean() }).partial(),
    googleCalendar: z.object({ enabled: z.boolean(), calendarId: z.string().max(200), syncTypes: z.array(z.enum(['job', 'appointment', 'bill', 'task', 'event', 'invoice'])), twoWay: z.boolean(), showGoogleEvents: z.boolean() }).partial(),
  }).partial().optional(),
});

/** Flatten nested patch into dot paths so partial updates don't wipe sibling fields. */
function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (v !== undefined) out[key] = v;
  }
  return out;
}

r.get('/settings', async (req, res) => {
  const s = await Settings.findOneAndUpdate({ userId: req.userId }, { $setOnInsert: { userId: req.userId } }, { upsert: true, new: true });
  res.json(s.toJSON());
});

r.patch('/settings', async (req, res) => {
  const patch = parseBody(settingsPatch, req.body);
  const before = await Settings.findOne({ userId: req.userId }).lean();
  const set = flatten(patch);
  const unset: Record<string, 1> = {};
  const homeChanged = patch.travel?.homeAddress !== undefined && patch.travel.homeAddress !== (before?.travel?.homeAddress ?? '');
  if (homeChanged) Object.assign(unset, { 'travel.homeLat': 1, 'travel.homeLng': 1 });
  const s = await Settings.findOneAndUpdate({ userId: req.userId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true, new: true, runValidators: true });
  let homeWarning: string | undefined;
  if (homeChanged && patch.travel?.homeAddress) {
    try {
      const hit = await geocode(req.userId!, patch.travel.homeAddress, s.travel?.countryCode || 'au');
      if (hit) await Settings.updateOne({ userId: req.userId }, { 'travel.homeLat': hit.lat, 'travel.homeLng': hit.lng });
      else homeWarning = 'Home address could not be found on the map. Try adding the suburb and state.';
    } catch (e) {
      homeWarning = `Could not look up the home address right now (${(e as Error).message}).`;
    }
  }
  // Start-point/return/home changes affect every saved route: mark them for recalculation
  if (patch.travel && (homeChanged || patch.travel.startFrom !== undefined || patch.travel.returnHome !== undefined)) {
    await TravelDay.updateMany({ userId: req.userId }, { $unset: { signature: 1 } });
  }
  const fresh = await Settings.findOne({ userId: req.userId });
  res.json({ ...fresh!.toJSON(), ...(homeWarning ? { homeWarning } : {}) });
});

r.get('/settings/invoice-number-preview', async (req, res) => {
  const format = typeof req.query.format === 'string' ? req.query.format : 'INV-{YYYY}-{SEQ}';
  const seq = Number(req.query.seq) || 1;
  res.json({ preview: formatInvoiceNumber(format, seq, new Date().toISOString().slice(0, 10)) });
});

const budgetSchema = z.object({
  monthlyIncomeTarget: z.coerce.number().min(0).max(10_000_000),
  monthlySpendingLimit: z.coerce.number().min(0).max(10_000_000),
  expectedVariableExpenses: z.coerce.number().min(0).max(10_000_000),
  monthlySavingsTarget: z.coerce.number().min(0).max(10_000_000),
  emergencyFundTarget: z.coerce.number().min(0).max(100_000_000),
  currentSavings: z.coerce.number().min(0).max(100_000_000),
  currentEmergencyFund: z.coerce.number().min(0).max(100_000_000),
  categoryBudgets: z.array(z.object({ categoryId: zId, amount: z.coerce.number().min(0).max(10_000_000) })).max(100),
}).partial();

r.get('/budget', async (req, res) => {
  const b = await Budget.findOneAndUpdate({ userId: req.userId }, { $setOnInsert: { userId: req.userId } }, { upsert: true, new: true });
  res.json(b.toJSON());
});

r.put('/budget', async (req, res) => {
  const data = parseBody(budgetSchema, req.body);
  if (data.categoryBudgets?.length) {
    const ids = data.categoryBudgets.map((c) => c.categoryId);
    if (new Set(ids).size !== ids.length) throw badRequest('Each category can only have one budget');
    const count = await Category.countDocuments({ userId: req.userId, _id: { $in: ids } });
    if (count !== ids.length) throw badRequest('Unknown category in budgets');
  }
  const b = await Budget.findOneAndUpdate({ userId: req.userId }, { $set: data }, { upsert: true, new: true, runValidators: true });
  res.json(b.toJSON());
});

r.get('/integrations', async (req, res) => {
  const g = await googleStatus(req.userId!);
  res.json({
    ...g,
    ocr: { provider: 'ocr', configured: ocrService.available(), connected: ocrService.available(), message: 'Built in and free. Receipts are read on this server (your computer when running locally) — images are never sent anywhere. Works with JPG, PNG, WebP and digital PDFs.' },
    travel: { provider: 'travel', configured: true, connected: Boolean((await Settings.findOne({ userId: req.userId }).lean())?.travel?.enabled), message: `Built in and free, using ${travelProvider().name}. Turn it on in Settings → Travel.` },
  });
});

r.get('/audit', async (req, res) => {
  const filter: Record<string, unknown> = { userId: req.userId };
  if (typeof req.query.entity === 'string') filter.entity = req.query.entity;
  if (typeof req.query.entityId === 'string') filter.entityId = req.query.entityId;
  const items = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items: items.map((a) => ({ ...a, id: String(a._id), _id: undefined })) });
});

export default r;
