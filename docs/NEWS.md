# News

A page of headlines by topic: **Australia, Adelaide, Nepal, International students, Permanent residency, Visa conditions, IT & tech**, plus a search box for anything else.

- Headlines come from **Google News RSS feeds** — free, no account or API key, nothing to set up.
- Only the headline, publisher and time are shown. Tapping one opens the article on the publisher's site in a new tab.
- Topic searches cover the **last 7 days** and keep Google's own ranking (relevance first, not strictly newest first).
- The server keeps each topic for **20 minutes** so the page opens quickly; **Refresh** fetches it again straight away.
- If the feed can't be reached, the last copy is shown with a note. On Render's free plan the copy is lost when the app goes to sleep.
- No AI: topics are plain search phrases. Results are only as good as the search — an unrelated story can slip in.
- Google's feed terms allow personal, non-commercial use in a feed reader. Keep it that way.

## Changing the topics
Edit `NEWS_CATEGORIES` in `server/src/services/news.ts`. Each topic is either `query` (search words; `intitle:"…"` keeps results on-topic) or `path` (a ready-made Google News feed such as `/rss` for top stories).

## API
`GET /api/news/categories` · `GET /api/news?category=<key>` · `GET /api/news?q=<search>` · add `&refresh=true` to skip the cache.
