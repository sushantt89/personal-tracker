/**
 * Kilometre log for a financial year (1 July – 30 June), built from the saved daily driving routes.
 * By default only driving between jobs counts; the trips from home to the first job and back home are shown but left out,
 * because travel between home and work usually can't be claimed. The user can choose to count them.
 * This is a record to take to a tax agent or check against the tax office's rules — not tax advice.
 */
import { Types } from 'mongoose';
import { Job, TravelDay } from '../models/index.js';
import { travelSettings } from './travel/index.js';
import { round2 } from '../utils/money.js';

export const financialYearOf = (date: string) => (Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1);
const CENTS_PER_KM_CAP = 5000;

export async function kmLog(userId: string, fyStart: number, today: string) {
  const s = await travelSettings(userId);
  const from = `${fyStart}-07-01`, to = `${fyStart + 1}-06-30`;
  const upto = to < today ? to : today;
  const [days, jobDates] = await Promise.all([
    TravelDay.find({ userId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
    Job.distinct('date', { userId: new Types.ObjectId(userId), date: { $gte: from, $lte: upto }, status: { $ne: 'cancelled' } }) as Promise<string[]>,
  ]);
  const countHome = s.logCount === 'all';
  const rows = days.filter((d) => d.date <= upto).map((d: any) => {
    const stops: any[] = d.stops ?? [];
    const legs = (d.legs ?? []).map((l: any, i: number) => {
      const home = stops[i]?.kind === 'home' || stops[i + 1]?.kind === 'home';
      return { from: l.from, to: l.to, km: round2(l.km ?? 0), home, counted: countHome || !home };
    });
    const betweenKm = round2(legs.filter((l: any) => !l.home).reduce((a: number, l: any) => a + l.km, 0));
    const homeKm = round2(legs.filter((l: any) => l.home).reduce((a: number, l: any) => a + l.km, 0));
    return { date: d.date, stops: stops.filter((x) => x.kind === 'job').length, betweenKm, homeKm, totalKm: round2(betweenKm + homeKm), countedKm: countHome ? round2(betweenKm + homeKm) : betweenKm, legs, problem: d.error ? 'Route could not be worked out' : (d.missing?.length ? `${d.missing.length} address${d.missing.length === 1 ? '' : 'es'} not found` : '') };
  });
  const months = new Map<string, { month: string; days: number; countedKm: number; betweenKm: number; homeKm: number }>();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    const m = months.get(k) ?? { month: k, days: 0, countedKm: 0, betweenKm: 0, homeKm: 0 };
    m.days++; m.countedKm = round2(m.countedKm + r.countedKm); m.betweenKm = round2(m.betweenKm + r.betweenKm); m.homeKm = round2(m.homeKm + r.homeKm);
    months.set(k, m);
  }
  const countedKm = round2(rows.reduce((a, r) => a + r.countedKm, 0));
  const claimKm = Math.min(countedKm, CENTS_PER_KM_CAP);
  const withRoute = new Set(days.map((d) => d.date));
  return {
    fy: { start: fyStart, label: `${fyStart}–${String(fyStart + 1).slice(2)}`, from, to },
    settings: { enabled: s.enabled, homeSet: Boolean(s.homeAddress), ratePerKm: s.ratePerKm, logCount: s.logCount },
    totals: {
      days: rows.length, countedKm, betweenKm: round2(rows.reduce((a, r) => a + r.betweenKm, 0)), homeKm: round2(rows.reduce((a, r) => a + r.homeKm, 0)),
      claimKm, capKm: CENTS_PER_KM_CAP, overCap: countedKm > CENTS_PER_KM_CAP, estimate: round2(claimKm * s.ratePerKm),
    },
    months: [...months.values()],
    rows: rows.reverse(),
    // Days with jobs that have no saved route yet (travel was off, or it hasn't been calculated)
    daysWithoutRoute: jobDates.filter((d) => !withRoute.has(d)).length,
  };
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function kmLogCsv(log: Awaited<ReturnType<typeof kmLog>>): string {
  const lines = [['Date', 'From', 'To', 'Kilometres', 'Type', 'Counted'].join(',')];
  for (const r of [...log.rows].reverse()) for (const l of r.legs) lines.push([r.date, l.from, l.to, l.km.toFixed(2), l.home ? 'Home trip' : 'Between jobs', l.counted ? 'Yes' : 'No'].map(csvCell).join(','));
  lines.push('', `Financial year,${log.fy.label}`, `Kilometres counted,${log.totals.countedKm.toFixed(2)}`, `Rate per km,${log.settings.ratePerKm}`, `Estimate (first ${log.totals.capKm} km),${log.totals.estimate.toFixed(2)}`);
  return lines.join('\n');
}
