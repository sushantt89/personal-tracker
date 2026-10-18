import { addDays } from '../utils/dates.js';

/**
 * Night work, the way you think about it rather than the way the clock writes it:
 *  - a job starting between midnight and 4am (e.g. "Sat 12am–6am") is really "Friday night": it is also listed at the
 *    end of the day before;
 *  - a job that finishes after midnight (e.g. "Fri 11pm–7am") is also listed on the next day, "until 7am".
 * The extra entries are `ghost`s: shown for planning, but hours and pay stay on the job's own date.
 */
export const EARLY_START_BEFORE = '04:00';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = { date: string; startTime?: string | null; endTime?: string | null; [k: string]: any };
export const crossesMidnight = (j: J) => !!(j.startTime && j.endTime && j.endTime <= j.startTime && j.endTime !== j.startTime);
export const startsAfterMidnight = (j: J) => !!(j.startTime && j.startTime < EARLY_START_BEFORE) && !crossesMidnight(j);

export type NightPart = 'night-before' | 'until' | 'from-night' | 'overnight';
export interface DayEntry<T extends J> { job: T; date: string; part?: NightPart; ghost: boolean; startTime?: string; endTime?: string; fromTime?: string; sortTime: string }

/** Every place a job appears, for the dates in [from, to]. Pass jobs from the day before `from` to the day after `to`. */
export function dayEntries<T extends J>(jobs: T[], from: string, to: string): DayEntry<T>[] {
  const out: DayEntry<T>[] = [];
  const inRange = (d: string) => d >= from && d <= to;
  for (const j of jobs) {
    const cross = crossesMidnight(j), early = startsAfterMidnight(j);
    if (inRange(j.date)) out.push({ job: j, date: j.date, part: cross ? 'overnight' : early ? 'from-night' : undefined, ghost: false, startTime: j.startTime ?? undefined, endTime: j.endTime ?? undefined, sortTime: j.startTime ?? '' });
    if (early) {
      const prev = addDays(j.date, -1);
      if (inRange(prev)) out.push({ job: j, date: prev, part: 'night-before', ghost: true, startTime: j.startTime!, endTime: j.endTime ?? undefined, sortTime: `${24 + Number(j.startTime!.slice(0, 2))}:${j.startTime!.slice(3)}` });
    }
    if (cross) {
      const next = addDays(j.date, 1);
      if (inRange(next)) out.push({ job: j, date: next, part: 'until', ghost: true, startTime: '00:00', endTime: j.endTime!, fromTime: j.startTime!, sortTime: '00:00' });
    }
  }
  return out.sort((a, b) => (a.date + a.sortTime).localeCompare(b.date + b.sortTime));
}
