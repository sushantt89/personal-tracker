import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let a: ReturnType<typeof request.agent>;
const day = { today: '2026-10-10' };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test' });
  await mongoose.connect(mongo.getUri());
  app = (await import('../src/app.js')).createApp();
  a = request.agent(app);
  await a.post('/api/auth/register').send({ name: 'Sush', email: 'assistant@example.com', password: 'password123' }).expect(201);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const afford = async (amount: number) => (await a.post('/api/assistant/afford').query(day).send({ amount, name: 'Thing' }).expect(200)).body;

describe('assistant', () => {
  it('asks for more information when it knows nothing', async () => {
    const r = await afford(200);
    expect(r.verdict).toBe('unknown');
    const o = (await a.get('/api/assistant/overview').query(day).expect(200)).body;
    expect(o.balance.known).toBe(false);
    expect(o.notes[0].text).toContain('how much money you have');
  });

  it('weighs a purchase against balance, bills, expected income, everyday spending and savings', async () => {
    // $1,000 in the bank; rent $600 due in 3 days; $500 pay expected in 6 days; $300/month everyday spending; save $100/month
    await a.put('/api/assistant/balance').query(day).send({ amount: 1000 }).expect(200);
    await a.post('/api/bills').query(day).send({ name: 'Rent', amount: 600, frequency: 'monthly', dueDate: '2026-10-13' }).expect(201);
    await a.post('/api/income').query(day).send({ date: '2026-10-16', amount: 500, status: 'expected', description: 'Pay' }).expect(201);
    await a.put('/api/budget').query(day).send({ expectedVariableExpenses: 304, monthlySavingsTarget: 100 }).expect(200);

    const o = (await a.get('/api/assistant/overview').query(day)).body;
    expect(o.balance).toMatchObject({ amount: 1000, known: true, asOf: '2026-10-10' });
    // 1000 + 500 income − 600 rent (one due date inside 30 days) − 300 everyday = 600, then − 100 savings
    expect(o.safeToSpend).toMatchObject({ beforeSavings: 600, amount: 500, billsDue: 600, incomeExpected: 500 });
    expect(o.week.bills.map((b: any) => b.name)).toEqual(['Rent']);

    // Small: fine on every count
    let r = await afford(50);
    expect(r.verdict).toBe('yes');
    expect(r.checks.every((c: any) => c.status === 'pass')).toBe(true);
    expect(r.facts.find((f: any) => f.label === 'Left today if you buy it').value).toBe('$950.00');

    // The cash is there today, but rent is due before the next pay arrives → wait, with a date after payday
    r = await afford(400);
    expect(r.checks.find((c: any) => c.key === 'cash').status).toBe('pass');
    expect(r.checks.find((c: any) => c.key === 'bridge').status).toBe('fail');
    expect(r.verdict).toBe('wait');
    expect(r.affordableFrom >= '2026-10-16').toBe(true);
    expect(r.headline).toContain('wait until');

    // More than there is, now or later
    r = await afford(5000);
    expect(r.verdict).toBe('no');
    expect(r.checks.find((c: any) => c.key === 'cash').status).toBe('fail');
    expect(r.suggestions.join(' ')).toContain('wishlist');

    // Bills are covered, but it would stop this month's savings (target raised to $300)
    await a.put('/api/budget').query(day).send({ monthlySavingsTarget: 300 }).expect(200);
    r = await afford(330);
    expect(r.verdict).toBe('tight');
    expect(r.checks.find((c: any) => c.key === 'savings').status).toBe('warn');
    expect(r.checks.filter((c: any) => c.status === 'fail')).toHaveLength(0);
    await a.put('/api/budget').query(day).send({ monthlySavingsTarget: 100 }).expect(200);

    await a.post('/api/assistant/afford').query(day).send({ amount: 0 }).expect(400);
  });

  it('rolls the balance forward as income and expenses are recorded', async () => {
    await a.post('/api/expenses').query(day).send({ date: '2026-10-11', amount: 40, description: 'Groceries' }).expect(201);
    await a.post('/api/income').query(day).send({ date: '2026-10-11', amount: 120, status: 'paid', description: 'Cash job' }).expect(201);
    // Recorded on the day the balance was entered or earlier: already part of the number the user typed
    await a.post('/api/expenses').query(day).send({ date: '2026-10-10', amount: 999, description: 'Earlier' }).expect(201);
    const o = (await a.get('/api/assistant/overview').query({ today: '2026-10-12' })).body;
    expect(o.balance).toMatchObject({ amount: 1080, enteredAmount: 1000, incomeSince: 120, expensesSince: 40 });
  });

  it('keeps a wishlist with a live verdict and records the expense when bought', async () => {
    const w = (await a.post('/api/assistant/wishlist').query(day).send({ name: 'Headphones', amount: 20 }).expect(201)).body;
    await a.post('/api/assistant/wishlist').query(day).send({ name: 'Laptop', amount: 5000 }).expect(201);
    const list = (await a.get('/api/assistant/wishlist').query(day)).body.items;
    expect(Object.fromEntries(list.map((x: any) => [x.name, x.verdict]))).toEqual({ Headphones: 'yes', Laptop: 'no' });

    const bought = (await a.post(`/api/assistant/wishlist/${w.id}/buy`).query(day).send({}).expect(201)).body;
    expect(bought.item.status).toBe('bought');
    expect(bought.expense).toMatchObject({ amount: 20, description: 'Headphones', date: '2026-10-10' });
    await a.post(`/api/assistant/wishlist/${w.id}/buy`).query(day).send({}).expect(400);
    // Another account can't see or touch it
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Other', email: 'other-assistant@example.com', password: 'password123' }).expect(201);
    expect((await b.get('/api/assistant/wishlist').query(day)).body.items).toHaveLength(0);
    await b.delete(`/api/assistant/wishlist/${w.id}`).expect(404);
  });

  it('plans a savings goal', async () => {
    const g = (await a.post('/api/assistant/goal').query(day).send({ target: 1300, byDate: '2027-01-09', alreadySaved: 0 }).expect(200)).body;
    expect(g.weeks).toBe(13);
    expect(g.perWeek).toBe(100);
    expect(g.detail[0]).toContain('$100.00 a week');
    await a.post('/api/assistant/goal').query(day).send({ target: 100, byDate: '2026-10-01' }).expect(400);
  });
});
