import { addDays, addMonths, diffDays } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface BillLike {
  amount: number;
  frequency: Frequency;
  customIntervalDays?: number | null;
  dueDate: string;
  startDate?: string | null;
  endDate?: string | null;
  active?: boolean | null;
}

function step(date: string, freq: Frequency, n: number, anchorDay: number, customDays?: number | null): string {
  switch (freq) {
    case 'weekly': return addDays(date, 7 * n);
    case 'fortnightly': return addDays(date, 14 * n);
    case 'monthly': return addMonths(date, n, anchorDay);
    case 'quarterly': return addMonths(date, 3 * n, anchorDay);
    case 'yearly': return addMonths(date, 12 * n, anchorDay);
    case 'custom': return addDays(date, (customDays || 30) * n);
  }
}

/** All due dates of a bill within [from, to] (inclusive). */
export function billOccurrences(bill: BillLike, from: string, to: string, max = 400): string[] {
  if (bill.active === false) return [];
  const first = bill.startDate && bill.startDate > bill.dueDate ? bill.startDate : bill.dueDate;
  const anchorDay = Number(bill.dueDate.slice(8, 10));
  const out: string[] = [];
  // Jump close to `from` for daily-ish frequencies to avoid long loops
  let n = 0;
  if (from > first && (bill.frequency === 'weekly' || bill.frequency === 'fortnightly' || bill.frequency === 'custom')) {
    const interval = bill.frequency === 'weekly' ? 7 : bill.frequency === 'fortnightly' ? 14 : bill.customIntervalDays || 30;
    n = Math.max(0, Math.floor(diffDays(first, from) / interval) - 1);
  } else if (from > first) {
    const months = bill.frequency === 'monthly' ? 1 : bill.frequency === 'quarterly' ? 3 : 12;
    const fy = Number(first.slice(0, 4)), fm = Number(first.slice(5, 7));
    const ty = Number(from.slice(0, 4)), tm = Number(from.slice(5, 7));
    n = Math.max(0, Math.floor(((ty - fy) * 12 + (tm - fm)) / months) - 1);
  }
  for (let i = 0; i < max; i++, n++) {
    const d = step(first, bill.frequency, n, anchorDay, bill.customIntervalDays);
    if (d > to) break;
    if (bill.endDate && d > bill.endDate) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Normalised monthly cost of a recurring bill. */
export function monthlyEquivalent(bill: BillLike): number {
  if (bill.active === false) return 0;
  const a = bill.amount;
  switch (bill.frequency) {
    case 'weekly': return round2((a * 52) / 12);
    case 'fortnightly': return round2((a * 26) / 12);
    case 'monthly': return round2(a);
    case 'quarterly': return round2(a / 3);
    case 'yearly': return round2(a / 12);
    case 'custom': return round2((a * 365) / 12 / (bill.customIntervalDays || 30));
  }
}

export interface TaskLike {
  date: string;
  recurrence?: { frequency?: string | null; until?: string | null } | null;
}

/** Occurrence dates of a (possibly recurring) task within [from, to]. */
export function taskOccurrences(task: TaskLike, from: string, to: string, max = 400): string[] {
  const f = task.recurrence?.frequency ?? 'none';
  if (f === 'none') return task.date >= from && task.date <= to ? [task.date] : [];
  const until = task.recurrence?.until && task.recurrence.until < to ? task.recurrence.until : to;
  const out: string[] = [];
  const anchor = Number(task.date.slice(8, 10));
  for (let i = 0; i < max * 8; i++) {
    const d = f === 'daily' ? addDays(task.date, i) : f === 'weekly' ? addDays(task.date, 7 * i) : f === 'fortnightly' ? addDays(task.date, 14 * i) : addMonths(task.date, i, anchor);
    if (d > until) break;
    if (d >= from) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}
