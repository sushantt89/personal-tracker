# Today, Work hours and Kilometre log

## Today (the start screen)
The app now opens on **Today**; the old home page is still there as **Dashboard**.

- **Today's work** — each job in time order with address, tasks, key/access notes, pay and the drive from the stop before. **Start route** opens Google Maps with every stop in order. Swipe a job left, or tap the tick, to mark it completed (with Undo).
- **Also today** — appointments and tasks, bills due today (Mark paid) and invoices due.
- **Tomorrow** — how many jobs and when the first one starts.
- **This week's money** — how much more you need to earn this week, progress, and how it compares with last week. If you have saving goals, how much to put aside this week.
- **Work hours** — the current fortnight against your limit.
- **Bills in the next 7 days** — swipe left or tap Paid.

## Work hours
Adds up worked and still-scheduled hours per fortnight (two Monday-to-Sunday weeks) and compares them with a limit you set under *Settings* on that page.

- **Hours** are a shift's paid hours when entered (so unpaid breaks are left out), otherwise start to finish. A shift counts in the week it starts. Cancelled jobs never count.
- **Any two weeks in a row** (default, strictest): this week is checked with last week *and* with next week. **Fixed fortnights** run back-to-back from a start date you choose.
- **Room left this week** — how many more hours you could take on this week without any fortnight that includes it going over.
- **Work that counts** — employee shifts, work under a contractor, own-business jobs; untick what shouldn't count.
- **Notifications** — one when a fortnight that includes today, or one coming up, reaches 90% of the limit, and another when it goes over (part of "job reminders").
- The app only adds up what you enter. If a limit applies by law or contract, check the exact rule with whoever sets it.

API: `GET /api/work-hours` · settings under `PATCH /api/settings { work: { hoursLimit, fortnightMode: 'rolling'|'fixed', fortnightAnchor, countTypes[] } }`.

## Kilometre log
Driving for work across a financial year (1 July – 30 June), from the saved daily routes. Needs **Settings → Travel** turned on with a home address.

- **Counted** by default: driving **between jobs** only. Trips from home to the first job and back home are shown separately and left out, because travel between home and work usually can't be claimed; a switch counts them too.
- **Estimate** = counted km × your rate per km, for the first 5,000 km (the limit of the simple cents-per-kilometre method). The rate is a setting — the tax office changes it each year, so check the current figure.
- **Days with no route** — a banner offers to work them out (for example for days before travel was turned on).
- **Download CSV** — every trip with date, from, to, km and whether it was counted.
- It is a record to check against the tax office's rules or hand to a tax agent, not tax advice.

API: `GET /api/travel/logbook?fy=<start year>` (`&format=csv` to download) · settings under `PATCH /api/settings { travel: { ratePerKm, logCount: 'between'|'all' } }`.
