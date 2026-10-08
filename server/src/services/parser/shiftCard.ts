import { findDate } from './dates.js';
import { parseAddress, formatAddress, stateFromPostcode, STREET_SUFFIXES } from './address.js';
import { normaliseRosterText } from './roster.js';
import type { ParsedAddress, ParsedJob, ParseResult } from './types.js';

/**
 * Rule-based reader for a single "shift details" screen from a rostering app (usually a screenshot run through OCR):
 *
 *   Shift details
 *   Jordan Example weekly wednesdays        ← title: who / what the shift is
 *   Current shift status   Confirmed
 *   Thursday, Oct 08, 2026
 *   1:00 PM – 3:00 PM (2:00 hours)
 *   Job
 *   Cleaning (ACS)
 *   Apartment 12, Level 3, 9 Sample Street Adelaide
 *   5000
 *   Attachments
 *   …notes…
 *   Published by  Bright Agency
 *
 * Works for any app with this shape: one date, one start–finish time, and words such as "shift", "published by" or "timeclock".
 * Pure function. Returns null when the text doesn't look like this, so other readers can try.
 */

const TIME_SRC = String.raw`\d{1,2}(?:[:.]?\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}`;
// OCR often reads the dash between the times as \"=\", \"~\" or a long dash
const RANGE_RE = new RegExp(`(${TIME_SRC})\\s*(?:[-–—=~]+|to|until|till)\\s*(${TIME_SRC})`, 'i');
const MARKER_RE = /\b(shift\s+details?|shift\s+status|published\s+by|open\s+time\s*clock|find\s+a\s+replacement|clock\s+in|assigned\s+to|shift\s+notes?)\b/i;
const HOURS_HM_RE = /\b(\d{1,2}):(\d{2})\s*(?:hrs?|hours?|h)\b/i;
const HOURS_DEC_RE = /\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:hrs?|hours?)\b/i;
const STREET_ANY_RE = new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+(?:[a-z'.-]+\\s+){0,4}?(?:${STREET_SUFFIXES.join('|')})\\b`, 'i');
const UNIT_START_RE = /\b(?:apartment|apt|unit|level|lvl|suite|shop|flat|lot|floor|villa|townhouse)\b|\d/i;
/** Lines that are part of the app's screen, not of the shift */
const CHROME_RE = /^(?:shift\s+details?|current\s+shift\s+status|confirmed|pending|accepted|declined|open\s+time\s*clock|chat|attachments?|job|notes?|details|location|address)$/i;
const NOTES_LABEL_RE = /\b(attachments?|notes?|instructions?|comments?|description|details)\s*:?\s*$/i;
const NOTES_END_RE = /\b(find\s+a\s+replacement|published\s+by|open\s+time\s*clock|assigned\s+to|clock\s+in)\b/i;
const SCHEDULE_WORDS_RE = /\b(?:weekly|fortnightly|monthly|daily|every|each|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|am|pm|morning|afternoon|evening|shift|regular|recurring|clean|cleaning)\b/gi;

function parseTime(text: string): string | undefined {
  const m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b(\d{1,2}):(\d{2})(?![\d/])/i.exec(text);
  if (!m) return undefined;
  let h = Number(m[1] ?? m[4]);
  const min = Number(m[2] ?? m[5] ?? 0);
  if (m[3]) { if (h < 1 || h > 12) return undefined; h = (h % 12) + (/^p/i.test(m[3]) ? 12 : 0); }
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/** Icons next to a line are often read as one or two stray characters ("my Apartment…", "1] Job", "® Attachments"). */
const stripIcon = (s: string) => s.replace(/^[^A-Za-z0-9(]+/, '').replace(/^[A-Za-z0-9]{1,2}[\])}'’`.:|]*\s+(?=\S)/, '').trim();
const tidy = (s: string) => s.replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();

export interface ShiftCardOptions { today: string }

export function parseShiftCard(input: string, opts: ShiftCardOptions): (ParseResult & { publisher?: string }) | null {
  if (!MARKER_RE.test(input)) return null;
  // A team message listing several priced jobs isn't a single shift screen (it has more than one time range anyway)
  if ((input.match(/\$\s*\d/g) ?? []).length > 2) return null;
  // Raw lines keep the wide gaps OCR leaves between columns (e.g. a map thumbnail beside the title); `lines` collapses them
  const rawLines = normaliseRosterText(input).split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = rawLines.map((l) => l.replace(/\s+/g, ' ').trim());
  const dateIdx = lines.map((l, i) => (findDate(l, opts.today) ? i : -1)).filter((i) => i >= 0);
  const rangeIdx = lines.map((l, i) => (RANGE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  // Exactly one shift on the screen
  if (new Set(dateIdx.map((i) => findDate(lines[i], opts.today)!.date)).size !== 1 || rangeIdx.length !== 1) return null;
  const dIdx = dateIdx[0], rIdx = rangeIdx[0];
  const date = findDate(lines[dIdx], opts.today)!.date;
  const range = RANGE_RE.exec(lines[rIdx])!;
  const start = parseTime(range[1]), end = parseTime(range[2]);
  if (!start || !end) return null;
  const used = new Set<number>([dIdx, rIdx]);
  const warnings: string[] = [];

  // Hours: written beside the times ("(2:00 hours)"), otherwise start to finish
  const hm = HOURS_HM_RE.exec(lines[rIdx]), hd = hm ? null : HOURS_DEC_RE.exec(lines[rIdx].replace(range[0], ' '));
  let diff = toMin(end) - toMin(start); if (diff <= 0) diff += 1440;
  const hours = hm ? Number(hm[1]) + Number(hm[2]) / 60 : hd ? Number(hd[1]) : diff / 60;

  // Who published it (the agency / employer)
  let publisher: string | undefined;
  lines.forEach((l, i) => {
    const m = /published\s+by\s*:?\s*(.*)$/i.exec(l);
    if (!m) return;
    used.add(i);
    const name = tidy(m[1].replace(/[\[(]\s*\d*\s*[\])]/g, ' ').replace(/\bchat\b.*$/i, ' ').replace(/^[^A-Za-z0-9]+/, '').replace(/^[A-Za-z0-9]\s+(?=[A-Z])/, ''));
    if (name.length >= 2) publisher = name.slice(0, 120);
  });

  // Title: the lines above the date that aren't part of the app's own screen
  const titleLines: string[] = [];
  for (let i = 0; i < Math.min(dIdx, rIdx); i++) {
    const raw = lines[i];
    // Only the left-hand column: text after a wide gap is usually the map preview read as letters
    const bare = stripIcon(rawLines[i].split(/\s{4,}/)[0]).replace(/[^A-Za-z0-9() ]+$/g, '').trim();
    used.add(i);
    if (/shift\s+details?/i.test(raw)) { titleLines.length = 0; continue; } // everything before the header is the phone's status bar
    if (!bare || CHROME_RE.test(bare) || /shift\s+status/i.test(raw)) continue;
    if (/^\d{1,2}:\d{2}\b/.test(raw) && !/[a-z]{4}/i.test(raw)) continue; // clock in the status bar
    if (!/[A-Za-z]{3}/.test(bare)) continue; // stray letters from icons or the map ("iL", "Ty")
    titleLines.push(bare);
  }
  const title = tidy(titleLines.join(' ')).slice(0, 160);
  // "(CC)"-style agency codes and schedule words ("Monthly") aren't part of the person's name
  const person = tidy(title.replace(/\(\s*[A-Z0-9]{1,5}\s*\)/g, ' ').replace(SCHEDULE_WORDS_RE, ' ').replace(/[-–|,:()]+/g, ' '));

  // Role: the line under "Job"
  let role = '';
  const jobIdx = lines.findIndex((l, i) => i > rIdx && /^job$/i.test(stripIcon(l).replace(/[^A-Za-z]/g, '')));
  if (jobIdx >= 0) { used.add(jobIdx); if (lines[jobIdx + 1] && !STREET_ANY_RE.test(lines[jobIdx + 1])) { role = tidy(stripIcon(lines[jobIdx + 1])); used.add(jobIdx + 1); } }

  // Address: the first line with a street in it, plus a postcode that wrapped onto the next line
  let address: ParsedAddress = {};
  const aIdx = lines.findIndex((l, i) => i > rIdx && !used.has(i) && STREET_ANY_RE.test(l));
  if (aIdx >= 0) {
    used.add(aIdx);
    let text = lines[aIdx];
    const from = text.search(UNIT_START_RE);
    if (from > 0) text = text.slice(from);
    const next = lines[aIdx + 1] ?? '';
    const pc = /^[^A-Za-z0-9]*(?:[A-Za-z]{1,2}[^A-Za-z0-9]*\s+)?(\d{4})$/.exec(next);
    if (pc && !/\b\d{4}\b\s*$/.test(text)) { text += ` ${pc[1]}`; used.add(aIdx + 1); }
    const street = STREET_ANY_RE.exec(text)!;
    const prefix = tidy(text.slice(0, street.index).replace(/[,\s]+$/, ''));
    const parsed = parseAddress([text.slice(street.index)]);
    const line1 = [prefix, parsed.line1].filter(Boolean).join(', ');
    address = { ...parsed, line1, state: parsed.state ?? (parsed.postcode ? stateFromPostcode(parsed.postcode) : undefined) };
    if (address.state && !address.country) address.country = 'Australia';
    address.formatted = formatAddress(address);
  } else warnings.push('No street address found');

  // Notes: what is written under "Attachments" / "Notes", up to the people and buttons at the bottom
  const noteLines: string[] = [];
  const nIdx = lines.findIndex((l, i) => i > rIdx && NOTES_LABEL_RE.test(stripIcon(l)));
  const startAt = nIdx >= 0 ? nIdx + 1 : Math.max(aIdx, jobIdx + 1, rIdx) + 1;
  if (nIdx >= 0) used.add(nIdx);
  for (let i = startAt; i < lines.length; i++) {
    if (NOTES_END_RE.test(lines[i])) break;
    if (used.has(i)) continue;
    used.add(i);
    const l = lines[i];
    if (/^\d{1,2}(?::\d{2}|\.\d{1,2})?\s*(?:hrs?|hours?)$/i.test(l)) continue; // "2hrs" repeats the length of the shift
    if (!/[A-Za-z]{3}/.test(l)) continue; // icons and buttons at the bottom read as stray letters ("a Ca —")
    noteLines.push(l);
  }
  // "3h + $20 fuel", "Fuel allowance $15", "$10 petrol": an allowance paid on top of the shift
  let fuelAllowance: number | undefined;
  for (const l of noteLines) {
    const f = /\$\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:of\s+)?(?:fuel|petrol|travel)\b/i.exec(l) ?? /\b(?:fuel|petrol|travel)(?:\s+allowance)?\s*[:=-]?\s*\$\s*(\d{1,4}(?:\.\d{1,2})?)/i.exec(l);
    if (f) { fuelAllowance = Number(f[1]); break; }
  }
  // Wrapped lines are joined back into sentences; a new "Label:" line or a "- " point starts a new line
  const paras: string[] = [];
  for (const l of noteLines) {
    if (!paras.length || /^(?:[-•*]\s|[A-Z][A-Za-z ()/{}]{1,30}:)/.test(l) || /[.!?:]$/.test(paras[paras.length - 1]) && /^[A-Z]/.test(l)) paras.push(l);
    else paras[paras.length - 1] += ` ${l}`;
  }
  const notes = paras.map(tidy).join('\n').slice(0, 1500);
  // Room counts written in the notes ("Bedrooms: 3 Bedrooms", "Bathrooms: 2")
  const count = (re: RegExp) => { const m = re.exec(notes); return m ? Number(m[1]) : undefined; };
  const rooms = count(/\bbed\s*rooms?\s*:?\s*(\d{1,2})\b/i), bathrooms = count(/\bbath\s*rooms?\s*:?\s*(\d{1,2})\b/i);

  if (!person) warnings.push('Check the client name');
  if (hours <= 0 || hours > 16) warnings.push('Unusual shift length — please check the times');
  const job: ParsedJob = {
    tempId: 's1',
    clientName: (person || title || publisher || '').slice(0, 120),
    date, startTime: start, endTime: end, hours: Math.round(hours * 100) / 100, fuelAllowance, rooms, bathrooms,
    address,
    description: [role, title && title !== person ? title : ''].filter(Boolean).join(' · ') || undefined,
    tasks: [],
    specialInstructions: notes || undefined,
    sourceText: lines.join('\n'),
    confidence: Math.max(0, Math.round((0.95 - warnings.length * 0.15) * 100) / 100),
    warnings,
  };
  return {
    kind: 'schedule', scheduleDate: date, jobs: [job], payments: [], publisher,
    summary: { jobCount: 1, paymentCount: 0, totalAmount: 0, addressCount: address.formatted ? 1 : 0, dateCount: 1, dates: [date] },
    warnings: [], unparsedLines: [],
  };
}
