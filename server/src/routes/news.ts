import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../middleware/validate.js';
import { notFound } from '../utils/httpError.js';
import { NEWS_CATEGORIES, getNews } from '../services/news.js';
import { summariseArticle } from '../services/newsSummary.js';

const r = Router();

r.get('/categories', (_req, res) => {
  res.json({ items: NEWS_CATEGORIES.map((c) => ({ key: c.key, label: c.label })) });
});

/** `?category=adelaide` for one of the fixed topics, or `?q=…` to search. `refresh=true` skips the 20-minute cache. */
r.get('/', async (req, res) => {
  const q = parseBody(z.object({ category: z.string().max(40).optional(), q: z.string().trim().min(2).max(80).optional(), refresh: z.enum(['true', 'false']).optional() }), req.query);
  const result = await getNews({ category: q.category ?? (q.q ? undefined : NEWS_CATEGORIES[0].key), q: q.q, refresh: q.refresh === 'true' });
  if (!result) throw notFound('Unknown news category');
  res.json(result);
});

/** The main points of one article as bullets, plus the publisher's own address for "read in full". */
r.post('/summary', async (req, res) => {
  const body = parseBody(z.object({ link: z.string().url().max(2000), title: z.string().max(400).optional() }), req.body);
  res.json(await summariseArticle(body.link, body.title ?? ''));
});

export default r;
