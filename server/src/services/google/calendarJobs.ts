import type { calendar_v3 } from '@googleapis/calendar';
import { Job, Settings, User, Client } from '../../models/index.js';
import { googleApis, recordGoogleError } from './client.js';
import { eventToLocal, calendarsToRead, isNoAccess } from './calendar.js';
import { analyseJobText, splitTitlePrice, parseAddress, formatAddress, isStreetLine, isInstructionLine } from '../parser/index.js';
import { resolveClient, applyWorkArrangement } from '../clients.js';
import { createIncomeForJob, syncJobIncome } from '../../routes/resources.js';
import { audit } from '../audit.js';
import { todayIn, addDays, minutesBetween } from '../../utils/dates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Event = calendar_v3.Schema$Event;

/**
 * Work that someone else puts in your Google Calendar (e.g. "Office Co ($25)", repeating every 2 weeks) becomes a job here.
 * An event counts as work when its title has a price, or it was created by one of the organisers listed in Settings.
 * Each occurrence of a repeating event is its own job. Jobs follow later changes to their event (time, address,
 * notes; the price only while unpaid), are cancelled when the event is cancelled, and a job deleted here is never re-imported.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
/** Google stores descriptions as simple HTML when they were typed in the web app. */
export function descriptionLines(html?: string | null): string[] {
  if (!html) return [];
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m));
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export const hasPrice = (title?: string | null) => splitTitlePrice(title ?? '').amount !== undefined;

export function isWorkEvent(ev: Event, organisers: string[]): boolean {
  if (!ev.id || ev.extendedProperties?.private?.ptRef) return false; // the app's own events
  if (hasPrice(ev.summary)) return true;
  const who = [ev.organizer?.email, ev.creator?.email].filter(Boolean).map((e) => String(e).toLowerCase());
  return organisers.some((o) => who.includes(o.trim().toLowerCase()));
}

export interface CalendarJob {
  clientName: string; amount?: number; date?: string; startTime?: string; endTime?: string; hours?: number;
  address: ReturnType<typeof parseAddress>; tasks: string[]; description?: string; specialInstructions?: string; notes?: string; rooms?: number; bathrooms?: number;
}

/** One calendar event → the job it describes. Pure. */
export function parseCalendarJob(ev: Event, tz: string): CalendarJob {
  const { name, amount } = splitTitlePrice(ev.summary ?? '');
  const t = eventToLocal(ev, tz);
  const location = (ev.location ?? '').trim();
  let lines = descriptionLines(ev.description);
  const noteLines: string[] = [];
  lines = lines.filter((l) => {
    if (/^(team|with|crew)\b\s*[:=-]?/i.test(l)) { noteLines.push(l); return false; } // "Team SUSHANT + TANIA"
    if (/^(created by|organi[sz]er|invitation from)\b/i.test(l)) return false;
    // The address repeated at the top of the notes ("21 Example Rd" then the full address)
    if (location && (location.toLowerCase().startsWith(l.toLowerCase().replace(/,$/, '')) || l.toLowerCase() === location.toLowerCase())) return false;
    return true;
  });
  // Short lines in a calendar note are a checklist: each one is a task as written (instructions stay instructions)
  const text = analyseJobText(lines.map((l) => (isInstructionLine(l) || isStreetLine(l) || /^[•✅☑✔-]/.test(l) ? l : `• ${l}`)));
  let address = text.address;
  if (location) {
    const fromLocation = parseAddress([location.replace(/,\s*australia$/i, '')]);
    if (fromLocation.line1 || isStreetLine(location) || !address?.line1) address = { ...fromLocation, formatted: fromLocation.formatted || formatAddress(fromLocation) || location };
  }
  const mins = t.startTime && t.endTime ? minutesBetween(t.startTime, t.endTime) : undefined;
  return {
    clientName: (name || 'Calendar job').slice(0, 120), amount, date: t.date, startTime: t.startTime, endTime: t.endTime, hours: mins ? Math.round((mins / 60) * 100) / 100 : undefined,
    address: address ?? {}, tasks: text.tasks ?? [], description: text.description, specialInstructions: text.specialInstructions,
    notes: noteLines.join(' · ') || undefined, rooms: text.rooms, bathrooms: text.bathrooms,
  };
}

export interface ImportCounts { created: number; updated: number; cancelled: number; skipped: number }

export async function importCalendarJobs(userId: string, opts: { force?: boolean } = {}): Promise<ImportCounts> {
  const counts: ImportCounts = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  const [settings, user, apis] = await Promise.all([Settings.findOne({ userId }).lean(), User.findById(userId).select('timezone').lean(), googleApis(userId)]);
  const cal: any = settings?.integrations?.googleCalendar ?? {};
  if (!apis || !cal.importJobs) return counts;
  const tz = user?.timezone || 'Australia/Adelaide';
  const today = todayIn(tz, new Date());
  const from = addDays(today, -7), to = addDays(today, 42);
  const organisers: string[] = (cal.jobOrganizers ?? []).filter(Boolean);
  const ignored = new Set<string>(cal.ignoredEventIds ?? []);
  const contractor = cal.jobContractorId ? await Client.findOne({ _id: cal.jobContractorId, userId }).lean() : null;
  const { queueTravelDay } = await import('../travel/index.js');

  const seen = new Set<string>();
  try {
    for (const calendarId of calendarsToRead(cal)) {
    let pageToken: string | undefined;
    for (let page = 0; page < 8; page++) {
      let r;
      try {
        r = await apis.calendar.events.list({ calendarId, timeMin: `${addDays(from, -1)}T00:00:00Z`, timeMax: `${addDays(to, 1)}T00:00:00Z`, singleEvents: true, showDeleted: true, maxResults: 250, pageToken });
      } catch (e) {
        if (calendarId !== (cal.calendarId || 'primary') && isNoAccess(e)) break; // a calendar that isn't shared with you
        throw e;
      }
      for (const ev of r.data.items ?? []) {
        if (!ev.id || ignored.has(ev.id) || seen.has(ev.id)) continue;
        seen.add(ev.id);
        const existing = await Job.findOne({ userId, 'importedFrom.eventId': ev.id });
        if (ev.status === 'cancelled') {
          if (existing && !['completed', 'cancelled'].includes(existing.status)) {
            const before = existing.toJSON();
            existing.status = 'cancelled';
            existing.set('importedFrom.updated', ev.updated ?? undefined);
            await existing.save();
            await syncJobIncome(userId, existing, before);
            await audit(userId, 'Job', existing._id, 'update', before, existing.toJSON(), 'Cancelled in Google Calendar');
            queueTravelDay(userId, existing.date);
            counts.cancelled++;
          }
          continue;
        }
        if (!isWorkEvent(ev, organisers)) continue;
        const p = parseCalendarJob(ev, tz);
        if (!p.date || p.date < from || p.date > to) continue;

        if (existing) {
          if (!opts.force && existing.importedFrom?.updated === ev.updated) { counts.skipped++; continue; }
          const before = existing.toJSON();
          const change: Record<string, any> = { date: p.date, startTime: p.startTime, endTime: p.endTime, address: p.address, tasks: p.tasks, description: p.description, specialInstructions: p.specialInstructions };
          if (p.hours) change.hoursWorked = p.hours;
          if (p.amount !== undefined && p.amount !== existing.amount && !existing.invoiceId) change.amount = p.amount; // syncJobIncome leaves paid income alone
          if (p.clientName !== existing.clientName) { const d: any = { clientName: p.clientName }; await resolveClient(userId, d, { create: true, address: p.address }); Object.assign(change, { clientName: p.clientName, clientId: d.clientId ?? null }); }
          if (existing.status === 'cancelled') change.status = 'scheduled'; // the event is back
          existing.set(change);
          existing.set('importedFrom.updated', ev.updated ?? undefined);
          const after: any = existing.toJSON();
          const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null) || (Array.isArray(x) && !x.length && y == null) || (Array.isArray(y) && !y.length && x == null);
          if (!existing.isModified() || Object.keys(change).every((k) => same((before as any)[k], after[k]))) {
            await Job.updateOne({ _id: existing._id }, { $set: { 'importedFrom.updated': ev.updated } });
            counts.skipped++;
            continue;
          }
          await existing.save();
          await syncJobIncome(userId, existing, before);
          await audit(userId, 'Job', existing._id, 'update', before, existing.toJSON(), 'Changed in Google Calendar');
          queueTravelDay(userId, before.date, existing.date);
          counts.updated++;
          continue;
        }

        const data: any = {
          userId, clientName: p.clientName, date: p.date, startTime: p.startTime, endTime: p.endTime, hoursWorked: p.hours, amount: p.amount,
          address: p.address, tasks: p.tasks, description: p.description, specialInstructions: p.specialInstructions, notes: p.notes, rooms: p.rooms, bathrooms: p.bathrooms,
          incomeSourceId: cal.jobIncomeSourceId ?? contractor?.incomeSourceId ?? null,
          workType: contractor ? 'subcontract' : 'own', contractorId: contractor?._id ?? null,
          status: 'scheduled',
          importedFrom: { eventId: ev.id, recurringEventId: ev.recurringEventId ?? undefined, updated: ev.updated ?? undefined, organizer: (ev.organizer?.email ?? ev.creator?.email ?? undefined)?.toLowerCase() },
        };
        await resolveClient(userId, data, { create: true, address: p.address, incomeSourceId: data.incomeSourceId });
        await applyWorkArrangement(userId, data, { inheritFromSource: !contractor });
        const job = await Job.create(data);
        await audit(userId, 'Job', job._id, 'create', undefined, job.toJSON(), 'Imported from Google Calendar');
        await createIncomeForJob(userId, job);
        queueTravelDay(userId, job.date);
        counts.created++;
      }
      pageToken = r.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    }
  } catch (e) {
    await recordGoogleError(userId, e, 'Importing jobs from Google Calendar');
  }
  return counts;
}

/** Remember a deleted calendar job so it isn't imported again. */
export async function ignoreCalendarEvent(userId: string, eventId?: string | null) {
  if (!eventId) return;
  await Settings.updateOne({ userId }, { $addToSet: { 'integrations.googleCalendar.ignoredEventIds': eventId } });
  await Settings.updateOne({ userId, 'integrations.googleCalendar.ignoredEventIds.500': { $exists: true } }, { $push: { 'integrations.googleCalendar.ignoredEventIds': { $each: [], $slice: -400 } } });
}
