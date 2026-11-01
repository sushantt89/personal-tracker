import { findDate } from './dates.js';
import { parseAddress, isStreetLine, isLocalityLine } from './address.js';
import { analyseJobText, splitTitlePrice, isInstructionLine } from './parser.js';
import type { ParsedJob, ParseResult } from './types.js';

/**
 * Rule-based reader for one event as a calendar app shows it — a screenshot of the event (run through OCR) or its text
 * copied out of Google Calendar:
 *
 *   Office Co ($30) 🔑 box 1234         ← title: client, price, and anything after the price (here a key-box code)
 *   Thursday 26 Nov · 12 – 1pm           ← date and time on one line
 *   Repeats every 2 weeks
 *   1 Example Ave                        ← address (street, then suburb)
 *   Example SA 5046, Australia
 *   Created by someone@example.com       ← ignored
 *   Team SAM + LEE                       ← kept as a note
 *   …notes…                              ← tasks and instructions
 *
 * Pure function. Returns null when the text doesn't look like a single calendar event, so other readers can try.
 */

const MARKER_RE = /\b(created by|repeats|does not repeat|organi[sz]er|invitation from|going\?|notifications?|\d+\s*(?:minutes?|hours?)\s+before|guests?)\b/i;
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const RANGE_RE = new RegExp(`${TIME}\\s*(?:[-–—~=⋅·]+|to|until)\\s*${TIME}`, 'i');
const SINGLE_RE = new RegExp(`\\b${TIME}`, 'i');

/** Icons beside each line come out of OCR as stray characters: "®", "2,", "[5]", "(YO". */
const stripIcon = (s: string) => s.replace(/^\s*(?:\[\w{1,2}\]|\d,|\(\w{1,2}|[®©™]|[A-Za-z]{1,2}[\])}|,.:]|\d(?=\s+[A-Z][a-z]))\s+(?=\S)/, '').replace(/^[^A-Za-z0-9($]+/, '').trim();

function hhmm(h: number, m: number, mer?: string): string | undefined {
  let hour = h;
  if (mer) { if (hour < 1 || hour > 12) return undefined; const pm = /^p/i.test(mer); hour = (hour % 12) + (pm ? 12 : 0); }
  if (hour > 23 || m > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "12 – 1pm" → 12:00–13:00 (the first time borrows am/pm from the second, flipped when it would run backwards). */
export function parseTimeRange(text: string): { start?: string; end?: string } {
  const r = RANGE_RE.exec(text);
  if (r) {
    const [, h1, m1, mer1, h2, m2, mer2] = r;
    let first = mer1;
    if (!first && mer2) {
      const a = Number(h1) % 12 + Number(m1 ?? 0) / 60, b = Number(h2) % 12 + Number(m2 ?? 0) / 60;
      first = a > b ? (/^p/i.test(mer2) ? 'am' : 'pm') : mer2;
    }
    const start = hhmm(Number(h1), Number(m1 ?? 0), first ?? undefined), end = hhmm(Number(h2), Number(m2 ?? 0), mer2 ?? undefined);
    if (start && end) return { start, end };
  }
  const s = SINGLE_RE.exec(text);
  if (s && s[3]) return { start: hhmm(Number(s[1]), Number(s[2] ?? 0), s[3]) };
  return {};
}

export interface CalendarCardOptions { today: string }

export function parseCalendarCard(input: string, opts: CalendarCardOptions): ParseResult | null {
  const raw = input.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (raw.length < 2 || raw.length > 60) return null;
  const lines = raw.map(stripIcon);
  // The date-and-time line: exactly one line with a date that also carries a time
  // (a weekday on its own, as in "Every 2 weeks on Monday", isn't the event's date)
  const dated = lines.map((l, i) => ({ i, d: findDate(l, opts.today) }))
    .filter((x) => x.d && /\d/.test(lines[x.i].slice(x.d.index, x.d.index + x.d.length)) && !/^(repeats|every|does not repeat)\b/i.test(lines[x.i]));
  if (dated.length !== 1) return null;
  const { i: dIdx, d } = dated[0];
  const when = parseTimeRange(lines[dIdx].slice(d!.index + d!.length));
  if (dIdx < 1 || dIdx > 3) return null; // the title sits just above the date
  const title = lines.slice(0, dIdx).join(' ');
  const { name, amount } = splitTitlePrice(title.replace(/[#*]+\s*$/, ''));
  // Needs something that says "calendar event": a price in the title, or the app's own words (Repeats, Created by, …)
  if (amount === undefined && !raw.some((l) => MARKER_RE.test(l))) return null;
  if (!name) return null;
  if (!when.start && amount === undefined) return null; // a calendar event shows its time on the date line
  // A team message with several jobs is read by the message parser instead
  if (lines.slice(dIdx + 1).filter((l) => /\(?\s*\$\s*\d/.test(l)).length > 0) return null;

  // Anything after the price in the title ("🔑 box 6049") is how to get in, or a note
  let clientName = name, extraTitle = '';
  const priceAt = title.search(/\(?\s*(?:AUD\s*|A?\$\s*)\d/i);
  if (priceAt > 0) {
    clientName = title.slice(0, priceAt).replace(/[-–—:|,\s]+$/, '').trim();
    extraTitle = title.slice(priceAt).replace(/^\(?\s*(?:AUD\s*|A?\$\s*)\d+(?:\.\d{1,2})?\s*\)?/i, '').replace(/^[^A-Za-z0-9]+/, '').trim();
  }

  const special: string[] = [], notes: string[] = [], rest: string[] = [];
  if (extraTitle) (/\b(box|key|code|lock|pin|gate)\b|\d{3,}/i.test(extraTitle) ? special : notes).push(/\b(box|key|code|lock|pin)\b/i.test(extraTitle) ? `🔑 ${extraTitle}` : extraTitle);
  let address = {} as ReturnType<typeof parseAddress>;
  const after = lines.slice(dIdx + 1);
  for (let k = 0; k < after.length; k++) {
    const l = after[k];
    // "Created by …" (wherever OCR put the icon) and any line with an email address are the calendar's, not the job's
    if (/\b(created by|organi[sz]ed by|invitation from)\b|[\w.+-]+@[\w-]+\.[\w.]+/i.test(l)) continue;
    if (/^(created by|organi[sz]er|invitation from|going\?|notifications?|\d+\s*(minutes?|hours?|days?)\s+before|guests?)/i.test(l) || /^(yes|no|maybe)(\s+(yes|no|maybe))*$/i.test(l)) continue; // RSVP buttons, not notes
    if (/^(repeats|does not repeat|every (?:day|week|\d+|other|month|fortnight|year))\b/i.test(l)) { notes.push(l); continue; }
    if (/^(team|with|crew)\b/i.test(l)) { notes.push(l); continue; }
    if (!address.line1 && isStreetLine(l)) {
      // "21 Example Rd" then the same street with its suburb on the next line: take the fuller one
      if (after[k + 1] && after[k + 1].toLowerCase().startsWith(l.toLowerCase())) continue;
      const next = after[k + 1];
      const two = next && isLocalityLine(next) && !isStreetLine(next) ? [l, next.replace(/,\s*australia$/i, '')] : [l];
      address = parseAddress(two.map((x) => x.replace(/,\s*australia$/i, '')));
      if (two.length === 2) k++;
      continue;
    }
    rest.push(l);
  }
  const text = analyseJobText(rest.map((l) => (isInstructionLine(l) || /^[•✅☑✔-]/.test(l) ? l : `• ${l}`)));
  const warnings: string[] = [];
  if (!when.start) warnings.push('No start time found — please check');
  if (!address.line1) warnings.push('No street address found');
  const job: ParsedJob = {
    tempId: 'c1', clientName: clientName.slice(0, 120), date: d!.date, startTime: when.start, endTime: when.end, amount,
    hours: when.start && when.end ? Math.round(((Number(when.end.slice(0, 2)) * 60 + Number(when.end.slice(3)) - Number(when.start.slice(0, 2)) * 60 - Number(when.start.slice(3)) + 1440) % 1440) / 60 * 100) / 100 || undefined : undefined,
    address, tasks: text.tasks ?? [], description: [text.description, notes.join(' · ')].filter(Boolean).join(' · ') || undefined,
    specialInstructions: [...special, text.specialInstructions].filter(Boolean).join(' ') || undefined,
    rooms: text.rooms, bathrooms: text.bathrooms,
    // (other people's email addresses aren't kept)
    sourceText: raw.filter((l) => !/created by|organi[sz]er|@/i.test(l)).join('\n'), confidence: Math.max(0, Math.round((0.95 - warnings.length * 0.15) * 100) / 100), warnings,
  };
  return {
    kind: 'schedule', scheduleDate: d!.date, jobs: [job], payments: [],
    summary: { jobCount: 1, paymentCount: 0, totalAmount: amount ?? 0, addressCount: address.formatted ? 1 : 0, dateCount: 1, dates: [d!.date] },
    warnings: [], unparsedLines: [],
  };
}
