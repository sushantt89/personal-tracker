/**
 * Dates are stored as calendar strings "YYYY-MM-DD" and times as "HH:mm".
 * This avoids timezone drift for a personal planner: a job on 2 Oct is on 2 Oct
 * regardless of server timezone. String comparison is chronological.
 */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today's date string in the given IANA timezone. */
export function todayIn(timezone = 'Australia/Adelaide', now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return parts; // en-CA gives YYYY-MM-DD
  } catch {
    return toDateStr(now);
  }
}

export function addDays(s: string, n: number): string {
  const d = parseDateStr(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

export function addMonths(s: string, n: number, anchorDay?: number): string {
  const d = parseDateStr(s);
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateStr(target);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDateStr(b).getTime() - parseDateStr(a).getTime()) / 86400000);
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + '01';
}

export function monthEnd(s: string): string {
  return addDays(addMonths(monthStart(s), 1), -1);
}

/** Monday-based week start. */
export function weekStart(s: string): string {
  const d = parseDateStr(s);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(s, -dow);
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function lastNMonths(endDate: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(monthStart(endDate), -i)));
  return out;
}

export function minutesBetween(start?: string, end?: string): number | undefined {
  if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) return undefined;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  // A finish time earlier than the start means the shift runs past midnight
  return diff > 0 ? diff : diff < 0 ? diff + 24 * 60 : undefined;
}
