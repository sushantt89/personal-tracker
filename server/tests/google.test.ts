import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createFakeGoogle } from './fakeGoogle.js';

let mongo: MongoMemoryServer;
let app: Express;
const fake = createFakeGoogle();
let flush: () => Promise<void>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test', UPLOAD_DIR: './tmp-test-uploads-g',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'http://localhost:4000/api/integrations/google/callback',
  });
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import('../src/app.js');
  const { setGoogleApiFactory } = await import('../src/services/google/client.js');
  const bg = await import('../src/services/google/background.js');
  flush = bg.flushBackground;
  const { GoogleAccount } = await import('../src/models/index.js');
  // Real factory semantics: only users with a connected, healthy account get APIs
  setGoogleApiFactory(async (userId) => {
    const acc = await GoogleAccount.findOne({ userId }).lean();
    return acc && !acc.needsReconnect ? fake.apis : null;
  });
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  const fs = await import('node:fs/promises');
  await fs.rm('./tmp-test-uploads-g', { recursive: true, force: true });
});

describe('crypto & event mapping', () => {
  it('encrypts tokens reversibly and with random IVs', async () => {
    const { encrypt, decrypt } = await import('../src/utils/crypto.js');
    const a = encrypt('1//refresh-token'), b = encrypt('1//refresh-token');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('1//refresh-token');
    expect(() => decrypt(a.slice(0, -2) + 'xx')).toThrow();
  });

  it('maps jobs, tasks and bills to Google events', async () => {
    const { jobToEvent, taskToEvent, billToEvent } = await import('../src/services/google/calendar.js');
    const e = jobToEvent({ _id: 'j1', clientName: 'Sonia', date: '2026-10-02', startTime: '08:45', amount: 25, workType: 'subcontract', contractorName: 'Sparkle', address: { formatted: '25 Angus Street, Goodwood SA' }, tasks: ['Dusting'] }, 'Australia/Adelaide');
    expect(e.summary).toBe('Sonia (via Sparkle) · $25');
    expect(e.start).toEqual({ dateTime: '2026-10-02T08:45:00', timeZone: 'Australia/Adelaide' });
    expect(e.end).toEqual({ dateTime: '2026-10-02T09:45:00', timeZone: 'Australia/Adelaide' });
    expect(e.location).toBe('25 Angus Street, Goodwood SA');
    expect(e.extendedProperties?.private?.ptRef).toBe('job:j1');
    const allDay = jobToEvent({ _id: 'j2', clientName: 'X', date: '2026-10-02' }, 'UTC');
    expect(allDay.start).toEqual({ date: '2026-10-02' });
    expect(allDay.end).toEqual({ date: '2026-10-03' });
    const t = taskToEvent({ _id: 't', title: 'Study', date: '2026-10-01', startTime: '19:00', endTime: '21:00', recurrence: { frequency: 'fortnightly', until: '2026-12-31' } }, 'UTC');
    expect(t.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959Z']);
    const b = billToEvent({ _id: 'b', name: 'Rent', amount: 320, frequency: 'quarterly', dueDate: '2026-10-05', reminderDays: 2 });
    expect(b.recurrence).toEqual(['RRULE:FREQ=MONTHLY;INTERVAL=3']);
    expect(b.reminders?.overrides?.[0].minutes).toBe(2880);
  });
});

describe('Google integration (fake Google APIs)', () => {
  const a = () => agent;
  let agent: ReturnType<typeof request.agent>;
  let userId: string;

  it('needs a connection before anything syncs', async () => {
    agent = request.agent(app);
    const r = await agent.post('/api/auth/register').send({ name: 'G', email: 'g@example.com', password: 'password123' });
    userId = r.body.user.id;
    const s = (await a().get('/api/integrations')).body;
    expect(s.googleCalendar).toMatchObject({ configured: true, connected: false });
    expect((await a().post('/api/integrations/google/calendar/sync').send({})).status).toBe(400);

    const url = (await a().get('/api/integrations/google/auth-url')).body.url as string;
    expect(url).toContain('accounts.google.com');
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar.events'));
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/drive.file'));
    expect(url).toContain('access_type=offline');
    expect(url).toMatch(/state=/);

    const bad = await request(app).get('/api/integrations/google/callback?code=x&state=forged');
    expect(bad.status).toBe(302);
    expect(bad.headers.location).toContain('google=error');
    const denied = await request(app).get('/api/integrations/google/callback?error=access_denied');
    expect(denied.headers.location).toContain('reason=access_denied');
  });

  it('connects (simulated) and reports status', async () => {
    const { GoogleAccount } = await import('../src/models/index.js');
    const { encrypt } = await import('../src/utils/crypto.js');
    await GoogleAccount.create({ userId, googleEmail: 'me@gmail.com', refreshTokenEnc: encrypt('rt'), scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/drive.file'] });
    const s = (await a().get('/api/integrations')).body;
    expect(s.googleCalendar).toMatchObject({ connected: true, email: 'me@gmail.com' });
    expect(s.googleDrive.connected).toBe(true);
  });

  it('syncs jobs to Google Calendar without duplicates', async () => {
    // Off by default: nothing is created
    const j0 = await a().post('/api/jobs').send({ date: '2026-10-02', startTime: '08:45', clientName: 'Sonia', amount: 25 });
    await flush();
    expect(fake.events.size).toBe(0);

    await a().patch('/api/settings').send({ integrations: { googleCalendar: { enabled: true, syncTypes: ['job', 'bill', 'appointment'] } } }).expect(200);
    const job = (await a().post('/api/jobs').send({ date: '2026-10-03', startTime: '10:00', endTime: '11:30', clientName: 'Andrew Dana', amount: 30 })).body;
    await flush();
    expect(fake.events.size).toBe(1);
    const evId = (await a().get(`/api/jobs/${job.id}`)).body.sync.googleCalendarEventId;
    expect(fake.events.get(evId).summary).toBe('Andrew Dana · $30');

    await a().patch(`/api/jobs/${job.id}`).send({ amount: 35, startTime: '10:30' }).expect(200);
    await flush();
    expect(fake.events.size).toBe(1);
    expect(fake.events.get(evId).summary).toBe('Andrew Dana · $35');
    expect(fake.events.get(evId).start.dateTime).toBe('2026-10-03T10:30:00');

    // Event deleted in Google → re-created, still only one
    fake.events.clear();
    await a().patch(`/api/jobs/${job.id}`).send({ notes: 'x' }).expect(200);
    await flush();
    expect(fake.events.size).toBe(1);

    // Backfill picks up the job created while sync was off
    const counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.created).toBe(1);
    expect(fake.events.size).toBe(2);
    expect((await a().get(`/api/jobs/${j0.body.id}`)).body.sync.googleCalendarEventId).toBeTruthy();

    // Cancelling removes the event; deleting removes it too
    await a().patch(`/api/jobs/${job.id}`).send({ status: 'cancelled' }).expect(200);
    await flush();
    expect(fake.events.size).toBe(1);
    await a().delete(`/api/jobs/${j0.body.id}`).expect(200);
    await flush();
    expect(fake.events.size).toBe(0);
  });

  it('respects the import opt-out and event types', async () => {
    const msg = 'Schedule for Monday 12 Oct\nKim 9am ($50)\n3 Main Rd Norwood SA 5067';
    const p = (await a().post('/api/import/parse?today=2026-10-01').send({ text: msg })).body;
    const c = await a().post('/api/import/commit').send({ sourceMessage: msg, syncCalendar: false, jobs: p.jobs });
    expect(c.body.calendarSync).toBe('off');
    await flush();
    expect(fake.events.size).toBe(0);

    const bill = (await a().post('/api/bills').send({ name: 'Rent', amount: 320, frequency: 'weekly', dueDate: '2026-10-05' })).body;
    const task = (await a().post('/api/tasks').send({ title: 'Study', date: '2026-10-05', category: 'study' })).body;
    await flush();
    expect(fake.events.size).toBe(1); // bill yes; study task not in syncTypes
    const ev = [...fake.events.values()][0];
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);

    // Turning the bill type off and syncing removes bill events
    await a().patch('/api/settings').send({ integrations: { googleCalendar: { syncTypes: ['job'] } } }).expect(200);
    const counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.removed).toBe(1);
    expect(fake.events.size).toBe(0);
    expect((await a().get(`/api/bills/${bill.id}`)).body.sync?.googleCalendarEventId).toBeUndefined();
    expect(task.id).toBeTruthy();
  });

  it('uploads invoices and receipts to Drive without duplicates', async () => {
    await a().patch('/api/settings').send({ integrations: { googleDrive: { enabled: true } } }).expect(200);
    const setup = (await a().post('/api/integrations/google/drive/setup').send({})).body;
    expect(setup.link).toContain('drive.google.com/drive/folders/');
    const folderCount = fake.folders().length;
    await a().post('/api/integrations/google/drive/setup').send({}).expect(200);
    expect(fake.folders().length).toBe(folderCount);
    expect(fake.folders()).toContain('Personal Finance/Invoices/2026/October');
    expect(fake.folders()).toContain('Personal Finance/Receipts/2026');
    expect(fake.folders()).toContain('Personal Finance/Financial Documents');

    // Draft: not uploaded automatically
    const inv = (await a().post('/api/invoices').send({ issueDate: '2026-10-05', dueDate: '2026-10-12', clientName: 'Sparkle Co', items: [{ description: 'Cleaning', quantity: 1, rate: 100 }] })).body;
    await flush();
    expect(fake.uploaded()).toHaveLength(0);
    // Sent: uploaded into Invoices/2026/October
    await a().post(`/api/invoices/${inv.id}/status`).send({ status: 'sent' }).expect(200);
    await flush();
    let up = fake.uploaded();
    expect(up).toHaveLength(1);
    expect(up[0].path).toBe('Personal Finance/Invoices/2026/October/INV-2026-0001 - Sparkle Co.pdf');
    // Editing replaces the same file (new version), never a second copy
    await a().put(`/api/invoices/${inv.id}`).send({ issueDate: '2026-10-05', dueDate: '2026-10-12', clientName: 'Sparkle Co', items: [{ description: 'Cleaning', quantity: 2, rate: 100 }] }).expect(200);
    await flush();
    up = fake.uploaded();
    expect(up).toHaveLength(1);
    expect(up[0].versions).toBeGreaterThan(1);
    const manual = (await a().post(`/api/invoices/${inv.id}/drive`).send({})).body;
    expect(manual.link).toContain(up[0].id);
    expect(fake.uploaded()).toHaveLength(1);

    const doc = await a().post('/api/documents').field('meta', JSON.stringify({ kind: 'receipt', title: 'Fuel', date: '2026-10-03' })).attach('file', Buffer.from('%PDF-1.4 receipt'), { filename: 'fuel.pdf', contentType: 'application/pdf' });
    await flush();
    expect(fake.uploaded().some((f) => f.path === 'Personal Finance/Receipts/2026/fuel.pdf')).toBe(true);
    expect((await a().get(`/api/documents?q=Fuel`)).body.items[0].sync.googleDriveLink).toBeTruthy();
    expect(doc.status).toBe(201);
  });

  it('brings changes made in Google Calendar back into the app (two-way)', async () => {
    await a().patch('/api/settings').send({ integrations: { googleCalendar: { enabled: true, syncTypes: ['job', 'appointment', 'bill'] } } }).expect(200);
    const job = (await a().post('/api/jobs').send({ date: '2026-10-08', startTime: '09:00', endTime: '10:00', clientName: 'Moved Job', amount: 40 })).body;
    const appt = (await a().post('/api/tasks').send({ title: 'Dentist', date: '2026-10-08', startTime: '14:00', category: 'appointment' })).body;
    const bill = (await a().post('/api/bills').send({ name: 'Gym', amount: 20, frequency: 'weekly', dueDate: '2026-10-09' })).body;
    await flush();
    const jobEv = (await a().get(`/api/jobs/${job.id}`)).body.sync.googleCalendarEventId;
    const apptEv = (await a().get(`/api/tasks/${appt.id}`)).body.sync.googleCalendarEventId;
    const billEv = (await a().get(`/api/bills/${bill.id}`)).body.sync.googleCalendarEventId;

    // Nothing changed in Google yet → nothing pulled (our own writes are ignored)
    let counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.pulled).toBe(0);

    // In Google: drag the job to the next day 1–3pm (Adelaide time), rename + move the appointment, edit the bill
    fake.userEdits(jobEv, { start: { dateTime: '2026-10-09T13:00:00+10:30' }, end: { dateTime: '2026-10-09T15:00:00+10:30' } });
    fake.userEdits(apptEv, { summary: 'Dentist (Dr Lee)', start: { dateTime: '2026-10-08T05:00:00Z' }, end: { dateTime: '2026-10-08T05:30:00Z' } });
    fake.userEdits(billEv, { start: { date: '2026-10-20' }, end: { date: '2026-10-21' } });
    counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.pulled).toBe(2);
    await flush();

    const j = (await a().get(`/api/jobs/${job.id}`)).body;
    expect(j).toMatchObject({ date: '2026-10-09', startTime: '13:00', endTime: '15:00', hoursWorked: 2 });
    expect((await a().get(`/api/income?jobId=${job.id}`)).body.items[0].date).toBe('2026-10-09');
    const t = (await a().get(`/api/tasks/${appt.id}`)).body;
    expect(t).toMatchObject({ title: 'Dentist (Dr Lee)', date: '2026-10-08', startTime: '15:30' });
    // Bills belong to the app: the due date is not changed from the calendar
    expect((await a().get(`/api/bills/${bill.id}`)).body.dueDate).toBe('2026-10-09');
    const auditLog = (await a().get(`/api/audit?entity=Job&entityId=${job.id}`)).body.items;
    expect(auditLog[0].note).toBe('Changed in Google Calendar');
    // Still exactly one event per record
    expect([...fake.events.values()].filter((e) => e.extendedProperties.private.ptRef === `job:${job.id}`)).toHaveLength(1);

    // Deleting the event in Google keeps the job but stops syncing it (it is not re-created)
    fake.userDeletes(jobEv);
    counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.detached).toBe(1);
    const after = (await a().get(`/api/jobs/${job.id}`)).body;
    expect(after.status).toBe('scheduled');
    expect(after.sync.calendarOptOut).toBe(true);
    expect([...fake.events.values()].some((e) => e.extendedProperties.private.ptRef === `job:${job.id}`)).toBe(false);

    // Turning two-way off stops pulling
    await a().patch('/api/settings').send({ integrations: { googleCalendar: { twoWay: false } } }).expect(200);
    fake.userEdits(apptEv, { start: { dateTime: '2026-10-10T01:00:00Z' }, end: { dateTime: '2026-10-10T01:30:00Z' } });
    counts = (await a().post('/api/integrations/google/calendar/sync').send({})).body.counts;
    expect(counts.pulled).toBe(0);
    await a().patch('/api/settings').send({ integrations: { googleCalendar: { twoWay: true } } }).expect(200);
  });

  it('flags the account when Google access is revoked', async () => {
    fake.failNext(Object.assign(new Error('invalid_grant'), { code: 400 }));
    await a().patch('/api/settings').send({ integrations: { googleCalendar: { syncTypes: ['job', 'appointment'] } } }).expect(200);
    await a().post('/api/tasks').send({ title: 'Dentist', date: '2026-10-06', startTime: '14:00', category: 'appointment' }).expect(201);
    await flush();
    fake.clearFail();
    const s = (await a().get('/api/integrations')).body;
    expect(s.googleCalendar.needsReconnect).toBe(true);
    expect(s.googleCalendar.connected).toBe(false);
    await a().post('/api/integrations/google/disconnect').send({}).expect(200);
    expect((await a().get('/api/integrations')).body.googleCalendar.email).toBeUndefined();
  });
});
