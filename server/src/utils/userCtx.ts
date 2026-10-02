import type { Request } from 'express';
import { User } from '../models/index.js';
import { todayIn, DATE_RE } from './dates.js';

export async function userCtx(req: Request) {
  const u = await User.findById(req.userId).select('currency timezone name email').lean();
  const timezone = u?.timezone || 'Australia/Adelaide';
  // Allow the client to pass its local date (e.g. when travelling); fall back to profile timezone
  const qToday = typeof req.query.today === 'string' && DATE_RE.test(req.query.today) ? req.query.today : undefined;
  return { today: qToday ?? todayIn(timezone), currency: u?.currency || 'AUD', timezone, user: u };
}
