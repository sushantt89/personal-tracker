import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let flush: () => Promise<void>;

// Fake map on a straight line: 1 unit of longitude = 10 km
const PLACES: Record<string, { lat: number; lng: number }> = {
  '1 home st': { lat: -34.9, lng: 138.0 }, '25 angus street': { lat: -34.9, lng: 138.5 }, '2 chessington avenue': { lat: -34.9, lng: 138.8 },
};
const fakeProvider = {
  name: 'Fake map',
  async geocode(q: string) { const key = Object.keys(PLACES).find((k) => q.toLowerCase().startsWith(k)); return key ? [{ ...PLACES[key], displayName: key }] : []; },
  async route(points: { lat: number; lng: number }[]) { return { legs: points.slice(1).map((p, i) => { const km = Math.round(Math.abs(p.lng - points[i].lng) * 10 * 10) / 10; return { km, minutes: Math.round(km * 1.5) }; }) }; },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test' });
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import('../src/app.js');
  const { setTravelProvider } = await import('../src/services/travel/index.js');
  flush = (await import('../src/services/google/background.js')).flushBackground;
  setTravelProvider(fakeProvider as any);
  app = createApp();
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('hours per fortnight', () => {
  it('adds up worked and scheduled hours for every two weeks in a row and warns near or over the limit', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Hours', email: 'hours@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-07' }; // Wednesday. This week Mon 5 – Sun 11 Oct
    const shift = (date: string, hoursWorked: number, extra: object = {}) => a.post('/api/jobs').query(q).send({ date, startTime: '09:00', endTime: '17:00', hoursWorked, clientName: 'Factory', workType: 'employee', ...extra }).expect(201);
    await shift('2026-09-29', 10); await shift('2026-10-01', 10);            // last week: 20 h
    await shift('2026-10-05', 8); await shift('2026-10-06', 6.5);            // this week, already worked: 14.5 h
    await shift('2026-10-09', 8); await shift('2026-10-10', 8, { clientName: 'Cafe' }); // this week, still to come: 16 h
    await shift('2026-10-13', 9);                                           // next week: 9 h
    await shift('2026-10-08', 5, { status: 'cancelled' });                   // never counts

    let r = (await a.get('/api/work-hours').query(q).expect(200)).body;
    expect(r.limit).toBe(0);
    expect(r.thisWeek).toMatchObject({ from: '2026-10-05', to: '2026-10-11', worked: 14.5, scheduled: 16, total: 30.5 });
    expect(r.current).toMatchObject({ from: '2026-09-28', to: '2026-10-11', total: 50.5, status: 'none' });
    expect(r.warnings).toEqual([]);

    await a.patch('/api/settings').send({ work: { hoursLimit: 48 } }).expect(200);
    r = (await a.get('/api/work-hours').query(q).expect(200)).body;
    // Last week + this week = 50.5 h (2.5 over); this week + next week = 39.5 h
    expect(r.current).toMatchObject({ from: '2026-09-28', total: 50.5, over: 2.5, status: 'over', remaining: 0 });
    expect(r.windows.find((w: any) => w.from === '2026-10-05')).toMatchObject({ total: 39.5, status: 'ok', remaining: 8.5 });
    expect(r.roomThisWeek).toBe(0);
    expect(r.byEmployer).toEqual([{ name: 'Factory', hours: 42.5, shifts: 5 }, { name: 'Cafe', hours: 8, shifts: 1 }]);
    const alerts = (await a.get('/api/alerts').query(q).expect(200)).body.items;
    expect(alerts.find((x: any) => x.id === 'hours-over-2026-09-28').title).toBe('Over your 48 h fortnight limit by 2.5 h');

    // A higher limit: under, but close
    await a.patch('/api/settings').send({ work: { hoursLimit: 52 } }).expect(200);
    r = (await a.get('/api/work-hours').query(q).expect(200)).body;
    expect(r.current).toMatchObject({ status: 'near', remaining: 1.5 });
    expect(r.roomThisWeek).toBe(1.5);

    // Fixed fortnights starting Mon 5 Oct: only this week + next week is looked at
    await a.patch('/api/settings').send({ work: { hoursLimit: 48, fortnightMode: 'fixed', fortnightAnchor: '2026-10-05' } }).expect(200);
    r = (await a.get('/api/work-hours').query(q).expect(200)).body;
    expect(r.windows.filter((w: any) => w.current)).toHaveLength(1);
    expect(r.current).toMatchObject({ from: '2026-10-05', to: '2026-10-18', total: 39.5, status: 'ok' });
    expect(r.warnings).toEqual([]);

    // Only count employee work
    await a.post('/api/jobs').query(q).send({ date: '2026-10-11', startTime: '09:00', endTime: '12:00', clientName: 'Own client', workType: 'own' }).expect(201);
    expect((await a.get('/api/work-hours').query(q)).body.current.total).toBe(42.5);
    await a.patch('/api/settings').send({ work: { countTypes: ['employee'] } }).expect(200);
    expect((await a.get('/api/work-hours').query(q)).body.current.total).toBe(39.5);
    await a.patch('/api/settings').send({ work: { countTypes: [] } }).expect(400);
  });
});

describe('kilometre log', () => {
  it('totals driving between jobs for the financial year, keeps home trips separate, and exports every trip', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Driver', email: 'driver@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-07' };
    await a.patch('/api/settings').send({ travel: { enabled: true, homeAddress: '1 Home St, Adelaide SA', startFrom: 'home', returnHome: true } }).expect(200);
    const job = (date: string, startTime: string, line1: string) => a.post('/api/jobs').query(q).send({ date, startTime, clientName: 'Client', address: { line1, formatted: line1 } }).expect(201);
    await job('2026-10-05', '09:00', '25 Angus Street'); await job('2026-10-05', '11:00', '2 Chessington Avenue'); // home→5→3→8 home
    await job('2026-07-02', '09:00', '25 Angus Street');                                                            // home→5→5 home (no between-jobs driving)
    await job('2026-06-20', '09:00', '25 Angus Street'); await job('2026-06-20', '11:00', '2 Chessington Avenue'); // previous financial year
    await flush();
    await a.post('/api/travel/backfill').send({ from: '2026-06-01', to: '2026-10-31' }).expect(200);

    let log = (await a.get('/api/travel/logbook').query(q).expect(200)).body;
    expect(log.fy).toMatchObject({ start: 2026, label: '2026–27', from: '2026-07-01', to: '2027-06-30' });
    expect(log.totals).toMatchObject({ days: 2, betweenKm: 3, homeKm: 23, countedKm: 3, estimate: 2.64, overCap: false });
    expect(log.rows[0]).toMatchObject({ date: '2026-10-05', stops: 2, betweenKm: 3, homeKm: 13, countedKm: 3 });
    expect(log.rows[0].legs.map((l: any) => [l.from, l.to, l.km, l.counted])).toEqual([['Home', 'Client', 5, false], ['Client', 'Client', 3, true], ['Client', 'Home', 8, false]]);
    expect(log.months.map((m: any) => [m.month, m.countedKm])).toEqual([['2026-07', 0], ['2026-10', 3]]);
    expect(log.daysWithoutRoute).toBe(0);

    // Counting home trips too, at a different rate
    await a.patch('/api/settings').send({ travel: { logCount: 'all', ratePerKm: 1 } }).expect(200);
    log = (await a.get('/api/travel/logbook').query(q).expect(200)).body;
    expect(log.totals).toMatchObject({ countedKm: 26, estimate: 26 });

    // The year before
    const prev = (await a.get('/api/travel/logbook?fy=2025').query(q).expect(200)).body;
    expect(prev.totals).toMatchObject({ days: 1, countedKm: 16 });

    const csv = await a.get('/api/travel/logbook?format=csv').query(q).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('kilometre-log-2026-2027.csv');
    expect(csv.text.split('\n')[0]).toBe('Date,From,To,Kilometres,Type,Counted');
    expect(csv.text).toContain('2026-10-05,Client,Client,3.00,Between jobs,Yes');
    expect(csv.text).toContain('Kilometres counted,26.00');
  });
});
