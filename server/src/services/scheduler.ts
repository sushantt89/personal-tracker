import { User, GoogleAccount } from '../models/index.js';
import { todayIn } from '../utils/dates.js';
import { materialiseRecurringIncome } from './recurringIncome.js';
import { runNotifications } from './notify/index.js';
import { pullCalendarChanges } from './google/calendar.js';

let running = false;

/** One pass over all users: repeating income, reminders (email/phone), and changes made in Google Calendar. */
export async function schedulerTick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const users = await User.find().select('_id timezone').lean();
    const connected = new Set((await GoogleAccount.find({ needsReconnect: { $ne: true } }).select('userId').lean()).map((a) => String(a.userId)));
    for (const u of users) {
      const id = String(u._id);
      const step = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.error(`[scheduler] ${label}`, (e as Error).message); } };
      await step('recurring income', () => materialiseRecurringIncome(id, todayIn(u.timezone || 'Australia/Adelaide', now)));
      if (connected.has(id)) await step('calendar pull', () => pullCalendarChanges(id));
      await step('notifications', () => runNotifications(id, now));
    }
  } finally {
    running = false;
  }
}

/** Runs every 10 minutes while the server is up (and once shortly after start). */
export function startScheduler(intervalMs = 10 * 60 * 1000) {
  setTimeout(() => void schedulerTick(), 20_000).unref();
  setInterval(() => void schedulerTick(), intervalMs).unref();
}
