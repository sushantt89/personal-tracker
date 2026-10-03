import type { calendar_v3 } from '@googleapis/calendar';
import type { Model } from 'mongoose';
import { Job, Task, RecurringBill, Invoice, Settings, User, GoogleAccount, Income } from '../../models/index.js';
import { audit } from '../audit.js';
import { addDays, minutesBetween, todayIn } from '../../utils/dates.js';
import { googleApis, isNotFound, recordGoogleError, type GoogleApis } from './client.js';
import { background } from './background.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SyncKind = 'job' | 'task' | 'bill' | 'invoice';
type Event = calendar_v3.Schema$Event;

const MODELS: Record<SyncKind, Model<any>> = { job: Job, task: Task, bill: RecurringBill, invoice: Invoice };
const money = (n?: number | null) => (n === undefined || n === null ? '' : `$${Number(n).toFixed(2).replace(/\.00$/, '')}`);
const compactDate = (d: string) => d.replace(/-/g, '');
const ref = (kind: SyncKind, id: unknown) => `${kind}:${String(id)}`;

function addMinutesToTime(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let d = date;
  while (total >= 1440) { total -= 1440; d = addDays(d, 1); }
  return { date: d, time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` };
}

/** Timed event when a start time exists, otherwise an all-day event. */
function when(date: string, start: string | undefined | null, end: string | undefined | null, tz: string, defaultMinutes = 60): Pick<Event, 'start' | 'end'> {
  if (!start) return { start: { date }, end: { date: addDays(date, 1) } };
  const duration = minutesBetween(start, end ?? undefined) ?? defaultMinutes;
  const e = addMinutesToTime(date, start, duration);
  return { start: { dateTime: `${date}T${start}:00`, timeZone: tz }, end: { dateTime: `${e.date}T${e.time}:00`, timeZone: tz } };
}

/** Private tag so we can always find (and never duplicate) the event for a record. */
const base = (kind: SyncKind, id: unknown): Event => ({
  extendedProperties: { private: { ptRef: ref(kind, id), ptApp: 'personal-tracker' } },
});

export function jobToEvent(job: any, tz: string): Event {
  const via = job.workType === 'subcontract' && job.contractorName ? ` (via ${job.contractorName})` : '';
  const lines = [
    job.amount ? `Amount: ${money(job.amount)}` : '',
    job.meetingPoint ? `Meet at: ${job.meetingPoint}` : '',
    job.description ?? '',
    job.tasks?.length ? `Tasks:\n- ${job.tasks.join('\n- ')}` : '',
    job.rooms || job.bathrooms ? `Rooms: ${job.rooms ?? '-'} · Bathrooms: ${job.bathrooms ?? '-'}` : '',
    job.specialInstructions ? `Notes: ${job.specialInstructions}` : '',
  ].filter(Boolean);
  const b = base('job', job._id);
  return {
    ...b,
    summary: `${job.clientName || job.title || 'Job'}${via}${job.amount ? ` · ${money(job.amount)}` : ''}`,
    location: job.address?.formatted || undefined,
    description: lines.join('\n\n') || undefined,
    ...when(job.date, job.startTime, job.endTime, tz, job.hoursWorked ? Math.round(job.hoursWorked * 60) : 60),
    status: 'confirmed',
  };
}

const TASK_RRULE: Record<string, string> = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', fortnightly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' };

export function taskToEvent(task: any, tz: string): Event {
  const f = task.recurrence?.frequency ?? 'none';
  const timed = Boolean(task.startTime);
  let rrule: string | undefined;
  if (f !== 'none' && TASK_RRULE[f]) {
    rrule = `RRULE:${TASK_RRULE[f]}`;
    if (task.recurrence?.until) rrule += `;UNTIL=${compactDate(task.recurrence.until)}${timed ? 'T235959Z' : ''}`;
  }
  const b = base('task', task._id);
  return {
    ...b,
    summary: task.title,
    location: task.location || undefined,
    description: [task.description, task.notes].filter(Boolean).join('\n\n') || undefined,
    ...when(task.date, task.startTime, task.endTime, tz, 30),
    ...(rrule ? { recurrence: [rrule] } : {}),
  };
}

export function billToEvent(bill: any): Event {
  const first = bill.startDate && bill.startDate > bill.dueDate ? bill.startDate : bill.dueDate;
  const freq: Record<string, string> = {
    weekly: 'FREQ=WEEKLY', fortnightly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY;INTERVAL=3', yearly: 'FREQ=YEARLY',
    custom: `FREQ=DAILY;INTERVAL=${bill.customIntervalDays || 30}`,
  };
  let rrule = `RRULE:${freq[bill.frequency] ?? 'FREQ=MONTHLY'}`;
  if (bill.endDate) rrule += `;UNTIL=${compactDate(bill.endDate)}`;
  const days = Math.min(Math.max(bill.reminderDays ?? 3, 0), 28);
  const b = base('bill', bill._id);
  return {
    ...b,
    summary: `Bill: ${bill.name} · ${money(bill.amount)}`,
    description: [bill.paymentMethod ? `Payment: ${bill.paymentMethod}` : '', bill.autoPay ? 'Paid automatically' : '', bill.notes ?? ''].filter(Boolean).join('\n') || undefined,
    start: { date: first },
    end: { date: addDays(first, 1) },
    recurrence: [rrule],
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: days * 1440 }] },
  };
}

export function invoiceToEvent(inv: any): Event {
  const b = base('invoice', inv._id);
  return {
    ...b,
    summary: `Invoice ${inv.number} due · ${money(inv.total)}`,
    description: `Client: ${inv.clientName}`,
    start: { date: inv.dueDate },
    end: { date: addDays(inv.dueDate, 1) },
    transparency: 'transparent',
  };
}

/** Which "event type" setting governs this record. */
export function syncTypeOf(kind: SyncKind, doc: any): string {
  if (kind !== 'task') return kind;
  return doc.category === 'appointment' ? 'appointment' : doc.category === 'event' ? 'event' : 'task';
}

export function shouldSync(kind: SyncKind, doc: any, cal: { enabled?: boolean; syncTypes?: string[] } | null | undefined): boolean {
  if (!doc || doc.sync?.calendarOptOut) return false;
  // Asked for explicitly on this record ("Add to Google Calendar"): only needs a Google connection
  if (doc.sync?.calendarInclude && (kind === 'job' || kind === 'task')) return doc.status !== 'cancelled';
  if (!cal?.enabled) return false;
  if (!(cal.syncTypes ?? []).includes(syncTypeOf(kind, doc))) return false;
  if (kind === 'job' || kind === 'task') return doc.status !== 'cancelled';
  if (kind === 'bill') return doc.active !== false;
  return doc.status === 'sent';
}

function toEvent(kind: SyncKind, doc: any, tz: string): Event {
  return kind === 'job' ? jobToEvent(doc, tz) : kind === 'task' ? taskToEvent(doc, tz) : kind === 'bill' ? billToEvent(doc) : invoiceToEvent(doc);
}

/** Create or update without duplicates: by stored id, then by our private ref, then insert. */
async function upsertEvent(apis: GoogleApis, calendarId: string, kind: SyncKind, doc: any, event: Event): Promise<string> {
  const existingId: string | undefined = doc.sync?.googleCalendarEventId;
  if (existingId) {
    try {
      const r = await apis.calendar.events.update({ calendarId, eventId: existingId, requestBody: event });
      return r.data.id ?? existingId;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  const found = await apis.calendar.events.list({ calendarId, privateExtendedProperty: [`ptRef=${ref(kind, doc._id)}`], maxResults: 1, singleEvents: false });
  const match = found.data.items?.[0];
  if (match?.id) {
    const r = await apis.calendar.events.update({ calendarId, eventId: match.id, requestBody: event });
    return r.data.id ?? match.id;
  }
  const r = await apis.calendar.events.insert({ calendarId, requestBody: event });
  return r.data.id!;
}

async function deleteEvent(apis: GoogleApis, calendarId: string, eventId: string) {
  try {
    await apis.calendar.events.delete({ calendarId, eventId });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

async function context(userId: string) {
  const [settings, user, apis] = await Promise.all([Settings.findOne({ userId }).lean(), User.findById(userId).select('timezone').lean(), googleApis(userId)]);
  const cal = settings?.integrations?.googleCalendar;
  return { apis, cal, calendarId: cal?.calendarId || 'primary', tz: user?.timezone || 'Australia/Adelaide' };
}

export type SyncOutcome = 'created' | 'updated' | 'removed' | 'skipped' | 'error';

/** Bring one record's calendar event in line with the record and the user's settings. */
export async function syncRecord(userId: string, kind: SyncKind, id: unknown, ctx?: Awaited<ReturnType<typeof context>>): Promise<SyncOutcome> {
  const c = ctx ?? (await context(userId));
  if (!c.apis) return 'skipped';
  const model = MODELS[kind];
  const doc = await model.findOne({ _id: id, userId }).lean<any>();
  if (!doc) return 'skipped';
  const eventId: string | undefined = doc.sync?.googleCalendarEventId;
  try {
    if (!shouldSync(kind, doc, c.cal)) {
      if (!eventId) return 'skipped';
      await deleteEvent(c.apis, c.calendarId, eventId);
      await model.updateOne({ _id: doc._id }, { $unset: { 'sync.googleCalendarEventId': 1, 'sync.syncError': 1 }, $set: { 'sync.syncedAt': new Date() } });
      return 'removed';
    }
    const newId = await upsertEvent(c.apis, c.calendarId, kind, doc, toEvent(kind, doc, c.tz));
    await model.updateOne({ _id: doc._id }, { $set: { 'sync.googleCalendarEventId': newId, 'sync.syncedAt': new Date() }, $unset: { 'sync.syncError': 1 } });
    return eventId ? 'updated' : 'created';
  } catch (e) {
    const msg = await recordGoogleError(userId, e, `Calendar sync for ${kind}`);
    await model.updateOne({ _id: doc._id }, { $set: { 'sync.syncError': msg } }).catch(() => undefined);
    return 'error';
  }
}

/** Queue a sync after a change (never blocks the request). */
export function queueCalendarSync(userId: string, kind: SyncKind, id: unknown) {
  background(() => syncRecord(userId, kind, id));
}

/** Queue removal of the event of a deleted record. */
export function queueCalendarDelete(userId: string, eventId?: string | null) {
  if (!eventId) return;
  background(async () => {
    const c = await context(userId);
    if (!c.apis) return;
    try {
      await deleteEvent(c.apis, c.calendarId, eventId);
    } catch (e) {
      await recordGoogleError(userId, e, 'Calendar delete');
    }
  });
}

/** Google event start/end → local calendar date and HH:mm in the user's timezone. */
export function eventToLocal(event: Event, tz: string): { date?: string; startTime?: string; endTime?: string } {
  const local = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
  };
  if (event.start?.date) return { date: event.start.date };
  if (!event.start?.dateTime) return {};
  const s = local(event.start.dateTime);
  const e = event.end?.dateTime ? local(event.end.dateTime) : undefined;
  return { date: s.date, startTime: s.time, endTime: e && e.date === s.date ? e.time : undefined };
}

export interface GoogleCalendarItem { id: string; type: 'google'; refId: string; date: string; startTime?: string; endTime?: string; title: string; location?: string; link?: string; allDay?: boolean }
const googleCache = new Map<string, { at: number; items: GoogleCalendarItem[] }>();
const addDay = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * The events already in the user's Google Calendar (not the ones this app put there), for showing on the app's calendar.
 * Read live and never stored. Returns null when Google isn't connected or the option is off.
 */
export async function listGoogleEvents(userId: string, from: string, to: string): Promise<{ items: GoogleCalendarItem[]; error?: string } | null> {
  const c = await context(userId);
  if (!c.apis || c.cal?.showGoogleEvents === false) return null;
  const key = `${userId}|${c.calendarId}|${from}|${to}`;
  const hit = googleCache.get(key);
  if (hit && Date.now() - hit.at < 45_000) return { items: hit.items };
  try {
    const items: GoogleCalendarItem[] = [];
    let pageToken: string | undefined;
    const load = async () => {
      for (let page = 0; page < 4; page++) {
        // A day either side covers every timezone; the exact days are picked below in the user's own timezone
        const r = await c.apis!.calendar.events.list({ calendarId: c.calendarId, timeMin: `${addDay(from, -1)}T00:00:00Z`, timeMax: `${addDay(to, 2)}T00:00:00Z`, singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken });
        for (const ev of r.data.items ?? []) {
          if (!ev.id || ev.status === 'cancelled' || ev.extendedProperties?.private?.ptRef) continue; // ours are already on the calendar as jobs, tasks and bills
          const base = { type: 'google' as const, refId: ev.id, title: ev.summary || '(No title)', location: ev.location ?? undefined, link: ev.htmlLink ?? undefined };
          if (ev.start?.date) {
            // All-day, possibly several days: one entry per day (the end date is exclusive)
            const end = ev.end?.date && ev.end.date > ev.start.date ? ev.end.date : addDay(ev.start.date, 1);
            for (let d = ev.start.date, n = 0; d < end && n < 62; d = addDay(d, 1), n++) if (d >= from && d <= to) items.push({ ...base, id: `google-${ev.id}-${d}`, date: d, allDay: true });
          } else {
            const t = eventToLocal(ev, c.tz);
            if (t.date && t.date >= from && t.date <= to) items.push({ ...base, id: `google-${ev.id}`, date: t.date, startTime: t.startTime, endTime: t.endTime });
          }
        }
        pageToken = r.data.nextPageToken ?? undefined;
        if (!pageToken) break;
      }
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([load(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Google Calendar took too long to answer')), 8000); })]);
    } finally {
      clearTimeout(timer);
    }
    googleCache.set(key, { at: Date.now(), items });
    if (googleCache.size > 200) for (const [k, v] of googleCache) if (Date.now() - v.at > 45_000) googleCache.delete(k);
    return { items };
  } catch (e) {
    const msg = await recordGoogleError(userId, e, 'Reading Google Calendar');
    return { items: hit?.items ?? [], error: msg };
  }
}
export const clearGoogleEventCache = () => googleCache.clear();

export interface PullCounts { updated: number; detached: number; skipped: number }

/**
 * Two-way sync: bring changes made in Google Calendar back into the app.
 *  - Moved/retimed job or one-off task event → the record's date and times are updated (audited; unpaid linked income follows the job).
 *  - Renamed task event → the task title is updated.
 *  - Deleted event → the record is kept but unlinked from the calendar (never deleted or cancelled automatically).
 * Bills, invoices and repeating tasks are owned by the app: edits to those events are ignored.
 */
export async function pullCalendarChanges(userId: string): Promise<PullCounts> {
  const counts: PullCounts = { updated: 0, detached: 0, skipped: 0 };
  const c = await context(userId);
  if (!c.apis || !c.cal?.enabled || (c.cal as any).twoWay === false) return counts;
  const account = await GoogleAccount.findOne({ userId }).lean();
  const startedAt = new Date();
  const floor = Date.now() - 20 * 86400000;
  const since = new Date(Math.max(floor, (account?.lastCalendarPullAt?.getTime() ?? floor) - 60000));
  try {
    let pageToken: string | undefined;
    do {
      const r = await c.apis.calendar.events.list({ calendarId: c.calendarId, privateExtendedProperty: ['ptApp=personal-tracker'], updatedMin: since.toISOString(), showDeleted: true, singleEvents: false, maxResults: 250, pageToken });
      for (const ev of r.data.items ?? []) {
        const [kind, id] = String(ev.extendedProperties?.private?.ptRef ?? '').split(':') as [SyncKind, string];
        const model = MODELS[kind];
        if (!model || !id || !ev.id) { counts.skipped++; continue; }
        const doc = await model.findOne({ _id: id, userId });
        if (!doc || doc.sync?.googleCalendarEventId !== ev.id) { counts.skipped++; continue; }
        // Ignore our own writes: only act on edits made after we last wrote the event
        const syncedAt = doc.sync?.syncedAt ? new Date(doc.sync.syncedAt).getTime() : 0;
        if (ev.updated && new Date(ev.updated).getTime() <= syncedAt + 10000) { counts.skipped++; continue; }

        if (ev.status === 'cancelled') {
          await model.updateOne({ _id: doc._id }, { $unset: { 'sync.googleCalendarEventId': 1 }, $set: { 'sync.calendarOptOut': true, 'sync.syncedAt': new Date() } });
          counts.detached++;
          continue;
        }
        const recurringTask = kind === 'task' && (doc.recurrence?.frequency ?? 'none') !== 'none';
        if ((kind !== 'job' && kind !== 'task') || recurringTask) { counts.skipped++; continue; }

        const t = eventToLocal(ev, c.tz);
        const change: Record<string, any> = {};
        if (t.date && t.date !== doc.date) change.date = t.date;
        if ((t.startTime ?? undefined) !== (doc.startTime ?? undefined)) change.startTime = t.startTime;
        // Only take the end time when the app had one or the length is not our 60/30-minute default
        const hadEnd = Boolean(doc.endTime);
        if (hadEnd && (t.endTime ?? undefined) !== doc.endTime) change.endTime = t.endTime;
        if (!hadEnd && t.startTime && t.endTime) {
          const defaultMins = kind === 'job' ? (doc.hoursWorked ? Math.round(doc.hoursWorked * 60) : 60) : 30;
          if ((minutesBetween(t.startTime, t.endTime) ?? defaultMins) !== defaultMins) change.endTime = t.endTime;
        }
        if (kind === 'task' && ev.summary && ev.summary.trim() !== doc.title) change.title = ev.summary.trim().slice(0, 200);
        if (!Object.keys(change).length) {
          await model.updateOne({ _id: doc._id }, { $set: { 'sync.syncedAt': new Date() } });
          counts.skipped++;
          continue;
        }
        const before = doc.toJSON();
        doc.set(change);
        if (kind === 'job' && ('startTime' in change || 'endTime' in change) && doc.startTime && doc.endTime) doc.hoursWorked = (minutesBetween(doc.startTime, doc.endTime) ?? 0) / 60 || doc.hoursWorked;
        doc.set('sync.syncedAt', new Date());
        await doc.save();
        if (kind === 'job') {
          await audit(userId, 'Job', doc._id, 'update', before, doc.toJSON(), 'Changed in Google Calendar');
          if (change.date) {
            const inc = await Income.findOne({ userId, jobId: doc._id, status: { $in: ['expected', 'pending'] } });
            if (inc) {
              const prev = inc.toJSON();
              inc.date = doc.date;
              await inc.save();
              await audit(userId, 'Income', inc._id, 'update', prev, inc.toJSON(), 'Job moved in Google Calendar');
            }
          }
          const { queueTravelDay } = await import('../travel/index.js');
          queueTravelDay(userId, before.date, doc.date);
        }
        counts.updated++;
      }
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
    await GoogleAccount.updateOne({ userId }, { lastCalendarPullAt: startedAt });
  } catch (e) {
    await recordGoogleError(userId, e, 'Reading changes from Google Calendar');
  }
  return counts;
}

/** Pull at most every few minutes when the user opens the calendar/My Day. */
export function queueCalendarPull(userId: string, minIntervalMs = 3 * 60000) {
  background(async () => {
    const acc = await GoogleAccount.findOne({ userId }).select('lastCalendarPullAt needsReconnect').lean();
    if (!acc || acc.needsReconnect) return;
    if (acc.lastCalendarPullAt && Date.now() - acc.lastCalendarPullAt.getTime() < minIntervalMs) return;
    await pullCalendarChanges(userId);
  });
}

/**
 * Sync everything relevant now: upcoming jobs/tasks, active bills, sent invoices,
 * plus anything that already has an event (so turning a type off removes its events).
 */
export async function syncAll(userId: string, opts: { removeAll?: boolean } = {}) {
  const c = await context(userId);
  if (!c.apis) throw new Error('Google is not connected');
  const pulled = opts.removeAll ? { updated: 0, detached: 0, skipped: 0 } : await pullCalendarChanges(userId);
  if (opts.removeAll) c.cal = { ...(c.cal as any), enabled: false };
  const user = await User.findById(userId).select('timezone').lean();
  const from = addDays(todayIn(user?.timezone || 'Australia/Adelaide'), -7);
  const hasEvent = { 'sync.googleCalendarEventId': { $exists: true } };
  const [jobs, tasks, bills, invoices] = await Promise.all([
    Job.find({ userId, $or: [{ date: { $gte: from } }, hasEvent] }).select('_id').lean(),
    Task.find({ userId, $or: [{ date: { $gte: from } }, { 'recurrence.frequency': { $ne: 'none' } }, hasEvent] }).select('_id').lean(),
    RecurringBill.find({ userId }).select('_id').lean(),
    Invoice.find({ userId, $or: [{ status: 'sent' }, hasEvent] }).select('_id').lean(),
  ]);
  const counts: Record<SyncOutcome, number> = { created: 0, updated: 0, removed: 0, skipped: 0, error: 0 };
  const work: [SyncKind, unknown][] = [
    ...jobs.map((d) => ['job', d._id] as [SyncKind, unknown]),
    ...tasks.map((d) => ['task', d._id] as [SyncKind, unknown]),
    ...bills.map((d) => ['bill', d._id] as [SyncKind, unknown]),
    ...invoices.map((d) => ['invoice', d._id] as [SyncKind, unknown]),
  ];
  for (const [kind, id] of work) counts[await syncRecord(userId, kind, id, c)]++;
  await GoogleAccount.updateOne({ userId }, { lastCalendarSyncAt: new Date(), ...(counts.error ? {} : { lastError: null }) });
  return { ...counts, pulled: pulled.updated, detached: pulled.detached };
}
