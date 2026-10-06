/**
 * Hours worked per fortnight against a limit the user sets.
 * A fortnight is two Monday-to-Sunday weeks. Two ways of counting:
 *  - rolling: every two weeks in a row are checked (this week with last week, and this week with next week)
 *  - fixed:   fortnights run back-to-back from a start date (e.g. a pay fortnight)
 * Hours are a shift's paid hours when recorded, otherwise its start-to-finish time. A shift counts in the week it starts.
 */
import { Types } from 'mongoose';
import { Job, Settings } from '../models/index.js';
import { addDays, diffDays, weekStart } from '../utils/dates.js';
import { jobHours } from './finance.js';
import { round2 } from '../utils/money.js';

export const WORK_TYPES = ['employee', 'subcontract', 'own'] as const;
export interface WorkHoursSettings { hoursLimit: number; fortnightMode: 'rolling' | 'fixed'; fortnightAnchor: string; countTypes: string[]; excludeEmployers: string[] }

export async function workHoursSettings(userId: string): Promise<WorkHoursSettings> {
  const s = await Settings.findOne({ userId }).select('work').lean();
  const w: any = (s as any)?.work ?? {};
  return {
    hoursLimit: Number(w.hoursLimit) || 0,
    fortnightMode: w.fortnightMode === 'fixed' ? 'fixed' : 'rolling',
    fortnightAnchor: typeof w.fortnightAnchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.fortnightAnchor) ? weekStart(w.fortnightAnchor) : '2026-01-05',
    countTypes: Array.isArray(w.countTypes) && w.countTypes.length ? w.countTypes : [...WORK_TYPES],
    excludeEmployers: Array.isArray(w.excludeEmployers) ? w.excludeEmployers.filter((x: unknown) => typeof x === 'string') : [],
  };
}

export interface HoursWeek { from: string; to: string; worked: number; scheduled: number; total: number; state: 'past' | 'current' | 'future' }
export interface HoursWindow { from: string; to: string; worked: number; scheduled: number; total: number; remaining: number | null; over: number; percent: number | null; status: 'ok' | 'near' | 'over' | 'none'; current: boolean; future: boolean }

const employerOf = (j: any) => (j.workType === 'own' || !j.workType ? 'Own business' : j.contractorName || j.clientName || (j.workType === 'employee' ? 'Employer' : 'Contractor'));

export async function workHours(userId: string, today: string, opts: { weeksBack?: number; weeksAhead?: number } = {}) {
  const s = await workHoursSettings(userId);
  const ws = weekStart(today);
  const back = opts.weeksBack ?? 8, ahead = opts.weeksAhead ?? 4;
  const first = addDays(ws, -7 * back), last = addDays(ws, 7 * ahead + 6);
  const typeFilter = s.countTypes.includes('own') ? { $or: [{ workType: { $in: s.countTypes } }, { workType: null }] } : { workType: { $in: s.countTypes } };
  const found = await Job.find({ userId: new Types.ObjectId(userId), date: { $gte: first, $lte: last }, status: { $ne: 'cancelled' }, ...typeFilter })
    .select('date startTime endTime hoursWorked status workType clientName contractorName title excludeFromHours').sort({ date: 1, startTime: 1 }).lean();
  // Work the user has chosen to leave out: whole employers (e.g. cash work), or single jobs marked "don't count"
  const skipNames = new Set(s.excludeEmployers.map((x) => x.toLowerCase()));
  const leftOut = (j: any) => Boolean(j.excludeFromHours) || skipNames.has(employerOf(j).toLowerCase());
  const jobs = found.filter((j) => !leftOut(j));
  const skipped = found.filter(leftOut);

  const done = (j: any) => j.status === 'completed' || j.date < today;
  const weeks: HoursWeek[] = [];
  for (let i = -back; i <= ahead; i++) {
    const from = addDays(ws, 7 * i), to = addDays(from, 6);
    const js = jobs.filter((j) => j.date >= from && j.date <= to);
    const worked = round2(js.filter(done).reduce((a, j) => a + jobHours(j), 0));
    const scheduled = round2(js.filter((j) => !done(j)).reduce((a, j) => a + jobHours(j), 0));
    weeks.push({ from, to, worked, scheduled, total: round2(worked + scheduled), state: i < 0 ? 'past' : i === 0 ? 'current' : 'future' });
  }

  // Fortnights: every pair of weeks in a row, or only the pairs lined up with the start date
  const limit = s.hoursLimit;
  const windows: HoursWindow[] = [];
  for (let i = 0; i + 1 < weeks.length; i++) {
    const a = weeks[i], b = weeks[i + 1];
    if (s.fortnightMode === 'fixed' && Math.abs(Math.round(diffDays(s.fortnightAnchor, a.from) / 7)) % 2 !== 0) continue;
    const worked = round2(a.worked + b.worked), scheduled = round2(a.scheduled + b.scheduled), total = round2(worked + scheduled);
    const over = limit > 0 ? Math.max(0, round2(total - limit)) : 0;
    windows.push({
      from: a.from, to: b.to, worked, scheduled, total,
      remaining: limit > 0 ? Math.max(0, round2(limit - total)) : null, over,
      percent: limit > 0 ? Math.round((total / limit) * 100) : null,
      status: limit <= 0 ? 'none' : over > 0 ? 'over' : total >= limit * 0.9 ? 'near' : 'ok',
      current: a.from <= today && b.to >= today, future: a.from > today,
    });
  }
  const live = windows.filter((w) => w.current);
  // The fortnight to look at first: the fullest one that includes today
  const current = [...live].sort((x, y) => y.total - x.total)[0] ?? null;
  // How many more hours can be taken on this week without any fortnight that includes it going over
  const roomThisWeek = limit > 0 && live.length ? Math.max(0, round2(Math.min(...live.map((w) => limit - w.total)))) : null;

  const inCurrent = current ? jobs.filter((j) => j.date >= current.from && j.date <= current.to) : [];
  const by = new Map<string, { name: string; hours: number; shifts: number }>();
  for (const j of inCurrent) { const k = employerOf(j); const e = by.get(k) ?? { name: k, hours: 0, shifts: 0 }; e.hours = round2(e.hours + jobHours(j)); e.shifts++; by.set(k, e); }
  const shifts = inCurrent.map((j) => ({ id: String(j._id), date: j.date, startTime: j.startTime, endTime: j.endTime, hours: round2(jobHours(j)), employer: employerOf(j), label: j.clientName || j.title || 'Job', done: done(j) }));

  // Every employer seen in this period, so the settings can offer them to leave out
  const names = new Map<string, { name: string; hours: number; counted: boolean }>();
  for (const j of found) { const k = employerOf(j); const e = names.get(k) ?? { name: k, hours: 0, counted: !skipNames.has(k.toLowerCase()) }; e.hours = round2(e.hours + jobHours(j)); names.set(k, e); }
  for (const n of s.excludeEmployers) if (![...names.keys()].some((k) => k.toLowerCase() === n.toLowerCase())) names.set(n, { name: n, hours: 0, counted: false });
  const skippedNow = current ? skipped.filter((j) => j.date >= current.from && j.date <= current.to) : [];

  return {
    today, settings: s, limit, weeks, windows, current, roomThisWeek,
    employers: [...names.values()].sort((a, b) => a.name.localeCompare(b.name)),
    /** Hours in the current fortnight that were left out on purpose */
    notCounted: { hours: round2(skippedNow.reduce((a, j) => a + jobHours(j), 0)), shifts: skippedNow.length },
    thisWeek: weeks.find((w) => w.state === 'current')!,
    byEmployer: [...by.values()].sort((a, b) => b.hours - a.hours), shifts,
    // Anything that needs attention now or soon: fortnights including today or still to come that are at or near the limit
    warnings: windows.filter((w) => (w.current || w.future) && (w.status === 'over' || w.status === 'near')),
  };
}
