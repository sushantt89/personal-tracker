import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { parseNewsFeed, setNewsFetcher } from '../src/services/news.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Sample</title>
<item><title>Student visa rules change &amp; fees rise - Example Times</title><link>https://news.example.com/a1</link><guid isPermaLink="false">g1</guid><pubDate>Fri, 02 Oct 2026 06:28:42 GMT</pubDate><description>&lt;a href="x"&gt;ignored&lt;/a&gt;</description><source url="https://example.com">Example Times</source></item>
<item><title><![CDATA[Adelaide’s new tram line opens - City Daily]]></title><link>https://news.example.com/a2</link><guid>g2</guid><pubDate>Thu, 01 Oct 2026 01:00:00 GMT</pubDate><source url="https://city.example">City Daily</source></item>
<item><title>Student visa rules change &amp; fees rise - Example Times</title><link>https://news.example.com/dup</link><source url="https://example.com">Example Times</source></item>
<item><title>No link here</title><link>javascript:alert(1)</link></item>
<item><title>Undated story</title><link>https://news.example.com/a3</link><pubDate>not a date</pubDate></item>
</channel></rss>`;

describe('news feed parsing', () => {
  it('reads headlines, strips the publisher suffix, and skips duplicates and unsafe links', () => {
    const items = parseNewsFeed(FEED);
    expect(items.map((i) => i.title)).toEqual(['Student visa rules change & fees rise', 'Adelaide’s new tram line opens', 'Undated story']);
    expect(items[0]).toMatchObject({ source: 'Example Times', link: 'https://news.example.com/a1', publishedAt: '2026-10-02T06:28:42.000Z', id: 'g1' });
    expect(items[2].publishedAt).toBeNull();
    expect(parseNewsFeed('not xml at all')).toEqual([]);
  });
});

describe('news API', () => {
  let mongo: MongoMemoryServer; let app: Express;
  const calls: string[] = [];
  let fail = false;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri(); process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
    const { createApp } = await import('../src/app.js');
    await mongoose.connect(mongo.getUri());
    app = createApp();
    setNewsFetcher(async (url) => { calls.push(url); if (fail) throw new Error('down'); return FEED; });
  });
  afterAll(async () => { setNewsFetcher(null); await mongoose.disconnect(); await mongo.stop(); });

  it('needs a login, lists the categories, caches, refreshes and falls back to the last copy', async () => {
    await request(app).get('/api/news').expect(401);
    const a = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Reader', email: 'reader@example.com', password: 'password123' }).expect(201);
    const cats = (await a.get('/api/news/categories').expect(200)).body.items;
    expect(cats.map((c: any) => c.key)).toEqual(['australia', 'adelaide', 'nepal', 'students', 'pr', 'visa', 'it']);

    const r = (await a.get('/api/news?category=nepal').expect(200)).body;
    expect(r).toMatchObject({ key: 'nepal', label: 'Nepal', stale: false });
    expect(r.items).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0])).toContain('Nepal when:7d');
    await a.get('/api/news?category=nepal').expect(200);
    expect(calls).toHaveLength(1); // served from the cache
    await a.get('/api/news?category=nepal&refresh=true').expect(200);
    expect(calls).toHaveLength(2);

    // Feed down: the last copy is shown and flagged; a topic never loaded comes back empty with a message
    fail = true;
    const stale = (await a.get('/api/news?category=nepal&refresh=true').expect(200)).body;
    expect(stale).toMatchObject({ stale: true });
    expect(stale.items).toHaveLength(3);
    const empty = (await a.get('/api/news?category=adelaide').expect(200)).body;
    expect(empty.items).toEqual([]);
    expect(empty.error).toBeTruthy();
    fail = false;

    const s = (await a.get('/api/news?q=nursing%20jobs').expect(200)).body;
    expect(s.label).toBe('nursing jobs');
    expect(decodeURIComponent(calls.at(-1)!)).toContain('nursing jobs when:7d');
    await a.get('/api/news?category=nope').expect(404);
    await a.get('/api/news?q=x').expect(400);
  });
});
