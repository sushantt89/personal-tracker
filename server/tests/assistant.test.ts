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

  it('helps save up for something by a date, carrying over-saving and shortfalls into later weeks', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Saver', email: 'saver@example.com', password: 'password123' }).expect(201);
    // Monday 5 Oct 2026 → fee due Sunday 1 Nov: four Monday-to-Sunday weeks, $1,200 → $300 a week
    const mon = { today: '2026-10-05' };
    await b.put('/api/budget').query(mon).send({ expectedVariableExpenses: 2600 }).expect(200); // normal costs $2,600/month → $600/week
    await b.post('/api/assistant/goals').query(mon).send({ name: 'Uni fee', target: 1200, dueDate: '2026-10-04' }).expect(400);
    let o = (await b.post('/api/assistant/goals').query(mon).send({ name: 'Uni fee', target: 1200, dueDate: '2026-11-01' }).expect(201)).body;
    let g = o.goals[0];
    expect(g).toMatchObject({ name: 'Uni fee', weeksLeft: 4, originalPerWeek: 300, remaining: 1200, status: 'on_track' });
    expect(g.thisWeek).toMatchObject({ from: '2026-10-05', to: '2026-10-11', needed: 300, saved: 0, stillToPut: 300 });
    expect(g.weeks.map((w: any) => w.planned)).toEqual([300, 300, 300, 300]);
    // October has all four weeks in it
    expect(g.thisMonth).toMatchObject({ needed: 1200, stillToPut: 1200 });
    // Earning needed = normal costs + the goal
    expect(o.earn.week).toMatchObject({ normal: 600, goals: 300, total: 900, soFar: 0, toGo: 900 });
    expect(o.earn.month).toMatchObject({ normal: 2600, goals: 1200, total: 3800 });

    // Earned $1,000 this week and spent $300 → $700 spare, more than the $300 needed
    await b.post('/api/income').query(mon).send({ date: '2026-10-06', amount: 1000, status: 'paid', description: 'Pay' }).expect(201);
    await b.post('/api/expenses').query(mon).send({ date: '2026-10-07', amount: 300, description: 'Living' }).expect(201);
    const fri = { today: '2026-10-09' };
    o = (await b.get('/api/assistant/goals').query(fri)).body;
    expect(o.spare).toMatchObject({ amount: 700, received: 1000, spent: 300, stillToPut: 300 });
    expect(o.capacity.status).toBe('pass');
    expect(o.capacity.text).toContain('you could put in up to $700.00, which is $400.00 extra');
    expect(o.earn.week.toGo).toBe(0);
    // From Friday the bell reminds about this week's amount
    expect((await b.get('/api/alerts').query(fri)).body.items.some((x: any) => x.title === 'Put $300.00 aside for Uni fee')).toBe(true);
    expect((await b.get('/api/alerts').query({ today: '2026-10-07' })).body.items.some((x: any) => x.title.includes('Uni fee'))).toBe(false);

    // Put in $400: $100 ahead, so the other three weeks drop from $300 to $266.67
    let pv = (await b.post(`/api/assistant/goals/${g.id}/preview`).query(fri).send({ amount: 400 }).expect(200)).body;
    expect(pv).toEqual({ status: 'pass', text: '$100.00 more than this week needs. The next 3 weeks drop to $266.67 each.' });
    pv = (await b.post(`/api/assistant/goals/${g.id}/preview`).query(fri).send({ amount: 150 })).body;
    expect(pv.status).toBe('warn');
    expect(pv.text).toBe('$150.00 short of what this week needs. It gets made up over the next 3 weeks: $350.00 each instead of $300.00.');
    o = (await b.post(`/api/assistant/goals/${g.id}/contributions`).query(fri).send({ amount: 400 }).expect(201)).body;
    g = o.goals[0];
    expect(g).toMatchObject({ saved: 400, remaining: 800, status: 'ahead', perWeekAfterThis: 266.67 });
    expect(g.thisWeek).toMatchObject({ needed: 300, saved: 400, stillToPut: 0, aheadBy: 100 });
    expect(g.messages[0].text).toContain('$100.00 more than the $300.00 needed');

    // Next week only $150 goes in → $116.67 short of the $266.67, shared over the last two weeks
    const nextSun = { today: '2026-10-18' };
    o = (await b.get('/api/assistant/goals').query(nextSun)).body;
    expect(o.goals[0].thisWeek).toMatchObject({ from: '2026-10-12', needed: 266.67, stillToPut: 266.67 });
    o = (await b.post(`/api/assistant/goals/${g.id}/contributions`).query(nextSun).send({ amount: 150 }).expect(201)).body;
    expect(o.goals[0].thisWeek).toMatchObject({ saved: 150, stillToPut: 116.67 });
    const week3 = (await b.get('/api/assistant/goals').query({ today: '2026-10-19' })).body.goals[0];
    expect(week3).toMatchObject({ remaining: 650, weeksLeft: 2 });
    expect(week3.thisWeek.needed).toBe(325); // 650 over the two weeks left
    expect(week3.weeks.map((w: any) => [w.state, w.saved])).toEqual([['past', 400], ['past', 150], ['current', 0], ['future', 0]]);

    // Undo an entry, finish the goal, and tidy up
    o = (await b.delete(`/api/assistant/goals/${g.id}/contributions/${week3.contributions[0].id}`).query(nextSun).expect(200)).body;
    expect(o.goals[0].saved).toBe(400);
    o = (await b.post(`/api/assistant/goals/${g.id}/contributions`).query(nextSun).send({ amount: 800 }).expect(201)).body;
    expect(o.goals[0]).toMatchObject({ status: 'done', remaining: 0, percent: 100 });
    expect(o.earn.week.goals).toBe(0);
    await a.delete(`/api/assistant/goals/${g.id}`).expect(404); // someone else's goal
    o = (await b.delete(`/api/assistant/goals/${g.id}`).query(nextSun).expect(200)).body;
    expect(o.goals).toHaveLength(0);
  });
  it('counts saving goals when deciding whether something can be bought', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Buyer', email: 'buyer@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-05' };
    await b.put('/api/assistant/balance').query(q).send({ amount: 2000 }).expect(200);
    const afford = async (amount: number) => (await b.post('/api/assistant/afford').query(q).send({ amount }).expect(200)).body;
    // No goals: $1,500 of $2,000 is fine and no goal check appears
    let r = await afford(1500);
    expect(r.checks.find((c: any) => c.key === 'goals')).toBeUndefined();
    expect(r.verdict).toBe('yes');
    // A $1,200 fee due in four weeks: all of it has to be put aside inside the next 30 days
    await b.post('/api/assistant/goals').query(q).send({ name: 'Uni fee', target: 1200, dueDate: '2026-11-01' }).expect(201);
    const o = (await b.get('/api/assistant/overview').query(q).expect(200)).body;
    expect(o.safeToSpend).toMatchObject({ goals: 1200, amount: 800 });
    r = await afford(1500);
    const c = r.checks.find((x: any) => x.key === 'goals');
    expect(c.status).toBe('fail');
    expect(c.title).toContain('Uni fee');
    expect(c.detail).toContain('$700.00 short');
    expect(r.verdict).toBe('no');
    // Something small still fits alongside the goal
    r = await afford(300);
    expect(r.checks.find((x: any) => x.key === 'goals').status).toBe('pass');
    expect(r.verdict).toBe('yes');
    // A goal far in the future only needs the next few weeks' share, and overspending it is a warning, not a no
    await b.delete(`/api/assistant/goals/${(await b.get('/api/assistant/goals').query(q)).body.goals[0].id}`).query(q).expect(200);
    await b.post('/api/assistant/goals').query(q).send({ name: 'Trip', target: 2600, dueDate: '2027-04-04' }).expect(201); // 26 weeks → $100 a week
    r = await afford(1800);
    expect(r.checks.find((x: any) => x.key === 'goals')).toMatchObject({ status: 'warn', title: 'It eats into what you’re saving for' });
    expect(r.verdict).toBe('tight');
  });
});
