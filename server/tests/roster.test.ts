import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import path from 'node:path';
import type { Express } from 'express';
import { parseRoster, parseMessage } from '../src/services/parser/index.js';

// Text exactly as OCR read a real roster screenshot (note "0ct" for "Oct")
const OCR = `Tuesday 06/0ct/2026
DARLINGTON SA
Start 10:00 PM Tuesday 06/0ct/2026
Finish 1:00 AM Wednesday 07/0ct/2026
3:00hrs
PB:Production Beginner
Intially viewed at Friday 02/0ct/2026 03:37 PM
Wednesday 07/0ct/2026
DARLINGTON SA
Start 10:00 PM Wednesday 07/0ct/2026
Finish 1:00 AM Thursday 08/0ct/2026
3:00hrs
PB:Production Beginner
Intially viewed at Friday 02/0ct/2026 03:37 PM
Thursday 08/0ct/2026
DARLINGTON SA
Start 9:30 PM Thursday 08/0ct/2026
Finish 1:00 AM Friday 09/0ct/2026
3:30hrs
PB:Production Beginner
Intially viewed at Friday 02/0ct/2026 03:37 PM
Saturday 10/0ct/2026
DARLINGTON SA
Start 11:30 PM Saturday 10/Oct/2026
Finish 3:00 AM Sunday 11/0ct/2026
3:30hrs
PB:Production Beginner
Intially viewed at Friday 02/0Oct/2026 03:37 PM`;

describe('roster parser', () => {
  const today = '2026-10-03';
  it('reads labelled start/finish shifts, overnight times, hours, location and role', () => {
    const r = parseRoster(OCR, { today, employer: 'Burger Place' })!;
    expect(r.jobs.map((j) => [j.date, j.startTime, j.endTime, j.hours])).toEqual([
      ['2026-10-06', '22:00', '01:00', 3], ['2026-10-07', '22:00', '01:00', 3], ['2026-10-08', '21:30', '01:00', 3.5], ['2026-10-10', '23:30', '03:00', 3.5],
    ]);
    expect(r.jobs[0]).toMatchObject({ clientName: 'Burger Place', description: 'Production Beginner', address: { suburb: 'Darlington', state: 'SA', formatted: 'Darlington SA' }, warnings: [] });
    expect(r.jobs.every((j) => j.amount === undefined)).toBe(true);
    expect(r.summary).toMatchObject({ jobCount: 4, dateCount: 4, totalAmount: 0 });
    // "viewed at" lines must not become shifts or notes
    expect(JSON.stringify(r)).not.toContain('viewed');
  });

  it('is not tied to one employer or layout', () => {
    const list = parseRoster('Roster week of 5 Oct\nMon 5 Oct 9:00am - 5:00pm Checkout\nFri 9 Oct 6:00 - 14:30\nSat 10 Oct 10pm-2am', { today, employer: 'Grocer' })!;
    expect(list.jobs.map((j) => [j.date, j.startTime, j.endTime, j.hours, j.description])).toEqual([
      ['2026-10-05', '09:00', '17:00', 8, 'Checkout'], ['2026-10-09', '06:00', '14:30', 8.5, undefined], ['2026-10-10', '22:00', '02:00', 4, undefined],
    ]);
    const form = parseRoster('Shift date: 12/10/2026\nLocation: 45 King William Street, Adelaide SA 5000\nStart time: 22:00\nEnd time: 06:00\nRole: Night fill', { today })!;
    expect(form.jobs[0]).toMatchObject({ date: '2026-10-12', startTime: '22:00', endTime: '06:00', hours: 8, description: 'Night fill' });
    expect(form.jobs[0].address.formatted).toContain('King William');
    expect(form.jobs[0].warnings).toContain('Choose the employer for these shifts');
  });

  it('leaves ordinary schedule messages to the message parser', () => {
    const msg = 'Hi Sush, schedule for Friday 2 Oct\n8:45am Priya K\n8 Fisher Street, Malvern SA 5061 ($35)\n10:00am Sonia\n25 Angus Street, Goodwood SA 5034 ($25)';
    expect(parseRoster(msg, { today: '2026-10-01' })).toBeNull();
    expect(parseMessage(msg, { today: '2026-10-01' }).jobs).toHaveLength(2);
  });
});

describe('roster import and pay added later', () => {
  let mongo: MongoMemoryServer;
  let app: Express;
  let a: ReturnType<typeof request.agent>;
  const q = { today: '2026-10-03' };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test' });
    await mongoose.connect(mongo.getUri());
    app = (await import('../src/app.js')).createApp();
    a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Sush', email: 'roster@example.com', password: 'password123' }).expect(201);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('reads a roster image, imports the shifts as employee work with no pay, and skips them next time', async () => {
    const res = await a.post('/api/import/roster').query(q).field('employer', 'Depot Co').attach('file', path.resolve('tests/fixtures/roster.png')).expect(200);
    expect(res.body.format).toBe('roster');
    expect(res.body.suggestedWorkType).toBe('employee');
    expect(res.body.jobs.map((j: any) => [j.date, j.startTime, j.endTime, j.hours, j.clientName])).toEqual([
      ['2026-10-12', '06:00', '14:30', 8, 'Depot Co'], ['2026-10-16', '22:00', '02:00', 4, 'Depot Co'],
    ]);
    expect(res.body.jobs[0].address).toMatchObject({ suburb: 'Riverside', state: 'VIC' });
    expect(res.body.jobs[0].description).toBe('Warehouse Picker');

    const commit = await a.post('/api/import/commit').query(q).send({
      sourceMessage: res.body.text, workType: 'employee',
      jobs: res.body.jobs.map((j: any) => ({ clientName: j.clientName, date: j.date, startTime: j.startTime, endTime: j.endTime, hoursWorked: j.hours, address: j.address, description: j.description })),
    }).expect(201);
    expect(commit.body.jobs).toHaveLength(2);
    expect(commit.body.incomeCreated).toBe(0); // no pay yet → no income yet
    expect(commit.body.jobs[1]).toMatchObject({ workType: 'employee', hoursWorked: 4, endTime: '02:00' });
    expect(commit.body.jobs[0].amount ?? null).toBeNull();

    // Uploading the same roster again flags every shift as already there
    const again = await a.post('/api/import/parse').query(q).send({ text: res.body.text, employer: 'Depot Co' }).expect(200);
    expect(again.body.alreadyImported).toBeTruthy();
    expect(again.body.jobs.every((j: any) => j.duplicateOfJobId)).toBe(true);

    // Employee shifts are never offered for invoicing
    await a.post('/api/jobs/complete-past').query({ today: '2026-10-20' }).send({}).expect(200);
    const cands = await a.get('/api/invoices/candidates').query({ from: '2026-10-01', to: '2026-10-31' });
    expect(cands.body.items).toHaveLength(0);
  });

  it('shares one pay amount across shifts by hours and marks the income received', async () => {
    const day = { today: '2026-10-20' };
    const unpaid = (await a.get('/api/jobs').query({ ...day, pay: 'unset' })).body.items;
    expect(unpaid).toHaveLength(2);
    expect((await a.get('/api/alerts').query(day)).body.items.some((x: any) => x.id === 'job-nopay' && x.title.startsWith('2 shifts'))).toBe(true);

    await a.post('/api/jobs/record-pay').query(day).send({ jobIds: unpaid.map((j: any) => j.id), total: 0 }).expect(400);
    const r = await a.post('/api/jobs/record-pay').query(day).send({ jobIds: unpaid.map((j: any) => j.id), total: 301, paidDate: '2026-10-21' }).expect(200);
    expect(r.body).toMatchObject({ updated: 2, total: 301 });
    const byDate = Object.fromEntries(r.body.jobs.map((j: any) => [j.date, j.amount]));
    expect(byDate['2026-10-12'] + byDate['2026-10-16']).toBeCloseTo(301, 2); // 8h and 4h → two thirds and one third
    expect(byDate['2026-10-12']).toBeCloseTo(200.66, 2);
    expect(byDate['2026-10-16']).toBeCloseTo(100.34, 2);

    const income = (await a.get('/api/income').query({ ...day, from: '2026-10-01', to: '2026-10-31' })).body.items;
    expect(income).toHaveLength(2);
    expect(income.every((i: any) => i.status === 'paid' && i.paidDate === '2026-10-21' && i.clientName === 'Depot Co')).toBe(true);
    expect((await a.get('/api/jobs').query({ ...day, pay: 'unset' })).body.items).toHaveLength(0);
    expect((await a.get('/api/alerts').query(day)).body.items.some((x: any) => x.id === 'job-nopay')).toBe(false);

    // A lump sum for a bunch of jobs can instead be split equally, whatever their hours
    const mk = async (date: string, hoursWorked: number) => (await a.post('/api/jobs').query(day).send({ date, clientName: 'Lump Co', hoursWorked }).expect(201)).body.id;
    const ids = [await mk('2026-10-13', 1), await mk('2026-10-14', 5), await mk('2026-10-15', 2)];
    const eq = await a.post('/api/jobs/record-pay').query(day).send({ jobIds: ids, total: 100, split: 'equal' }).expect(200);
    expect(eq.body.split).toBe('equal');
    expect(eq.body.jobs.map((j: any) => j.amount)).toEqual([33.33, 33.33, 33.34]); // adds up to exactly 100

    // Another user's shifts can't be paid from this account
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Other', email: 'other-roster@example.com', password: 'password123' }).expect(201);
    await b.post('/api/jobs/record-pay').send({ jobIds: [unpaid[0].id], total: 50 }).expect(400);
  });
});
