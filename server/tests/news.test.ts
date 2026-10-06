import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { parseNewsFeed, setNewsFetcher } from '../src/services/news.js';
import { extractArticle, summariseText, isPublicHttpUrl, setNewsSummaryHttp } from '../src/services/newsSummary.js';

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

const ARTICLE = `<html><head><title>Rates</title><meta property="og:description" content="The central bank has cut interest rates for the first time in two years."></head><body>
<nav><p>Subscribe to our newsletter for the latest breaking news alerts every single morning.</p></nav>
<article>
<p>The central bank cut interest rates by 0.25 percentage points on Tuesday, the first cut in two years.</p>
<p>The decision takes the cash rate to 3.6 per cent and will lower repayments on a typical mortgage by about $90 a month.</p>
<p>Governor Jane Example said inflation had fallen faster than the bank expected. She warned that further cuts were not guaranteed.</p>
<p>Other stories you might like from around the site today</p>
<p>Economists had been split on whether the bank would move, with markets pricing in a 60 per cent chance of a cut.</p>
<p>Borrowers should ask their lender whether the cut in interest rates will be passed on in full, consumer groups said.</p>
<p>Subscribe now to keep reading and sign up for our daily newsletter about rates and money.</p>
<p>The bank next meets in six weeks, when it will also publish its updated forecasts for inflation and unemployment.</p>
</article></body></html>`;

describe('news article summary', () => {
  it('finds the article text and picks its main sentences, in order, skipping boilerplate and link lines', () => {
    const { description, paragraphs } = extractArticle(ARTICLE);
    expect(description).toBe('The central bank has cut interest rates for the first time in two years.');
    expect(paragraphs.join(' ')).not.toMatch(/Subscribe|newsletter/);
    const bullets = summariseText('Central bank cuts interest rates', description, paragraphs, 4);
    expect(bullets).toHaveLength(4);
    expect(bullets[0]).toBe('The central bank cut interest rates by 0.25 percentage points on Tuesday, the first cut in two years.');
    expect(bullets.join(' ')).not.toContain('Other stories');
    // kept in the order they appear in the article
    const pos = bullets.map((b) => ARTICLE.indexOf(b.slice(0, 30)));
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    // a page with almost no readable text falls back to its description
    expect(summariseText('x', 'Short description of the story.', ['Too short.'])).toEqual(['Short description of the story.']);
  });
  it('only ever fetches ordinary public web addresses', () => {
    expect(isPublicHttpUrl('https://www.abc.net.au/news/x')).toBe(true);
    for (const bad of ['http://localhost:4000/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://10.0.0.5/x', 'file:///etc/passwd', 'http://intranet/x', 'http://db.internal/x', 'https://user:pw@example.com/', 'javascript:alert(1)']) expect(isPublicHttpUrl(bad)).toBe(false);
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
    // Summary: the Google link is resolved to the publisher, the page is read and summarised; failures come back as a message
    const seen: string[] = [];
    setNewsSummaryHttp(async (url) => {
      seen.push(url);
      if (url.startsWith('https://news.google.com/rss/articles/')) return { url, text: '<c-wiz><div data-n-a-sg="SIG" data-n-a-ts="123"></div></c-wiz>' };
      if (url.includes('batchexecute')) return { url, text: ')]}\'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.example-news.com/rates\\",1]"]]' };
      if (url === 'https://www.example-news.com/rates') return { url, text: ARTICLE };
      throw new Error('blocked');
    });
    const sum = (await a.post('/api/news/summary').send({ link: 'https://news.google.com/rss/articles/ABC123?oc=5', title: 'Central bank cuts interest rates' }).expect(200)).body;
    expect(sum).toMatchObject({ url: 'https://www.example-news.com/rates', limited: false });
    expect(sum.bullets.length).toBeGreaterThanOrEqual(4);
    const before = seen.length;
    await a.post('/api/news/summary').send({ link: 'https://news.google.com/rss/articles/ABC123?oc=5' }).expect(200);
    expect(seen.length).toBe(before); // remembered
    const blocked = (await a.post('/api/news/summary').send({ link: 'https://paywalled.example.org/story', title: 'Some other story entirely' }).expect(200)).body;
    expect(blocked.bullets).toEqual([]);
    expect(blocked.error).toBeTruthy();
    const local = (await a.post('/api/news/summary').send({ link: 'http://localhost:4000/api/settings' }).expect(200)).body;
    expect(local.error).toBeTruthy();
    expect(seen.some((u) => u.includes('localhost'))).toBe(false);
    await a.post('/api/news/summary').send({ link: 'not a link' }).expect(400);
    setNewsSummaryHttp(null);
    await a.get('/api/news?category=nope').expect(404);
    await a.get('/api/news?q=x').expect(400);
  });
});
