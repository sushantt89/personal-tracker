import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import ExcelJS from 'exceljs';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let flush: () => Promise<void>;
const calls = { geocode: 0, route: 0 };

// Fake map: known addresses on a straight line, 1 unit of longitude = 10 km, 1 km = 1.5 minutes
const PLACES: Record<string, { lat: number; lng: number }> = {
  '1 home st': { lat: -34.9, lng: 138.0 },
  '25 angus street': { lat: -34.9, lng: 138.5 },
  '2 chessington avenue': { lat: -34.9, lng: 138.8 },
  '25 clifton st': { lat: -34.9, lng: 139.0 },
};
const fakeProvider = {
  name: 'Fake map',
  async geocode(q: string) {
    calls.geocode++;
    const key = Object.keys(PLACES).find((k) => q.toLowerCase().startsWith(k));
    return key ? [{ ...PLACES[key], displayName: key }] : [];
  },
  async route(points: { lat: number; lng: number }[]) {
    calls.route++;
    return { legs: points.slice(1).map((p, i) => { const km = Math.round(Math.abs(p.lng - points[i].lng) * 10 * 10) / 10; return { km, minutes: Math.round(km * 1.5) }; }) };
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test', UPLOAD_DIR: './tmp-test-uploads-t' });
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import('../src/app.js');
  const { setTravelProvider } = await import('../src/services/travel/index.js');
  flush = (await import('../src/services/google/background.js')).flushBackground;
  setTravelProvider(fakeProvider);
  app = createApp();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('distance & travel', () => {
  let a: ReturnType<typeof request.agent>;
  const job = (clientName: string, line1: string, startTime: string, amount: number) => ({ date: '2026-10-02', clientName, startTime, amount, status: 'completed', address: { line1, suburb: 'Adelaide', state: 'SA', formatted: `${line1}, Adelaide SA` } });

  it('works out the day route, fuel and income per km', async () => {
    a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'T', email: 't@example.com', password: 'password123' }).expect(201);
    // Off by default
    expect((await a.get('/api/travel/day?date=2026-10-02')).body).toMatchObject({ enabled: false, day: null });
    const s = await a.patch('/api/settings').send({ travel: { enabled: true, homeAddress: '1 Home St, Adelaide SA', fuelPricePerLitre: 2, litresPer100km: 10, returnHome: true, startFrom: 'home' } });
    expect(s.body.travel.homeLat).toBe(-34.9);
    // Created out of time order on purpose
    const j2 = (await a.post('/api/jobs').send(job('Andrew', '2 Chessington Avenue', '10:00', 30))).body;
    const j1 = (await a.post('/api/jobs').send(job('Sonia', '25 Angus Street', '08:45', 25))).body;
    await a.post('/api/jobs').send(job('Bron', '25 Clifton St', '11:30', 30)).expect(201);
    await a.post('/api/jobs').send({ ...job('Nowhere', '99 Unknown Rd', '13:00', 20), status: 'scheduled' }).expect(201);
    await flush();

    const d = (await a.get('/api/travel/day?date=2026-10-02')).body.day;
    expect(d.stops.map((x: { label: string }) => x.label)).toEqual(['Home', 'Sonia', 'Andrew', 'Bron', 'Home']);
    expect(d.legs.map((l: { km: number }) => l.km)).toEqual([5, 3, 2, 10]);
    expect(d.totalKm).toBe(20);
    expect(d.totalMinutes).toBe(31);
    expect(d.fuel).toEqual({ litres: 2, cost: 4 });
    expect(d.missing).toEqual([expect.objectContaining({ label: 'Nowhere', reason: 'Address not found on the map' })]);
    expect((await a.get(`/api/jobs/${j1.id}`)).body).toMatchObject({ distanceKm: 5, travelMinutes: 8 });
    expect((await a.get(`/api/jobs/${j2.id}`)).body.distanceKm).toBe(3);

    // Cached: viewing again doesn't call the map services
    const before = { ...calls };
    await a.get('/api/travel/day?date=2026-10-02').expect(200);
    expect(calls).toEqual(before);

    const sum = (await a.get('/api/travel/summary?from=2026-10-01&to=2026-10-31')).body.totals;
    expect(sum).toMatchObject({ days: 1, km: 20, fuelCost: 4, income: 105, incomeAfterFuel: 101, perKm: 5.25 });
    const dash = (await a.get('/api/dashboard?from=2026-10-01&to=2026-10-31&today=2026-10-05')).body;
    expect(dash.work.travel).toMatchObject({ enabled: true, km: 20, fuelCost: 4 });
  });

  it('recalculates when jobs change and when the start point changes', async () => {
    const jobs = (await a.get('/api/jobs?from=2026-10-02&to=2026-10-02')).body.items;
    const bron = jobs.find((j: { clientName: string }) => j.clientName === 'Bron');
    await a.patch(`/api/jobs/${bron.id}`).send({ status: 'cancelled' }).expect(200);
    await flush();
    let d = (await a.get('/api/travel/day?date=2026-10-02')).body.day;
    expect(d.stops.map((x: { label: string }) => x.label)).toEqual(['Home', 'Sonia', 'Andrew', 'Home']);
    expect(d.totalKm).toBe(16);

    await a.patch('/api/settings').send({ travel: { startFrom: 'first_job', returnHome: false } }).expect(200);
    d = (await a.get('/api/travel/day?date=2026-10-02')).body.day;
    expect(d.signature).toBeUndefined(); // marked stale
    d = (await a.post('/api/travel/day/recalculate').send({ date: '2026-10-02' })).body.day;
    expect(d.stops.map((x: { label: string }) => x.label)).toEqual(['Sonia', 'Andrew']);
    expect(d.totalKm).toBe(3);
    const sonia = jobs.find((j: { clientName: string }) => j.clientName === 'Sonia');
    expect((await a.get(`/api/jobs/${sonia.id}`)).body.distanceKm).toBe(0);
  });

  it('exports Excel and PDF reports including travel', async () => {
    const x = await a.get('/api/reports/work?from=2026-10-01&to=2026-10-31&groupBy=day&format=xlsx').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.getWorksheet('Work')!;
    const header = (ws.getRow(4).values as unknown[]).slice(1);
    expect(header).toEqual(['Day', 'Jobs', 'Income', 'Avg / job', 'Hours', 'Avg / hour', 'Km driven', 'Fuel cost', 'Income after fuel', 'Income / km']);
    expect(ws.getRow(5).getCell(2).value).toBe(2); // 2 completed jobs (Bron cancelled)
    expect(ws.getRow(5).getCell(7).value).toBe(3);
    expect((ws.getRow(6).getCell(3).value as { formula: string }).formula).toBe('SUM(C5:C5)');
    expect(wb.getWorksheet('Work detail')).toBeTruthy();

    const all = await a.get('/api/reports/all?from=2026-10-01&to=2026-10-31&format=xlsx').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(all.body);
    expect(wb2.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['Summary', 'Income', 'Expenses', 'Profit & cash flow', 'Work']));

    const pdf = await a.get('/api/reports/income?from=2026-01-01&to=2026-12-31&groupBy=month&format=pdf&detail=true');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1500);
    const pdfAll = await a.get('/api/reports/all?from=2026-01-01&to=2026-12-31&format=pdf');
    expect(pdfAll.headers['content-type']).toBe('application/pdf');
  });
});

describe('finding addresses on the map', () => {
  it('tries the street written out in full, never remembers a failed lookup as "not found", and retries old misses', async () => {
    const { geocode, setTravelProvider } = await import('../src/services/travel/index.js');
    const { GeocodeCache } = await import('../src/models/index.js');
    const uid = new mongoose.Types.ObjectId().toString();
    const asked: string[] = [];
    let down = false;
    // This map only knows "Sample Road, Hillside" — not the abbreviation, not the house number
    setTravelProvider({
      name: 'Picky map',
      async geocode(q: string) { asked.push(q); if (down) throw new Error('map service responded 403'); return /^sample road, hillside$/i.test(q.trim()) ? [{ lat: -35, lng: 138.7, displayName: 'Sample Road, Hillside, South Australia, 5152' }] : []; },
      async route() { return { legs: [] }; },
    });
    try {
      expect(await geocode(uid, '12 Sample Rd, Hillside SA 5152')).toMatchObject({ lat: -35, lng: 138.7 });
      expect(asked).toContain('Sample Road, Hillside');

      // Service refusing every request: an error, and nothing cached
      down = true;
      await expect(geocode(uid, '7 Other St, Nowhere SA 5000')).rejects.toThrow(/403/);
      expect(await GeocodeCache.countDocuments({ userId: uid, notFound: true })).toBe(0);

      // Really not found: remembered, but tried again after a day
      down = false;
      expect(await geocode(uid, '7 Other St, Nowhere SA 5000')).toBeNull();
      const before = asked.length;
      expect(await geocode(uid, '7 Other St, Nowhere SA 5000')).toBeNull();
      expect(asked.length).toBe(before); // from the cache
      await GeocodeCache.collection.updateOne({ userId: new mongoose.Types.ObjectId(uid), notFound: true }, { $set: { updatedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) } });
      await geocode(uid, '7 Other St, Nowhere SA 5000');
      expect(asked.length).toBeGreaterThan(before);
    } finally { setTravelProvider(fakeProvider); }
  });
});
