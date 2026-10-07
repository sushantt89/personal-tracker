import { findDate } from './dates.js';
import { isStreetLine, parseAddress, formatAddress } from './address.js';
import type { ParsedAddress, ParsedJob, ParseResult } from './types.js';

/**
 * Rule-based reader for employer rosters / shift lists (typically a screenshot run through OCR).
 * Works for any employer: it looks for dates, start and finish times, hours, a location and a role.
 * Pure function: no I/O, never saves anything. The caller shows the result for review.
 *
 * Understands, for example:
 *   Tuesday 06/Oct/2026            Mon 6 Oct  10:00pm - 1:00am        Shift date: 6/10/2026
 *   DARLINGTON SA                  Front counter                      Start time: 22:00
 *   Start 10:00 PM Tuesday …       Wed 7 Oct  9:30pm - 1:00am         End time: 01:00
 *   Finish 1:00 AM Wednesday …
 *   3:00hrs
 */

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const isMonth = (s: string) => s.length >= 3 && MONTH_NAMES.some((m) => m === s || (s.length <= 4 && m.startsWith(s.slice(0, 3)) && (s.length === 3 || s === 'sept')));
/** OCR often reads the letter O as zero, l as 1 and S as 5 inside month names ("0ct", "0Oct", "Ju1"). */
const fixMonthToken = (raw: string): string | null => {
  const t = raw.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/^oo/, 'o');
  return isMonth(t) ? t.charAt(0).toUpperCase() + t.slice(1) : null;
};

/** "06/0ct/2026", "6-Oct-26", "06.Oct.2026" → "6 Oct 2026" so the shared date reader understands it. */
export function normaliseRosterText(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\b(\d{1,2})\s*[/.\-\s]\s*([A-Za-z0-9]{3,9})\s*[/.\-\s,]\s*(\d{4}|\d{2})\b/g, (all, d: string, mon: string, y: string) => {
      const m = /[A-Za-z]/.test(mon) ? fixMonthToken(mon) : null;
      return m ? `${Number(d)} ${m} ${y.length === 2 ? '20' + y : y}` : all;
    });
}

const START_RE = /^(?:shift\s+)?(?:start(?:s|ing|ed)?|begin(?:s|ning)?|commenc(?:e|es|ing)|from|clock(?:ed)?\s*-?\s*in|time\s+in|in)\b(?:\s+time)?\s*[:\-]?\s*(.*)$/i;
const FINISH_RE = /^(?:shift\s+)?(?:finish(?:es|ing|ed)?|end(?:s|ing|ed)?|until|till|to|clock(?:ed)?\s*-?\s*out|time\s+out|out)\b(?:\s+time)?\s*[:\-]?\s*(.*)$/i;
const TIME_SRC = String.raw`\d{1,2}(?:[:.]?\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}`;
const RANGE_RE = new RegExp(`(${TIME_SRC})\\s*(?:-|to|until|till)\\s*(${TIME_SRC})`, 'i');
const HOURS_HM_RE = /\b(\d{1,2}):(\d{2})\s*(?:hrs?|hours?|h)\b/i;
const HOURS_DEC_RE = /\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:hrs?|hours?)\b/i;
/** A line about a break inside a shift: "Break time 4:00 AM - 4:30 AM", "6:30hrs + 0:30hrs Break", "Meal break: 30 min" */
const BREAK_RE = /\b(?:breaks?|meal|lunch|rest\s+period|unpaid)\b/i;
const IGNORE_RE = /\b(?:view(?:ed)?|published|acknowledg\w*|printed|generated|last\s+updated|updated\s+(?:at|on)|page\s+\d+|swap|offer(?:ed)?\s+shift)\b/i;
const STATE_RE = /^(.{2,60}?)[,\s]+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(?:[,\s]+(\d{4}))?$/i;
const LABEL_RE = /^(?:location|site|store|venue|where|workplace|department|dept|area|role|position|job|duty|duties|task|section|station)\s*[:\-]\s*(.+)$/i;
const LOCATION_LABEL_RE = /^(?:location|site|store|venue|where|workplace)\b/i;

/** Roster times are taken literally: "6:00" is 6 in the morning and "22:00" is 10 at night, unless am/pm says otherwise. */
function parseTime(text: string): string | undefined {
  const m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b(\d{1,2}):(\d{2})(?![\d/])/i.exec(text);
  if (!m) return undefined;
  let h = Number(m[1] ?? m[4]);
  const min = Number(m[2] ?? m[5] ?? 0);
  if (m[3]) {
    const pm = /^p/i.test(m[3]);
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

interface Draft { date?: string; start?: string; end?: string; endDate?: string; hours?: number; location?: string; extras: string[]; source: string[]; labelled: boolean; /** unpaid break, in minutes */ breakMin?: number; breakText?: string; /** the roster itself said the hours are after the break ("6:30hrs + 0:30hrs Break") */ hoursExcludeBreak?: boolean }

function locationToAddress(text: string): ParsedAddress {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (isStreetLine(clean)) return parseAddress([clean]);
  const m = STATE_RE.exec(clean);
  if (m) {
    const a: ParsedAddress = { suburb: titleCase(m[1].replace(/,$/, '').trim()), state: m[2].toUpperCase(), postcode: m[3] };
    return { ...a, formatted: formatAddress(a) };
  }
  return { formatted: clean };
}

export interface RosterOptions { today: string; /** Name of the employer the shifts are for */ employer?: string }

/** Returns null when the text does not look like a roster, so the caller can try the message parser instead. */
export function parseRoster(input: string, opts: RosterOptions): ParseResult | null {
  const lines = normaliseRosterText(input).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const drafts: Draft[] = [];
  const unparsed: string[] = [];
  let cur: Draft | null = null;
  let headerDate: string | undefined;
  const fresh = (date?: string): Draft => ({ date, extras: [], source: [], labelled: false });
  const hasTimes = (d: Draft | null) => Boolean(d && (d.start || d.end));
  const close = () => { if (cur && (hasTimes(cur) || cur.date)) drafts.push(cur); cur = null; };

  for (const line of lines) {
    if (IGNORE_RE.test(line)) continue;
    const startM = START_RE.exec(line);
    const finishM = startM ? null : FINISH_RE.exec(line);
    const labelled = (startM && parseTime(startM[1])) || (finishM && parseTime(finishM[1]));
    const range = labelled ? null : RANGE_RE.exec(line);
    const date = findDate(line, opts.today)?.date;

    if (startM && parseTime(startM[1])) {
      if (cur?.start) close();
      cur ??= fresh(headerDate);
      cur.start = parseTime(startM[1]);
      cur.labelled = true;
      if (date) cur.date = date; // the date written next to the start time is the shift's own date
      cur.source.push(line);
      continue;
    }
    if (finishM && parseTime(finishM[1])) {
      cur ??= fresh(headerDate);
      cur.end = parseTime(finishM[1]);
      cur.labelled = true;
      if (date) cur.endDate = date;
      cur.source.push(line);
      continue;
    }
    // A break belongs to the shift it sits in — it is never a shift of its own, and it is not paid
    if (BREAK_RE.test(line) && cur && !date) {
      const allHm = [...line.matchAll(new RegExp(HOURS_HM_RE.source, 'gi'))];
      const mins = /\b(\d{1,3})\s*(?:min|mins|minutes)\b/i.exec(line);
      if (range) {
        let diff = toMin(parseTime(range[2])!) - toMin(parseTime(range[1])!);
        if (diff < 0) diff += 24 * 60;
        cur.breakMin = diff;
        cur.breakText = `${range[1].trim()} – ${range[2].trim()}`;
      } else if (allHm.length >= 2) {
        // "6:30hrs + 0:30hrs Break": worked hours first, then the break
        cur.hours = Number(allHm[0][1]) + Number(allHm[0][2]) / 60;
        cur.hoursExcludeBreak = true;
        cur.breakMin ??= Number(allHm[allHm.length - 1][1]) * 60 + Number(allHm[allHm.length - 1][2]);
      } else if (allHm.length === 1) cur.breakMin ??= Number(allHm[0][1]) * 60 + Number(allHm[0][2]);
      else if (mins) cur.breakMin ??= Number(mins[1]);
      else {
        const hd = HOURS_DEC_RE.exec(line);
        if (hd) cur.breakMin ??= Math.round(Number(hd[1]) * 60);
      }
      cur.source.push(line);
      continue;
    }
    if (range) {
      if (hasTimes(cur)) close();
      cur ??= fresh(date ?? headerDate);
      if (date) { cur.date = date; headerDate = date; }
      cur.start = parseTime(range[1]);
      cur.end = parseTime(range[2]);
      const rest = line.replace(range[0], ' ').replace(HOURS_HM_RE, ' ').replace(HOURS_DEC_RE, ' ');
      const hm = HOURS_HM_RE.exec(line), hd = HOURS_DEC_RE.exec(line);
      if (hm) cur.hours = Number(hm[1]) + Number(hm[2]) / 60;
      else if (hd) cur.hours = Number(hd[1]);
      // Words left on the line after removing the date and times (e.g. a role)
      const dm = findDate(rest, opts.today);
      const leftover = (dm ? rest.slice(0, dm.index) + ' ' + rest.slice(dm.index + dm.length) : rest).replace(/[|,;()\-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (leftover.length > 2 && /[a-z]{3}/i.test(leftover)) cur.extras.push(leftover);
      cur.source.push(line);
      continue;
    }
    const hm = HOURS_HM_RE.exec(line), hd = hm ? null : HOURS_DEC_RE.exec(line);
    if ((hm || hd) && line.length < 40 && cur) {
      cur.hours = hm ? Number(hm[1]) + Number(hm[2]) / 60 : Number(hd![1]);
      cur.source.push(line);
      continue;
    }
    const bare = line.replace(/\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?/g, ' ');
    if (date && parseTime(bare) && !hasTimes(cur?.date === date ? cur : null)) {
      // "Mon 6 Oct 10:00pm" — a date with a single time is a shift start
      if (cur?.date !== date) { close(); cur = fresh(date); }
      headerDate = date;
      cur!.start = parseTime(bare);
      cur!.source.push(line);
      continue;
    }
    if (date && !parseTime(line.replace(/\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?/g, ' '))) {
      // A line that is just a date starts a new day
      close();
      headerDate = date;
      cur = fresh(date);
      cur.source.push(line);
      continue;
    }
    if (cur) {
      const lab = LABEL_RE.exec(line);
      const text = lab ? lab[1].trim() : line;
      if (!cur.location && (LOCATION_LABEL_RE.test(line) || STATE_RE.test(text) || isStreetLine(text))) cur.location = text;
      else cur.extras.push(text);
      cur.source.push(line);
    } else unparsed.push(line);
  }
  close();

  const shifts = drafts.filter((d) => d.start && d.date);
  const labelledShifts = shifts.filter((d) => d.labelled && d.end).length;
  // Be sure this really is a roster before taking over from the message parser
  const looksLikeRoster = labelledShifts >= 1 || (shifts.length >= 2 && shifts.every((d) => d.end) && !/\$\s*\d/.test(input));
  if (!shifts.length || !looksLikeRoster) return null;

  const result: ParseResult = {
    kind: 'schedule', jobs: [], payments: [],
    summary: { jobCount: 0, paymentCount: 0, totalAmount: 0, addressCount: 0, dateCount: 0, dates: [] },
    warnings: [], unparsedLines: unparsed,
  };
  const employer = opts.employer?.trim() ?? '';
  shifts.forEach((d, i) => {
    const warnings: string[] = [];
    let confidence = 0.95;
    let hours = d.hours;
    if (d.start && d.end) {
      let diff = toMin(d.end) - toMin(d.start);
      if (diff <= 0) diff += 24 * 60; // finishes after midnight
      if (hours === undefined) hours = diff / 60;
      // The break is unpaid: take it off unless the roster's own figure already left it out
      if (d.breakMin && !d.hoursExcludeBreak && d.breakMin < diff && Math.abs(hours * 60 - diff) < 1) hours = (diff - d.breakMin) / 60;
    }
    if (!d.end) { warnings.push('No finish time found'); confidence -= 0.2; }
    if (d.endDate && d.date && d.endDate < d.date) { warnings.push('The finish date is before the start date — please check'); confidence -= 0.2; }
    if (hours !== undefined && (hours <= 0 || hours > 16)) { warnings.push('Unusual shift length — please check the times'); confidence -= 0.2; }
    if (!employer) warnings.push('Choose the employer for these shifts');
    // "PB:Production Beginner" → "Production Beginner"
    const role = d.extras.map((e) => e.replace(/^[A-Z0-9]{1,4}\s*:\s*/, '').trim()).filter(Boolean).join(' · ');
    const breakNote = d.breakMin ? `Unpaid break ${d.breakText ? `${d.breakText} ` : ''}(${d.breakMin} min)` : '';
    const job: ParsedJob = {
      tempId: `r${i + 1}`,
      clientName: employer,
      date: d.date,
      startTime: d.start,
      endTime: d.end,
      hours: hours !== undefined ? Math.round(hours * 100) / 100 : undefined,
      address: d.location ? locationToAddress(d.location) : {},
      description: [role, breakNote].filter(Boolean).join(' · ') || undefined,
      tasks: [],
      sourceText: d.source.join('\n'),
      confidence: Math.max(0, Math.round(confidence * 100) / 100),
      warnings,
    };
    result.jobs.push(job);
  });
  const dates = Array.from(new Set(result.jobs.map((j) => j.date!))).sort();
  result.summary = { jobCount: result.jobs.length, paymentCount: 0, totalAmount: 0, addressCount: result.jobs.filter((j) => j.address.formatted).length, dateCount: dates.length, dates };
  const incomplete = drafts.length - shifts.length;
  if (incomplete > 0) result.warnings.push(`${incomplete} entr${incomplete === 1 ? 'y' : 'ies'} had a date but no start time and ${incomplete === 1 ? 'was' : 'were'} left out.`);
  return result;
}
