/**
 * Bullet-point summary of a news article, worked out by rules (no AI):
 * the article page is read, its main text is found, and the sentences that carry the most of the story are picked out.
 * These are the publisher's own sentences, shortened to a handful — not a rewrite.
 */
import { isIP } from 'node:net';

export interface ArticleSummary { url: string; bullets: string[]; /** the publisher only lets a little be read (paywall, script-only page…) */ limited: boolean; error?: string }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
type Http = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ url: string; text: string }>;
const defaultHttp: Http = async (url, init) => {
  const res = await fetch(url, { method: init?.method ?? 'GET', body: init?.body, redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-AU,en;q=0.8', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const buf = await res.arrayBuffer();
  return { url: res.url || url, text: new TextDecoder('utf-8').decode(buf.byteLength > 3_000_000 ? buf.slice(0, 3_000_000) : buf) };
};
let http: Http = defaultHttp;
/** Tests swap the network for a fake. */
export const setNewsSummaryHttp = (h: Http | null) => { http = h ?? defaultHttp; cache.clear(); };

/** Only ordinary public web addresses are ever fetched. */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || isIP(h.replace(/^\[|\]$/g, '')) || h === 'localhost' || /\.(local|internal|lan|home|localhost)$/.test(h)) return false;
    return !u.username && !u.password;
  } catch { return false; }
}

/** Google News links are a redirect page; this asks Google where the article really is, the way a browser does on click. */
export async function resolveNewsLink(link: string): Promise<string> {
  const u = new URL(link);
  if (u.hostname !== 'news.google.com') return link;
  const id = /\/articles\/([^/?]+)/.exec(u.pathname)?.[1];
  if (!id) return link;
  const page = await http(`https://news.google.com/rss/articles/${id}`);
  if (new URL(page.url).hostname !== 'news.google.com') return page.url; // already redirected
  const sg = /data-n-a-sg="([^"]+)"/.exec(page.text)?.[1], ts = /data-n-a-ts="([^"]+)"/.exec(page.text)?.[1];
  if (!sg || !ts) throw new Error('no redirect details');
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await http('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`,
  });
  const m = /garturlres\\",\\"(https?:[^\\"]+)/.exec(res.text);
  if (!m) throw new Error('no article address');
  return m[1].replace(/\\\\u003d/g, '=').replace(/\\\\u0026/g, '&');
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (s: string) => decode(s.replace(/<(script|style|noscript|figure|figcaption|svg|button|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html: string, names: string[]) => {
  for (const n of names) {
    const m = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, 'i').exec(html);
    if (m) return decode(m[1]).replace(/\s+/g, ' ').trim();
  }
  return '';
};
const BOILERPLATE = /\b(cookies?|subscribe|subscription|newsletter|sign up|sign in|log in|all rights reserved|copyright|terms of (use|service)|privacy policy|advertisement|read more:|follow us|share this|click here|download (the|our) app|javascript|your browser|acknowledg\w+ (the )?traditional|get the latest|breaking news alerts?|we pay our respects|join the conversation|related:|photo:|picture:|image:|supplied\)?$)/i;

/** The article's description and body paragraphs, from a page's HTML. */
export function extractArticle(html: string): { description: string; paragraphs: string[] } {
  const description = meta(html, ['og:description', 'description', 'twitter:description']);
  let paragraphs: string[] = [];
  // 1. Structured data many news sites publish
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = /"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(m[1])?.[1];
    if (body && body.length > 400) {
      let text = body;
      try { text = JSON.parse(`"${body}"`); } catch { /* keep as is */ }
      paragraphs = strip(text.replace(/\n+/g, ' </p><p> ')).split(/(?<=[.!?…”"])\s+(?=[A-Z“"‘'(])/).map((s) => s.trim()).filter(Boolean);
      break;
    }
  }
  // 2. Otherwise the paragraphs inside <article> (or the whole page)
  if (!paragraphs.length) {
    const scope = /<article[\s\S]*<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*<\/main>/i.exec(html)?.[0] ?? html;
    const cleaned = scope.replace(/<(script|style|noscript|nav|header|footer|aside|figure|form|svg)[\s\S]*?<\/\1>/gi, ' ');
    paragraphs = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1]));
  }
  return { description, paragraphs: paragraphs.filter((p) => p.length >= 50 && p.split(' ').length >= 8 && !BOILERPLATE.test(p)) };
}

const STOP = new Set('a an and are as at be been but by for from had has have he her his i if in into is it its more most not of on or our she so than that the their them then there these they this to up us was we were what when which who will with would you your said says say also after about over new one two can could just like out all no yes mr ms mrs dr per'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9’' ]+/g, ' ').split(/\s+/).map((w) => w.replace(/[’']s$/, '').replace(/^[’']|[’']$/g, '')).filter((w) => w.length > 2 && !STOP.has(w));
const similar = (a: string, b: string) => { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

/** Pick the handful of sentences that say the most. Pure function. */
export function summariseText(title: string, description: string, paragraphs: string[], max = 5): string[] {
  const sentences: { text: string; para: number; idx: number }[] = [];
  paragraphs.forEach((p, para) => {
    for (const s of p.split(/(?<=[.!?…])["”’']?\s+(?=["“‘']?[A-Z0-9])/)) {
      const text = s.replace(/\s+([.,;:!?])/g, '$1').trim();
      // Real sentences end with a full stop. Lines that don't are almost always links to other stories, scores or captions.
      if (!/[.!…]["”’')\]]*$/.test(text)) continue;
      if (text.length >= 50 && text.length <= 380 && text.split(' ').length >= 8 && !BOILERPLATE.test(text)) sentences.push({ text, para, idx: sentences.length });
    }
  });
  if (sentences.length < 3) return description ? [description] : sentences.map((x) => x.text);
  // How often each meaningful word appears across the article; words from the headline count double
  const freq = new Map<string, number>();
  for (const s of sentences) for (const w of new Set(words(s.text))) freq.set(w, (freq.get(w) ?? 0) + 1);
  const headline = new Set(words(`${title} ${description}`));
  const score = (s: (typeof sentences)[number]) => {
    const ws = words(s.text);
    if (!ws.length) return 0;
    const base = ws.reduce((a, w) => a + (freq.get(w) ?? 0) * (headline.has(w) ? 2 : 1), 0) / Math.sqrt(ws.length);
    const early = s.para === 0 ? 1.6 : s.para <= 2 ? 1.25 : 1; // news puts the point first
    const facts = /\d/.test(s.text) ? 1.15 : 1; // figures, dates and amounts are usually the substance
    return base * early * facts;
  };
  const ranked = [...sentences].sort((a, b) => score(b) - score(a));
  const picked: (typeof sentences)[number][] = [];
  for (const s of ranked) {
    if (picked.length >= max) break;
    if (picked.some((p) => similar(p.text, s.text) > 0.7)) continue; // don't say the same thing twice
    picked.push(s);
  }
  return picked.sort((a, b) => a.idx - b.idx).map((s) => s.text.replace(/^["“‘']+|["”’']+$/g, (m) => (m.length > 1 ? '' : m)));
}

/**
 * When the publisher's page can't be read (subscription, blocked), a news search usually still has a one- or two-line
 * description of the same story. Better one line than nothing.
 */
async function searchSnippet(title: string): Promise<string> {
  if (title.trim().length < 12) return '';
  try {
    const res = await http(`https://www.bing.com/news/search?q=${encodeURIComponent(title.slice(0, 160))}&format=rss&mkt=en-AU`);
    let best = '', bestScore = 0;
    for (const m of res.text.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const t = strip(/<title>([\s\S]*?)<\/title>/i.exec(m[1])?.[1] ?? ''), d = strip(decode(/<description>([\s\S]*?)<\/description>/i.exec(m[1])?.[1] ?? ''));
      const score = similar(t, title);
      if (score > bestScore && d.length >= 40) { best = d; bestScore = score; }
    }
    return bestScore >= 0.6 ? best : '';
  } catch { return ''; }
}

const cache = new Map<string, { at: number; value: ArticleSummary }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function summariseArticle(link: string, title = ''): Promise<ArticleSummary> {
  const hit = cache.get(link);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let url = link;
  const fail = (error: string): ArticleSummary => ({ url, bullets: [], limited: true, error });
  if (!isPublicHttpUrl(link)) return fail('This link can’t be opened here.');
  try { url = await resolveNewsLink(link); } catch { return fail('Couldn’t find where this article lives. Open it to read it.'); }
  if (!isPublicHttpUrl(url)) { url = link; return fail('This link can’t be opened here.'); }
  let value: ArticleSummary;
  try {
    const page = await http(url);
    if (isPublicHttpUrl(page.url)) url = page.url;
    const { description, paragraphs } = extractArticle(page.text);
    const body = paragraphs.join(' ');
    if (body.length < 500) {
      value = description ? { url, bullets: [description], limited: true } : { url, bullets: [], limited: true, error: 'This publisher doesn’t let the article be read here (it may need a subscription). Open it to read it.' };
    } else {
      const bullets = summariseText(title, description, paragraphs);
      value = bullets.length ? { url, bullets, limited: bullets.length < 3 } : { url, bullets: [], limited: true, error: 'Couldn’t pick the main points out of this page. Open the article to read it.' };
    }
  } catch {
    value = { url, bullets: [], limited: true, error: 'The publisher’s site didn’t respond or blocked the request. Open the article to read it.' };
  }
  // Nothing readable from the publisher: fall back to a short description of the same story from a news search
  if (!value.bullets.length) {
    const snippet = await searchSnippet(title);
    if (snippet) value = { url, bullets: [snippet], limited: true };
  }
  // Failures are remembered only briefly so a retry soon after can work
  cache.set(link, { at: value.error ? Date.now() - TTL_MS + 5 * 60 * 1000 : Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}
