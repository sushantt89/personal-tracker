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

  it('test buttons work and report problems clearly', async () => {
    pushes.length = 0;
    await a.post('/api/notifications/test').send({ channel: 'push' }).expect(200);
    expect(pushes[0].payload.title).toBe('Personal Tracker');
    await a.post('/api/notifications/push/unsubscribe').send({ endpoint: 'https://push.example/phone' }).expect(200);
    const none = await a.post('/api/notifications/test').send({ channel: 'push' });
    expect(none.status).toBe(400);
  });
});
