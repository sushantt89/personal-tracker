import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import path from 'node:path';
import type { Express } from 'express';
import { parseRoster, parseMessage, parseShiftCard } from '../src/services/parser/index.js';

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

  it('treats a break as part of its shift, not a shift of its own, and leaves it out of the paid hours', () => {
    const shift = (extra: string) => parseRoster(`Sunday 04/Oct/2026\nDARLINGTON SA\nStart 12:00 AM Sunday 04/Oct/2026\nFinish 7:00 AM Sunday 04/Oct/2026\n${extra}\nPB:Production Beginner\nIntially viewed at Monday 28/Sep/2026 03:45 PM`, { today: '2026-10-04', employer: 'Factory' })!;
    const r = shift('Break time 4:00 AM - 4:30 AM\n6:30hrs + 0:30hrs Break');
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ date: '2026-10-04', startTime: '00:00', endTime: '07:00', hours: 6.5, warnings: [] });
    expect(r.jobs[0].description).toBe('Production Beginner · Unpaid break 4:00 AM – 4:30 AM (30 min)');
    // However the break is written, it comes off the seven hours between start and finish
    for (const v of ['Break time 4:00 AM - 4:30 AM', 'Meal break: 30 min', '7:00hrs\nBreak 4:00 AM - 4:30 AM', 'Unpaid break 0:30hrs']) {
      const q = shift(v);
      expect(q.jobs).toHaveLength(1);
      expect(q.jobs[0].hours).toBe(6.5);
    }
    // No break → the full span
    expect(shift('7:00hrs').jobs[0].hours).toBe(7);
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

// A single "shift details" screen as OCR reads it, icons and all (names, address and agency are made up)
const SHIFT_CARD = `1:37                                 ul 4G BE
<                   Shift details                 i=
Jordan Example weekly
wednesdays
Current shift status
1 Thursday, Oct 08, 2026
(0 1:00 PM - 3:00 PM (2:00 hours)
1] Job
Cleaning (ACS)
my Apartment 12, Level 3, 9 Sample Street Adelaide
V' 5000
®  Attachments
2hrs
if cannot find a free parking spot, please pay and send
receipt for reimbursement
Cleaning and for someone to help her with unpacking
( general cleaning please ask the client for further
assistance please thank you)
=h       Sam Worker       2 Find a replacement
Published by    A Bright Agency         [2] Chat
()    ~                ® Open Timeclock`;

describe('single shift screen from a rostering app', () => {
  it('reads the client, date, times, address, role, notes and who published it', () => {
    const r = parseShiftCard(SHIFT_CARD, { today: '2026-10-07' })!;
    expect(r.jobs).toHaveLength(1);
    expect(r.publisher).toBe('Bright Agency');
    const j = r.jobs[0];
    expect(j).toMatchObject({ clientName: 'Jordan Example', date: '2026-10-08', startTime: '13:00', endTime: '15:00', hours: 2, warnings: [] });
    expect(j.address).toMatchObject({ line1: 'Apartment 12, Level 3, 9 Sample Street', suburb: 'Adelaide', state: 'SA', postcode: '5000', formatted: 'Apartment 12, Level 3, 9 Sample Street, Adelaide SA 5000' });
    expect(j.description).toBe('Cleaning (ACS) · Jordan Example weekly wednesdays');
    expect(j.specialInstructions).toBe('if cannot find a free parking spot, please pay and send receipt for reimbursement Cleaning and for someone to help her with unpacking (general cleaning please ask the client for further assistance please thank you)');
    // None of the app's own buttons or the worker's name leak into the job
    expect(JSON.stringify({ ...j, sourceText: '' })).not.toMatch(/Timeclock|replacement|Sam Worker|Attachments|4G/);
  });
  it('leaves rosters with several shifts, and ordinary messages, to the other readers', () => {
    expect(parseShiftCard(OCR, { today: '2026-10-03' })).toBeNull();
    expect(parseShiftCard('Hi Sam\nSchedule for THU 1 OCT\nJo T 9am - 10am ($30)\n12 Example Street, Parkside', { today: '2026-09-30' })).toBeNull();
    expect(parseShiftCard('Shift details\nThursday, Oct 08, 2026\nno times here\nPublished by X', { today: '2026-10-07' })).toBeNull();
  });
});

describe('shift screen with a map beside the title, a fuel allowance and an OCR-mangled dash', () => {
  // Made-up client and address, laid out the way OCR reads such a screen
  const CARD2 = `{                     Shift details                  2
Jordan Sample (CC) -
Monthly                                                   vw    B rid ae
iL
Ty
Current shift status                                © Confirmed
  Friday, Oct 09, 2026
(YO 1:00 PM = 4:00 PM (3:00 hours)
™ Job
Cleaning (CC)
®  12 Example Rd, Crafers SA 5152, Australia
() Attachments
3h + $20 fuel
Job Details: Bedrooms: 3 Bedrooms
Bathrooms: 2 Bathrooms
Customer Notes: No need to clean the lounge room just
the living room and the other areas.
Previous complaint: please make sure this is focused on
for the next clean.
- The coffee tables were dusted rather than
spray n wiped.
a               Ca —`;
  const r = parseShiftCard(CARD2, { today: '2026-10-08' })!;
  it('finds the shift even though the screen mentions a dollar amount and the dash was read as "="', () => {
    expect(r).not.toBeNull();
    expect(r.jobs[0]).toMatchObject({ clientName: 'Jordan Sample', date: '2026-10-09', startTime: '13:00', endTime: '16:00', hours: 3, fuelAllowance: 20, rooms: 3, bathrooms: 2 });
    expect(r.jobs[0].address.formatted).toBe('12 Example Rd, Crafers SA 5152');
  });
  it('keeps the notes readable, line by line, without the stray letters from icons and the map', () => {
    const notes = r.jobs[0].specialInstructions!;
    expect(notes).toContain('Customer Notes: No need to clean the lounge room just the living room and the other areas.');
    expect(notes.split('\n')).toContain('- The coffee tables were dusted rather than spray n wiped.');
    expect(notes).not.toMatch(/Ca —|vw|rid ae/);
    expect(r.jobs[0].clientName).not.toMatch(/iL|Ty|vw/);
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

    // Pencil in expected pay first (so forecasts can count it), then replace it with the real pay later
    const e1 = await mk('2026-10-17', 3), e2 = await mk('2026-10-18', 5);
    await a.post('/api/jobs/expected-pay').query(day).send({ jobIds: [e1, e2], mode: 'perHour', value: 0 }).expect(400);
    const est = await a.post('/api/jobs/expected-pay').query(day).send({ jobIds: [e1, e2], mode: 'perHour', value: 25.5 }).expect(200);
    expect(est.body.jobs.map((j: any) => [j.amount, j.amountEstimated])).toEqual([[76.5, true], [127.5, true]]);
    expect(est.body.total).toBe(204);
    let inc = (await a.get('/api/income').query({ ...day, jobId: e1 })).body.items;
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ amount: 76.5, status: 'expected' });
    // Still counted as waiting for actual pay, even though they have an amount
    expect((await a.get('/api/jobs').query({ ...day, pay: 'unset' })).body.items.map((j: any) => j.id).sort()).toEqual([e1, e2].sort());
    // Changing the estimate updates the same income record rather than adding another
    await a.post('/api/jobs/expected-pay').query(day).send({ jobIds: [e1, e2], mode: 'total', value: 201 }).expect(200);
    inc = (await a.get('/api/income').query({ ...day, jobId: e1 })).body.items;
    expect(inc).toHaveLength(1);
    expect(inc[0].amount).toBe(100.5);
    // The real pay arrives: the estimate is replaced and the income is marked received
    const paid = await a.post('/api/jobs/record-pay').query(day).send({ jobIds: [e1, e2], total: 190, split: 'equal', paidDate: '2026-10-21' }).expect(200);
    expect(paid.body.jobs.map((j: any) => [j.amount, j.amountEstimated])).toEqual([[95, false], [95, false]]);
    inc = (await a.get('/api/income').query({ ...day, jobId: e1 })).body.items;
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ amount: 95, status: 'paid', paidDate: '2026-10-21' });
    expect((await a.get('/api/jobs').query({ ...day, pay: 'unset' })).body.items).toHaveLength(0);
    // An estimate never overwrites pay that has really been recorded
    const again = await a.post('/api/jobs/expected-pay').query(day).send({ jobIds: [e1], mode: 'perJob', value: 10 }).expect(200);
    expect(again.body).toMatchObject({ updated: 0, skippedPaid: 1 });

    // Another user's shifts can't be paid from this account
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Other', email: 'other-roster@example.com', password: 'password123' }).expect(201);
    await b.post('/api/jobs/record-pay').send({ jobIds: [unpaid[0].id], total: 50 }).expect(400);
  });

  it('imports a shift screen as a job under the agency that published it', async () => {
    const parsed = (await a.post('/api/import/parse').query(q).send({ text: SHIFT_CARD }).expect(200)).body;
    expect(parsed).toMatchObject({ format: 'message', suggestedWorkType: 'subcontract', suggestedContractorId: null, suggestedContractorName: 'Bright Agency' });
    expect(parsed.jobs[0]).toMatchObject({ clientName: 'Jordan Example', date: '2026-10-08', hours: 2 });
    // Once the agency exists as a contractor, it is suggested by id
    const agency = (await a.post('/api/clients').query(q).send({ name: 'Bright Agency', type: 'contractor' }).expect(201)).body;
    const again = (await a.post('/api/import/parse').query(q).send({ text: SHIFT_CARD }).expect(200)).body;
    expect(again.suggestedContractorId).toBe(agency.id);
  });
});
