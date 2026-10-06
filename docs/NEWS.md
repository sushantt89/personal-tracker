# News

A page of headlines by topic: **Australia, Adelaide, Nepal, International students, Permanent residency, Visa conditions, IT & tech**, plus a search box for anything else.

- Headlines come from **Google News RSS feeds** — free, no account or API key, nothing to set up.
- The list shows the headline, publisher and time. Tapping one opens a pop-up with the story's **main points**; **Read full article** opens it on the publisher's site in a new tab.
- Topic searches cover the **last 7 days** and keep Google's own ranking (relevance first, not strictly newest first).
- The server keeps each topic for **20 minutes** so the page opens quickly; **Refresh** fetches it again straight away.
- If the feed can't be reached, the last copy is shown with a note. On Render's free plan the copy is lost when the app goes to sleep.
- No AI: topics are plain search phrases. Results are only as good as the search — an unrelated story can slip in.
- Google's feed terms allow personal, non-commercial use in a feed reader. Keep it that way.

## Main points (the pop-up)
When you tap a headline the server reads the article page and picks out up to five sentences that carry most of the story — the ones using the words the article and its headline use most, favouring the opening paragraphs and sentences with figures. They are shown in the order they appear in the article.

- These are the **publisher's own sentences**, not a rewrite, and not AI. They can miss a point or include a less important one; read the article for the whole story.
- **It doesn't work for every publisher.** Sites behind a subscription or that block automated reading (for example many News Corp titles, the AFR, The Guardian, Reuters) give nothing to read. For those the pop-up shows a one- or two-line description of the story when a news search has one ("In brief"), or just says it couldn't be read. In testing, roughly half to two-thirds of headlines got full main points.
- Each summary is kept for 6 hours on the server so re-opening is instant.
- Only ordinary public web addresses are ever fetched.

## Changing the topics
Edit `NEWS_CATEGORIES` in `server/src/services/news.ts`. Each topic is either `query` (search words; `intitle:"…"` keeps results on-topic) or `path` (a ready-made Google News feed such as `/rss` for top stories).

## API
`GET /api/news/categories` · `GET /api/news?category=<key>` · `GET /api/news?q=<search>` · add `&refresh=true` to skip the cache · `POST /api/news/summary {link, title?}` → `{url, bullets[], limited, error?}`.
