import { Router } from 'express';
import { z } from 'zod';
import { TravelDay } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { zDate } from '../utils/zod.js';
import { userCtx } from '../utils/userCtx.js';
import { computeDay, travelSettings, travelSummary, fuelFor, travelProvider } from '../services/travel/index.js';
import { badRequest } from '../utils/httpError.js';

const r = Router();

/** Route for one day. Calculated on first view (and after job changes) when travel is on. */
r.get('/day', async (req, res) => {
  const { today } = await userCtx(req);
  const date = req.query.date ? parseBody(zDate, req.query.date) : today;
  const s = await travelSettings(req.userId!);
  let day = await TravelDay.findOne({ userId: req.userId, date }).lean();
  if (!day && s.enabled) day = (await computeDay(req.userId!, date))?.toObject() ?? null;
  const fuel = day ? fuelFor(day.totalKm ?? 0, s) : { litres: 0, cost: 0 };
  res.json({ enabled: s.enabled, provider: travelProvider().name, day: day ? { ...day, id: String(day._id), _id: undefined, fuel } : null });
});

r.post('/day/recalculate', async (req, res) => {
  const { date } = parseBody(z.object({ date: zDate }), req.body);
  const s = await travelSettings(req.userId!);
  if (!s.enabled) throw badRequest('Turn on Distance & travel in Settings first');
  const day = await computeDay(req.userId!, date, { force: true });
  res.json({ day: day ? { ...day.toJSON(), fuel: fuelFor(day.totalKm ?? 0, s) } : null });
});

r.get('/summary', async (req, res) => {
  const q = parseBody(z.object({ from: zDate, to: zDate }), req.query);
  res.json(await travelSummary(req.userId!, q.from, q.to));
});

/** Calculate any days in a range that have jobs but no saved route yet (e.g. after turning travel on). */
r.post('/backfill', async (req, res) => {
  const q = parseBody(z.object({ from: zDate, to: zDate }), req.body);
  const s = await travelSettings(req.userId!);
  if (!s.enabled) throw badRequest('Turn on Distance & travel in Settings first');
  const { Job } = await import('../models/index.js');
  const dates: string[] = await Job.distinct('date', { userId: req.userId, date: { $gte: q.from, $lte: q.to }, status: { $ne: 'cancelled' } });
  const done = new Set((await TravelDay.find({ userId: req.userId, date: { $in: dates } }).select('date signature error').lean()).filter((d) => d.signature && !d.error).map((d) => d.date));
  const todo = dates.filter((d) => !done.has(d)).sort().slice(0, 62);
  let calculated = 0;
  for (const d of todo) { await computeDay(req.userId!, d); calculated++; }
  res.json({ calculated, remaining: Math.max(0, dates.length - done.size - calculated) });
});

export default r;
