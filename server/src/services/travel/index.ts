import crypto from 'node:crypto';
import { Job, Settings, TravelDay, GeocodeCache } from '../../models/index.js';
import { travelProvider, type LatLng } from './provider.js';
import { background } from '../google/background.js';
import { round2, sum } from '../../utils/money.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const normaliseAddress = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function addressText(a: any): string {
  if (!a) return '';
  if (a.formatted) return `${a.formatted}${a.country && !/australia/i.test(a.formatted) ? ', ' + a.country : ''}`;
  return [a.line1, [a.suburb, a.state, a.postcode].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');
}

export async function travelSettings(userId: string) {
  const s = await Settings.findOne({ userId }).lean();
  const t: any = s?.travel ?? {};
  return {
    enabled: Boolean(t.enabled), homeAddress: t.homeAddress ?? '', homeLat: t.homeLat as number | undefined, homeLng: t.homeLng as number | undefined,
    startFrom: (t.startFrom ?? 'home') as 'home' | 'first_job', returnHome: t.returnHome !== false,
    fuelPricePerLitre: t.fuelPricePerLitre ?? 2, litresPer100km: t.litresPer100km ?? 8, countryCode: t.countryCode || 'au',
  };
}

/** Address → coordinates, cached per user. Returns null when the address can't be found. */
export async function geocode(userId: string, address: string, countryCode = 'au'): Promise<(LatLng & { displayName?: string }) | null> {
  const key = normaliseAddress(address);
  if (!key) return null;
  const cached = await GeocodeCache.findOne({ userId, key }).lean();
  if (cached) return cached.notFound ? null : { lat: cached.lat!, lng: cached.lng!, displayName: cached.displayName ?? undefined };
  // A house number can match the same street in the wrong suburb, so check the postcode when we have one,
  // and fall back to the street without its number (OSM often lacks house numbers).
  const expectedPostcode = /\b(\d{4})\b(?!.*\b\d{4}\b)/.exec(address.replace(/^\s*[\d/-]+[a-z]?\s+/i, ''))?.[1];
  const simpler = address.replace(/^\s*(?:unit|u)?\s*\d+[a-z]?\s*\/\s*/i, '').replace(/^\s*\d+[a-z]?(-\d+)?\s+/, '');
  const queries = simpler !== address ? [address, simpler] : [address];
  let hit: (LatLng & { displayName?: string }) | null = null;
  let firstAny: (LatLng & { displayName?: string }) | null = null;
  for (const q of queries) {
    const results = await travelProvider().geocode(q, countryCode);
    firstAny ??= results[0] ?? null;
    const suburbWords = address.split(',').slice(1).join(' ').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !['australia', 'south', 'north', 'west', 'east', 'queensland', 'victoria', 'tasmania', 'wales', 'territory'].includes(w));
    const good = results.find((r) => (!expectedPostcode || !r.postcode || r.postcode === expectedPostcode)
      && (expectedPostcode || !suburbWords.length || !r.displayName || suburbWords.some((w) => r.displayName!.toLowerCase().includes(w))));
    if (good) { hit = good; break; }
  }
  hit ??= firstAny;
  await GeocodeCache.updateOne({ userId, key }, { $set: hit ? { lat: hit.lat, lng: hit.lng, displayName: hit.displayName, notFound: false } : { notFound: true } }, { upsert: true });
  return hit;
}

export const fuelFor = (km: number, s: { litresPer100km: number; fuelPricePerLitre: number }) => {
  const litres = round2((km * s.litresPer100km) / 100);
  return { litres, cost: round2(litres * s.fuelPricePerLitre) };
};

/**
 * Builds (or reuses) the driving route for one day: start → jobs by start time → (home).
 * Saves per-job travel (distance/time from the previous stop) and the day totals.
 */
export async function computeDay(userId: string, date: string, opts: { force?: boolean } = {}) {
  const s = await travelSettings(userId);
  const jobs = await Job.find({ userId, date, status: { $ne: 'cancelled' } }).sort({ startTime: 1, createdAt: 1 });
  if (!jobs.length) {
    await TravelDay.deleteOne({ userId, date });
    return null;
  }

  const missing: { jobId: any; label: string; address: string; reason: string }[] = [];
  const jobStops: { label: string; kind: 'job'; jobId: any; address: string; lat: number; lng: number }[] = [];
  for (const j of jobs) {
    const label = j.clientName || j.title || 'Job';
    const text = addressText(j.address);
    if (!text) { missing.push({ jobId: j._id, label, address: '', reason: 'No address' }); continue; }
    const geoKey = normaliseAddress(text);
    let lat = j.address?.lat, lng = j.address?.lng;
    if (lat === undefined || lat === null || lng === undefined || lng === null || j.address?.geoKey !== geoKey) {
      const hit = await geocode(userId, text, s.countryCode);
      if (!hit) { missing.push({ jobId: j._id, label, address: text, reason: 'Address not found on the map' }); continue; }
      lat = hit.lat; lng = hit.lng;
      await Job.updateOne({ _id: j._id }, { $set: { 'address.lat': lat, 'address.lng': lng, 'address.geoKey': geoKey } });
    }
    jobStops.push({ label, kind: 'job', jobId: j._id, address: text, lat: lat!, lng: lng! });
  }

  let home: { label: string; kind: 'home'; address: string; lat: number; lng: number } | null = null;
  if (s.homeAddress && (s.startFrom === 'home' || s.returnHome)) {
    let { homeLat, homeLng } = s;
    if (homeLat === undefined || homeLng === undefined) {
      const hit = await geocode(userId, s.homeAddress, s.countryCode);
      if (hit) { homeLat = hit.lat; homeLng = hit.lng; await Settings.updateOne({ userId }, { 'travel.homeLat': hit.lat, 'travel.homeLng': hit.lng }); }
    }
    if (homeLat !== undefined && homeLng !== undefined) home = { label: 'Home', kind: 'home', address: s.homeAddress, lat: homeLat, lng: homeLng };
  }
  const stops: any[] = [...(home && s.startFrom === 'home' ? [home] : []), ...jobStops, ...(home && s.returnHome && jobStops.length ? [home] : [])];
  const signature = crypto.createHash('sha1').update(JSON.stringify(stops.map((x) => [x.kind, String(x.jobId ?? ''), x.lat.toFixed(5), x.lng.toFixed(5)]))).digest('hex');

  const existing = await TravelDay.findOne({ userId, date });
  if (existing && existing.signature === signature && !existing.error && !opts.force) {
    if (JSON.stringify(existing.missing) !== JSON.stringify(missing)) { existing.set('missing', missing); await existing.save(); }
    return existing;
  }

  let legs: { from: string; to: string; toJobId?: any; km: number; minutes: number }[] = [];
  let error: string | undefined;
  if (stops.length >= 2) {
    try {
      const r = await travelProvider().route(stops.map((x) => ({ lat: x.lat, lng: x.lng })));
      if (!r) throw new Error('No driving route found between these addresses');
      legs = r.legs.map((l, i) => ({ from: stops[i].label, to: stops[i + 1].label, toJobId: stops[i + 1].jobId, km: l.km, minutes: l.minutes }));
    } catch (e) {
      error = `Route lookup failed: ${(e as Error).message}`;
    }
  }

  // Per-job travel = the leg arriving at that job (first job is 0 when the day starts there)
  const arriving = new Map(legs.filter((l) => l.toJobId).map((l) => [String(l.toJobId), l]));
  if (!error) {
    for (const j of jobStops) {
      const l = arriving.get(String(j.jobId));
      await Job.updateOne({ _id: j.jobId }, { $set: { distanceKm: l?.km ?? 0, travelMinutes: l?.minutes ?? 0 } });
    }
  }

  return TravelDay.findOneAndUpdate(
    { userId, date },
    { userId, date, signature: error ? undefined : signature, stops, legs, totalKm: round2(sum(legs.map((l) => l.km))), totalMinutes: sum(legs.map((l) => l.minutes)), missing, error: error ?? null, computedAt: new Date() },
    { upsert: true, new: true },
  );
}

/** Recalculate a day's route in the background after jobs change (only when travel is enabled). */
export function queueTravelDay(userId: string, ...dates: (string | undefined | null)[]) {
  const unique = [...new Set(dates.filter(Boolean) as string[])];
  if (!unique.length) return;
  background(async () => {
    if (!(await travelSettings(userId)).enabled) return;
    for (const d of unique) await computeDay(userId, d);
  });
}

/** Travel, fuel and income per day across a range (uses saved routes). */
export async function travelSummary(userId: string, from: string, to: string) {
  const s = await travelSettings(userId);
  const [days, jobs] = await Promise.all([
    TravelDay.find({ userId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
    Job.find({ userId, date: { $gte: from, $lte: to }, status: { $ne: 'cancelled' } }).select('date amount').lean(),
  ]);
  const incomeByDay = new Map<string, number>();
  for (const j of jobs) incomeByDay.set(j.date, round2((incomeByDay.get(j.date) ?? 0) + (j.amount ?? 0)));
  const rows = days.map((d) => {
    const income = incomeByDay.get(d.date) ?? 0;
    const fuel = fuelFor(d.totalKm ?? 0, s);
    return { date: d.date, km: d.totalKm ?? 0, minutes: d.totalMinutes ?? 0, litres: fuel.litres, fuelCost: fuel.cost, income, incomeAfterFuel: round2(income - fuel.cost), perKm: d.totalKm ? round2(income / d.totalKm) : 0, missing: d.missing?.length ?? 0, error: d.error ?? null };
  });
  const km = round2(sum(rows.map((r) => r.km)));
  const income = round2(sum(rows.map((r) => r.income)));
  const fuelCost = round2(sum(rows.map((r) => r.fuelCost)));
  return {
    settings: { enabled: s.enabled, fuelPricePerLitre: s.fuelPricePerLitre, litresPer100km: s.litresPer100km, homeSet: Boolean(s.homeAddress) },
    rows,
    totals: { days: rows.length, km, minutes: sum(rows.map((r) => r.minutes)), litres: round2(sum(rows.map((r) => r.litres))), fuelCost, income, incomeAfterFuel: round2(income - fuelCost), perKm: km ? round2(income / km) : 0 },
  };
}

export { travelProvider, setTravelProvider } from './provider.js';
