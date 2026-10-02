const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function isValid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Choose a year for a day/month without a year: the occurrence closest to "now", preferring the future. */
function inferYear(m: number, d: number, today: string): number {
  const y = Number(today.slice(0, 4));
  const candidate = fmt(y, m, d);
  const diff = daysBetween(today, candidate);
  if (diff < -60) return y + 1; // e.g. today is 20 Dec, message says 3 Jan
  if (diff > 305) return y - 1;
  return y;
}

function addDays(s: string, n: number) {
  const dt = new Date(s + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export interface DateMatch {
  date: string;
  index: number;
  length: number;
}

/** Finds the first date expression in a string. `today` is YYYY-MM-DD in the user's timezone. */
export function findDate(text: string, today: string): DateMatch | null {
  const candidates: DateMatch[] = [];
  const push = (date: string | null, m: RegExpExecArray) => {
    if (date) candidates.push({ date, index: m.index, length: m[0].length });
  };

  // ISO: 2026-10-02
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) push(isValid(+m[1], +m[2], +m[3]) ? fmt(+m[1], +m[2], +m[3]) : null, m);

  // "Friday 2 OCT", "2nd October 2026", "Fri, 2 Oct"
  m = new RegExp(`\\b(?:(?:${WEEKDAY_RE})\\.?,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?,?(?:\\s+(\\d{4}))?`, 'i').exec(text);
  if (m) {
    const d = +m[1], mo = MONTHS[m[2].toLowerCase()];
    const y = m[3] ? +m[3] : inferYear(mo, d, today);
    push(isValid(y, mo, d) ? fmt(y, mo, d) : null, m);
  }

  // "October 2", "Oct 2nd, 2026"
  m = new RegExp(`\\b(?:(?:${WEEKDAY_RE})\\.?,?\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s+(\\d{4}))?`, 'i').exec(text);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    const y = m[3] ? +m[3] : inferYear(mo, d, today);
    push(isValid(y, mo, d) ? fmt(y, mo, d) : null, m);
  }

  // Australian numeric: 2/10, 02/10/2026, 2.10.26
  m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b/.exec(text);
  if (m && !/\d[/.]\d+\s*(?:am|pm)/i.test(m[0] + text.slice(m.index + m[0].length, m.index + m[0].length + 3))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : inferYear(mo, d, today);
    if (y < 100) y += 2000;
    push(isValid(y, mo, d) ? fmt(y, mo, d) : null, m);
  }

  // Relative words
  m = /\b(today|tonight|tomorrow)\b/i.exec(text);
  if (m) push(m[1].toLowerCase() === 'tomorrow' ? addDays(today, 1) : today, m);

  // Bare weekday: "for Friday" -> next occurrence (today counts)
  if (!candidates.length) {
    m = new RegExp(`\\b(?:this\\s+|next\\s+)?(${WEEKDAY_RE})\\b`, 'i').exec(text);
    if (m) {
      const target = WEEKDAYS[m[1].toLowerCase()];
      const dow = new Date(today + 'T00:00:00Z').getUTCDay();
      let delta = (target - dow + 7) % 7;
      if (/^next\s/i.test(m[0]) && delta === 0) delta = 7;
      push(addDays(today, delta), m);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  return candidates[0];
}
