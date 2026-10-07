import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
const emails: { to: string; subject: string; text: string }[] = [];
const pushes: { endpoint: string; payload: { title: string; body?: string } }[] = [];
let goneEndpoint = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test', SMTP_HOST: 'smtp.example.test' });
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import('../src/app.js');
  const { setNotifySenders } = await import('../src/services/notify/index.js');
  setNotifySenders({
    email: async (to, subject, text) => { emails.push({ to, subject, text }); },
    push: async (sub, payload) => {
      if (sub.endpoint === goneEndpoint) throw Object.assign(new Error('gone'), { statusCode: 410 });
      pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  });
  app = createApp();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// Adelaide local time on 2–3 Oct 2026 (ACST, UTC+9:30; daylight saving starts 4 Oct)
const at = (hhmm: string, day = '2026-10-02') => new Date(`${day}T${hhmm}:00+09:30`);

describe('email and phone reminders', () => {
  let a: ReturnType<typeof request.agent>;
  let userId: string;

  it('sends one daily email at the chosen hour, and each phone reminder once', async () => {
    const { runNotifications } = await import('../src/services/notify/index.js');
    a = request.agent(app);
    userId = (await a.post('/api/auth/register').send({ name: 'Sush M', email: 'n@example.com', password: 'password123' })).body.user.id;
    await a.post('/api/bills').send({ name: 'Rent', amount: 320, frequency: 'weekly', dueDate: '2026-10-03' }).expect(201);
    await a.post('/api/jobs').send({ date: '2026-10-02', startTime: '10:00', clientName: 'Sonia', amount: 25 }).expect(201);

    // Off by default
    expect(await runNotifications(userId, at('08:00'))).toEqual({ email: false, push: 0 });

    const status = (await a.get('/api/notifications/status')).body;
    expect(status.emailConfigured).toBe(true);
    expect(status.pushPublicKey.length).toBeGreaterThan(40);
    await a.post('/api/notifications/push/subscribe').send({ subscription: { endpoint: 'https://push.example/phone', keys: { p256dh: 'p'.repeat(60), auth: 'a'.repeat(20) } } }).expect(201);
    await a.post('/api/notifications/push/subscribe').send({ subscription: { endpoint: 'https://push.example/old-laptop', keys: { p256dh: 'p'.repeat(60), auth: 'a'.repeat(20) } } }).expect(201);
    goneEndpoint = 'https://push.example/old-laptop';
    await a.patch('/api/settings').send({ notifications: { emailEnabled: true, emailHour: 7 } }).expect(200);

    // Before 7am: no email, no phone buzz
    expect(await runNotifications(userId, at('06:30'))).toEqual({ email: false, push: 0 });
    const r = await runNotifications(userId, at('08:00'));
    expect(r.email).toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('n@example.com');
    expect(emails[0].subject).toContain('Friday 2 October');
    expect(emails[0].text).toContain('Rent due tomorrow');
    expect(emails[0].text).toContain('Sonia');
    expect(pushes.map((p) => p.payload.title).sort()).toEqual(['Expected income is below required income', 'Rent due tomorrow', 'Today 10:00 am · Sonia']);
    // The expired device was removed
    expect((await a.get('/api/notifications/status')).body.devices).toHaveLength(1);

    // Later the same day: nothing is repeated
    expect(await runNotifications(userId, at('12:00'))).toEqual({ email: false, push: 0 });
    expect(emails).toHaveLength(1);

    // Next day: a new email, and the bill re-notifies because it is now due today
    pushes.length = 0;
    const next = await runNotifications(userId, at('07:10', '2026-10-03'));
    expect(next.email).toBe(true);
    expect(pushes.map((p) => p.payload.title)).toContain('Rent due today');
    // At night phone reminders wait until morning
    await a.post('/api/tasks').send({ title: 'Call bank', date: '2026-10-03', priority: 'high' }).expect(201);
    expect((await runNotifications(userId, at('22:30', '2026-10-03'))).push).toBe(0);
  });

  it('sends each job\'s own details to the phone as it is about to start', async () => {
    const { runNotifications } = await import('../src/services/notify/index.js');
    const b = request.agent(app);
    const uid = (await b.post('/api/auth/register').send({ name: 'Brief', email: 'brief@example.com', password: 'password123' })).body.user.id;
    await b.post('/api/notifications/push/subscribe').send({ subscription: { endpoint: 'https://push.example/brief-phone', keys: { p256dh: 'p'.repeat(60), auth: 'a'.repeat(20) } } }).expect(201);
    await b.patch('/api/settings').send({ notifications: { pushEnabled: true, billReminders: false, jobReminders: true } }).expect(200);
    await b.post('/api/jobs').send({ date: '2026-10-02', startTime: '09:00', clientName: 'Alex Stone', address: { line1: '53 Example Hill Road', suburb: 'Stirling', formatted: '53 Example Hill Road, Stirling' }, specialInstructions: 'Key is under the mat next to the garage', tasks: ['Bathrooms', 'Kitchen'], description: 'Thorough vacuum and mop' }).expect(201);
    await b.post('/api/jobs').send({ date: '2026-10-02', startTime: '22:30', clientName: 'Night Co', specialInstructions: 'Use the side gate' }).expect(201);
    const mine = () => pushes.filter((p) => p.endpoint === 'https://push.example/brief-phone').map((p) => p.payload as any).filter((p) => String(p.tag).startsWith('job-briefing')); // eslint-disable-line @typescript-eslint/no-explicit-any

    await runNotifications(uid, at('08:30'));
    expect(mine()).toHaveLength(0); // too early
    await runNotifications(uid, at('08:50'));
    expect(mine()).toHaveLength(1);
    expect(mine()[0].title).toBe('Alex Stone · 9:00 am');
    expect(mine()[0].body).toContain('53 Example Hill Road, Stirling');
    expect(mine()[0].body).toContain('Key is under the mat next to the garage');
    expect(mine()[0].body).toContain('• Bathrooms');
    expect(mine()[0].body).not.toContain('side gate'); // nothing from the other job
    expect(mine()[0].url).toMatch(/^\/jobs\?focus=/);
    await runNotifications(uid, at('09:00'));
    expect(mine()).toHaveLength(1); // once only
    // Night work still gets its details, even though ordinary reminders are quiet after 9pm
    await runNotifications(uid, at('22:20'));
    expect(mine()).toHaveLength(2);
    expect(mine()[1].body).toContain('Use the side gate');
  });

  it('test buttons work and report problems clearly', async () => {
    pushes.length = 0;
    await a.post('/api/notifications/test').send({ channel: 'push' }).expect(200);
    expect(pushes[0].payload.title).toBe('Personal Tracker');
    await a.post('/api/notifications/push/unsubscribe').send({ endpoint: 'https://push.example/phone' }).expect(200);
    const none = await a.post('/api/notifications/test').send({ channel: 'push' });
    expect(none.status).toBe(400);
  });
});
