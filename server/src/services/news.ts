/**
 * News headlines by topic, read from Google News RSS feeds (free, no API key).
 * Only headlines, sources and links are shown; articles open on the publisher's site.
 * Results are kept in memory for a while so opening the page doesn't hit the feed every time.
 */
export interface NewsItem { id: string; title: string; source: string; link: string; publishedAt: string | null }
export interface NewsCategory { key: string; label: string; /** search words, or a ready-made feed path */ query?: string; path?: string }

const LOCALE = 'hl=en-AU&gl=AU&ceid=AU:en';
export const NEWS_CATEGORIES: NewsCategory[] = [
  { key: 'australia', label: 'Australia', path: '/rss' },
  { key: 'adelaide', label: 'Adelaide', query: 'Adelaide OR "South Australia"' },
  { key: 'nepal', label: 'Nepal', query: 'Nepal' },
  { key: 'students', label: 'International students', query: 'intitle:"international students" OR intitle:"international student" OR intitle:"overseas students" Australia' },
  { key: 'pr', label: 'Permanent residency', query: 'intitle:"permanent residency" OR intitle:"permanent resident" OR intitle:"permanent residents" OR intitle:"skilled migration" OR intitle:"skilled visa" OR intitle:"PR pathway" Australia' },
  { key: 'visa', label: 'Visa conditions', query: 'intitle:visa Australia "student visa" OR "visa conditions" OR "visa changes" OR "visa rules" OR "work rights" OR "graduate visa" OR "Home Affairs"' },
  { key: 'it', label: 'IT & tech', query: 'Australia "tech industry" OR "IT jobs" OR "cyber security" OR "software" OR "artificial intelligence" OR "data breach" OR "tech sector"' },
];

const feedUrl = (c: { query?: string; path?: string }) =>
  c.query ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${c.query} when:7d`)}&${LOCALE}` : `https://news.google.com${c.path}?${LOCALE}`;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();
const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)?.[1];

/** Pull the articles out of an RSS document. Tolerant: anything it can't read is skipped. */
export function parseNewsFeed(xml: string, limit = 30): NewsItem[] {
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const link = decode(tag(body, 'link') ?? '');
    let title = decode(tag(body, 'title') ?? '');
    const source = decode(tag(body, 'source') ?? '');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    // Google appends " - Publisher" to every headline
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const date = new Date(decode(tag(body, 'pubDate') ?? ''));
    out.push({ id: decode(tag(body, 'guid') ?? link).slice(0, 200), title: title.slice(0, 300), source: source.slice(0, 120), link, publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString() });
  }
  // Keep the feed's own order: it is ranked by relevance and prominence, which beats plain newest-first for topic searches
  return out.slice(0, limit);
}

type Fetcher = (url: string) => Promise<string>;
const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalTracker/1.0; RSS reader)', Accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`News feed answered ${res.status}`);
  return res.text();
};
let fetcher: Fetcher = defaultFetcher;
/** Tests swap the network call for a fake. */
export const setNewsFetcher = (f: Fetcher | null) => { fetcher = f ?? defaultFetcher; cache.clear(); };

const TTL_MS = 20 * 60 * 1000;
const cache = new Map<string, { at: number; items: NewsItem[] }>();

export interface NewsResult { key: string; label: string; items: NewsItem[]; fetchedAt: string | null; stale: boolean; error?: string }

/** Headlines for one of the fixed categories, or for a free-text search. */
export async function getNews(opts: { category?: string; q?: string; refresh?: boolean }): Promise<NewsResult | null> {
  const q = opts.q?.replace(/\s+/g, ' ').trim();
  const cat = q ? { key: `q:${q.toLowerCase()}`, label: q, query: q } : NEWS_CATEGORIES.find((c) => c.key === opts.category);
  if (!cat) return null;
  const hit = cache.get(cat.key);
  if (hit && !opts.refresh && Date.now() - hit.at < TTL_MS) return { key: cat.key, label: cat.label, items: hit.items, fetchedAt: new Date(hit.at).toISOString(), stale: false };
  try {
    const items = parseNewsFeed(await fetcher(feedUrl(cat)));
    cache.set(cat.key, { at: Date.now(), items });
    if (cache.size > 60) cache.delete(cache.keys().next().value!); // searches shouldn't grow this without limit
    return { key: cat.key, label: cat.label, items, fetchedAt: new Date().toISOString(), stale: false };
  } catch (e) {
    // The feed is down or unreachable: show the last copy rather than nothing
    const msg = 'Couldn’t reach the news feed just now.';
    if (hit) return { key: cat.key, label: cat.label, items: hit.items, fetchedAt: new Date(hit.at).toISOString(), stale: true, error: msg };
    console.warn('news:', (e as Error).message);
    return { key: cat.key, label: cat.label, items: [], fetchedAt: null, stale: true, error: msg };
  }
}
