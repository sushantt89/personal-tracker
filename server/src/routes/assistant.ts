import { Router } from 'express';
import { z } from 'zod';
import { Budget, Category, Expense, SavingsGoal, WishItem } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { userCtx } from '../utils/userCtx.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { zDate, zMoney, zOptStr, zStr } from '../utils/zod.js';
import { audit } from '../services/audit.js';
import { assessPurchase, goalPlan, goalsOverview, overview, planGoal, previewContribution, snapshot } from '../services/assistant.js';

/** The Assistant: answers worked out from the user's own records. Nothing here changes data except the balance and the wishlist. */
const r = Router();
const amount = zMoney.refine((n) => n > 0, 'Enter an amount above zero');

r.get('/overview', async (req, res) => {
  const { today } = await userCtx(req);
  res.json(await overview(req.userId!, today));
});

/** "How much money do I have right now?" — remembered, then rolled forward with the income and expenses recorded afterwards. */
r.put('/balance', async (req, res) => {
  const body = parseBody(z.object({ amount: z.coerce.number().min(-10_000_000).max(100_000_000).transform((n) => Math.round(n * 100) / 100) }), req.body);
  const { today } = await userCtx(req);
  await Budget.findOneAndUpdate({ userId: req.userId }, { $set: { balance: { amount: body.amount, asOf: today } } }, { upsert: true });
  res.json(await overview(req.userId!, today));
});

r.post('/afford', async (req, res) => {
  const body = parseBody(z.object({ amount, name: zOptStr(120) }), req.body);
  const { today } = await userCtx(req);
  res.json({ name: body.name ?? null, ...assessPurchase(await snapshot(req.userId!, today), body.amount) });
});

r.post('/goal', async (req, res) => {
  const body = parseBody(z.object({ target: amount, byDate: zDate, alreadySaved: zMoney.optional() }), req.body);
  const { today } = await userCtx(req);
  if (body.byDate <= today) throw badRequest('Pick a date in the future');
  res.json(planGoal(await snapshot(req.userId!, today), body.target, body.byDate, body.alreadySaved ?? 0));
});

// ---------- Wishlist: things you're thinking of buying, re-checked every time ----------
r.get('/wishlist', async (req, res) => {
  const { today } = await userCtx(req);
  const [items, s] = await Promise.all([WishItem.find({ userId: req.userId }).sort({ status: -1, createdAt: -1 }).limit(100), snapshot(req.userId!, today)]);
  res.json({
    items: items.map((w) => {
      const a = w.status === 'wanted' ? assessPurchase(s, w.amount) : null;
      return { ...w.toJSON(), verdict: a?.verdict ?? null, headline: a?.headline ?? null, affordableFrom: a?.affordableFrom ?? null };
    }),
  });
});

r.post('/wishlist', async (req, res) => {
  const body = parseBody(z.object({ name: zStr(120).min(1, 'What is it?'), amount, notes: zOptStr(500) }), req.body);
  if ((await WishItem.countDocuments({ userId: req.userId, status: 'wanted' })) >= 50) throw badRequest('Your wishlist is full — remove something first.');
  const w = await WishItem.create({ ...body, userId: req.userId });
  res.status(201).json(w.toJSON());
});

r.delete('/wishlist/:id', async (req, res) => {
  const w = await WishItem.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!w) throw notFound('Wishlist item not found');
  res.json({ ok: true });
});

/** Bought it: records the expense and ticks the item off. */
r.post('/wishlist/:id/buy', async (req, res) => {
  const body = parseBody(z.object({ amount: amount.optional(), date: zDate.optional(), paymentMethod: zOptStr(60) }), req.body ?? {});
  const w = await WishItem.findOne({ _id: req.params.id, userId: req.userId });
  if (!w) throw notFound('Wishlist item not found');
  if (w.status === 'bought') throw badRequest('This is already marked as bought');
  const { today } = await userCtx(req);
  const shopping = await Category.findOne({ userId: req.userId, name: /^shopping$/i }).select('_id').lean();
  const exp = await Expense.create({ userId: req.userId, date: body.date ?? today, amount: body.amount ?? w.amount, description: w.name, categoryId: shopping?._id ?? null, paymentMethod: body.paymentMethod ?? 'Card', notes: 'From wishlist' });
  await audit(req.userId!, 'Expense', exp._id, 'create', undefined, exp.toJSON(), `Bought wishlist item ${w.name}`);
  w.set({ status: 'bought', boughtDate: exp.date, expenseId: exp._id });
  await w.save();
  res.status(201).json({ item: w.toJSON(), expense: exp.toJSON() });
});

// ---------- Saving up for something by a date ----------
r.get('/goals', async (req, res) => {
  const { today } = await userCtx(req);
  res.json(await goalsOverview(req.userId!, today));
});

r.post('/goals', async (req, res) => {
  const body = parseBody(z.object({ name: zStr(120).min(1, 'What are you saving for?'), target: amount, dueDate: zDate, alreadySaved: zMoney.optional() }), req.body);
  const { today } = await userCtx(req);
  if (body.dueDate < today) throw badRequest('Pick today or a later date');
  if ((body.alreadySaved ?? 0) >= body.target) throw badRequest('You already have this much saved');
  if ((await SavingsGoal.countDocuments({ userId: req.userId, archived: { $ne: true } })) >= 10) throw badRequest('You can have up to 10 goals at a time. Remove one first.');
  await SavingsGoal.create({ userId: req.userId, name: body.name, target: body.target, dueDate: body.dueDate, startDate: today, startingSaved: body.alreadySaved ?? 0 });
  res.status(201).json(await goalsOverview(req.userId!, today));
});

r.patch('/goals/:id', async (req, res) => {
  const body = parseBody(z.object({ name: zStr(120).min(1).optional(), target: amount.optional(), dueDate: zDate.optional() }), req.body);
  const g = await SavingsGoal.findOne({ _id: req.params.id, userId: req.userId });
  if (!g) throw notFound('Goal not found');
  g.set(body);
  await g.save();
  const { today } = await userCtx(req);
  res.json(await goalsOverview(req.userId!, today));
});

r.delete('/goals/:id', async (req, res) => {
  const g = await SavingsGoal.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!g) throw notFound('Goal not found');
  const { today } = await userCtx(req);
  res.json(await goalsOverview(req.userId!, today));
});

/** What a contribution of this size would do to the plan (nothing is saved). */
r.post('/goals/:id/preview', async (req, res) => {
  const body = parseBody(z.object({ amount }), req.body);
  const g = await SavingsGoal.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!g) throw notFound('Goal not found');
  const { today, currency } = await userCtx(req);
  res.json(previewContribution(goalPlan(g, today, currency), body.amount, currency));
});

/** Record money put aside for the goal. */
r.post('/goals/:id/contributions', async (req, res) => {
  const body = parseBody(z.object({ amount, date: zDate.optional(), note: zOptStr(200) }), req.body);
  const { today } = await userCtx(req);
  if (body.date && body.date > today) throw badRequest('The date can’t be in the future');
  const g = await SavingsGoal.findOne({ _id: req.params.id, userId: req.userId });
  if (!g) throw notFound('Goal not found');
  g.contributions.push({ date: body.date ?? today, amount: body.amount, note: body.note });
  await g.save();
  res.status(201).json(await goalsOverview(req.userId!, today));
});

r.delete('/goals/:id/contributions/:cid', async (req, res) => {
  const g = await SavingsGoal.findOne({ _id: req.params.id, userId: req.userId });
  if (!g) throw notFound('Goal not found');
  const c = g.contributions.id(req.params.cid);
  if (!c) throw notFound('That entry was not found');
  c.deleteOne();
  await g.save();
  const { today } = await userCtx(req);
  res.json(await goalsOverview(req.userId!, today));
});

export default r;
