import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test' });
  await mongoose.connect(mongo.getUri());
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('in-app notifications', () => {
  it('tracks unread, read and dismissed notifications per user', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Sush', email: 'inbox@example.com', password: 'password123' }).expect(201);
    await a.patch('/api/settings').send({ notifications: { budgetAlerts: false } }).expect(200);
    await a.post('/api/bills').send({ name: 'Rent', amount: 320, frequency: 'monthly', dueDate: '2026-10-03' }).expect(201);
    await a.post('/api/bills').send({ name: 'Phone', amount: 45, frequency: 'monthly', dueDate: '2026-10-04' }).expect(201);
    const q = { today: '2026-10-02' };

    let inbox = (await a.get('/api/alerts').query(q).expect(200)).body;
    expect(inbox.items).toHaveLength(2);
    expect(inbox.unread).toBe(2);
    expect(inbox.items.every((i: { read: boolean; key: string; firstSeenAt: string }) => !i.read && i.key && i.firstSeenAt)).toBe(true);
    const rent = inbox.items.find((i: { title: string }) => i.title.startsWith('Rent'));
    const phone = inbox.items.find((i: { title: string }) => i.title.startsWith('Phone'));

    inbox = (await a.post('/api/alerts/read').query(q).send({ keys: [rent.key] }).expect(200)).body;
    expect(inbox.unread).toBe(1);
    // firstSeenAt is stable between requests
    expect(inbox.items.find((i: { key: string }) => i.key === phone.key).firstSeenAt).toBe(phone.firstSeenAt);

    inbox = (await a.post('/api/alerts/unread').query(q).send({ keys: [rent.key] }).expect(200)).body;
    expect(inbox.unread).toBe(2);

    inbox = (await a.post('/api/alerts/dismiss').query(q).send({ keys: [phone.key] }).expect(200)).body;
    expect(inbox.items.map((i: { key: string }) => i.key)).toEqual([rent.key]);

    inbox = (await a.post('/api/alerts/read').query(q).send({ all: true }).expect(200)).body;
    expect(inbox.unread).toBe(0);

    // The next day the rent reminder changes stage ("due today") and is new again; the dismissed phone bill moves to "tomorrow" and returns too
    inbox = (await a.get('/api/alerts').query({ today: '2026-10-03' })).body;
    expect(inbox.unread).toBe(2);

    await a.post('/api/alerts/bogus').send({}).expect(400);

    // Another user sees nothing of this
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Other', email: 'other-inbox@example.com', password: 'password123' }).expect(201);
    expect((await b.get('/api/alerts').query(q)).body).toEqual({ items: [], unread: 0 });
  });
});
