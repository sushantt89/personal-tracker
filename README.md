# Personal Tracker

An all-in-one personal life, work, income, expense, invoice and budgeting app — built so you can open it every day and understand your **time, work and money in a few seconds**.

The core automation: **paste your work schedule message → review the extracted jobs → click Import** → jobs, clients and expected income are created and the dashboard updates.

![stack](https://img.shields.io/badge/stack-React%20%7C%20Express%20%7C%20MongoDB-4f46e5)

---

## What's in phase 1 (working now)

| Area | What works |
|---|---|
| **Paste & Import** | Rule-based parser (no AI, no cost) for schedule messages: client, date, times/ranges, amount, address → street/suburb/state/postcode (state inferred from postcode), meeting point, description, tasks, rooms/bathrooms, special instructions. Also payment messages (“received $120 from…”), matched to expected income or invoices. Editable review screen with confidence + warnings; **nothing is saved until you click Import**. Duplicate-message and duplicate-job protection. |
| **Dashboard** | Income received/expected, expenses, net, left this month, **minimum income required**, outstanding/overdue invoices, today's schedule, upcoming bills, work stats (jobs week/month, hours, per job, per hour), 12+ charts. Filter by day/week/month/year/custom, income source and category. |
| **My Day** | Timeline 6am–10pm with tasks, jobs, bills and invoice due dates; drag & drop to reschedule; tick off tasks/jobs; recurring tasks; upcoming week; Google Maps route for the day's jobs. |
| **Calendar** | Month view of everything, type filters, click a day to open it. |
| **Jobs / Clients & contractors** | Full CRUD, filters, bulk “mark past jobs completed”. Jobs keep a linked income record in sync until it's paid. Clients are created automatically on import. |
| **Own business vs working under a contractor** | Each job is either *own business* (you invoice the client, income is from the client) or *under a contractor* (you invoice the contractor, income is from the contractor; the client is just where you worked). Set a default per income source (Settings → Finance), choose it on Paste & Import, or per job. The invoice generator bills a client (own jobs) or a contractor (their jobs). |
| **Income / Expenses** | Repeating income creates its next entries automatically (as *expected*, about a month ahead; stop any time). Full CRUD, multiple sources, customisable categories, payment methods, search, date filters, totals. |
| **Recurring bills** | Weekly/fortnightly/monthly/quarterly/yearly/custom; totals shown per week / fortnight / month / year (your choice); bills due per week or month; frequency filter; “Mark paid” records the expense once per due date. |
| **Budgets** | Income target, spending limit, expected variable expenses, savings & emergency fund, category budgets, progress bars. |
| **Invoices** | Create/edit/duplicate/delete, statuses (overdue computed automatically), **generate from completed jobs in any date range** (by source/client, pick individual jobs), auto-numbering (`INV-{YYYY}-{SEQ}`), GST, logo, **PDF download/preview**, **saved templates** (bill-to, standard items, GST, notes, terms). Marking paid can (optionally) mark linked income paid. A job can only be invoiced once. |
| **Receipts / Documents** | Upload images/PDFs (stored privately). **Receipt OCR built in and free**: merchant, date, total, GST, payment method, items and a suggested category are read on your own server (tesseract.js with bundled English data — works offline, nothing sent to outside services; digital PDFs are read from their text layer, scanned PDFs from their page images, and iPhone HEIC photos are converted to JPG). Review, then *Upload & save expense* in one step. Duplicate-file detection. |
| **Reports** | Income / expenses / cash-flow / work, grouped by day/week/month/year/source/client/contractor/category/merchant/payment method. Downloads: **Excel (.xlsx)** with formatted sheets, live SUM totals and a sheet of every record; **PDF** with headline figures, a chart and the table; CSV; plus a *Full financial report* (all four reports, Excel or PDF). |
| **Distance & travel** | Turn on in Settings → Travel. Each work day's route (home → jobs in time order → home) is calculated automatically: km and drive time between jobs, km per day, estimated fuel cost (your $/L and L/100 km), income after fuel and income per km — on My Day, the Jobs list, the dashboard and the Work report. Free OpenStreetMap services (Nominatim + OSRM), no key; each address looked up once and cached; only addresses are sent. Optional `ORS_API_KEY` for OpenRouteService. |
| **Insights** | Factual summaries only (averages, largest category, month-over-month changes, shortfall vs required income, jobs, per-job/per-hour). No advice. |
| **Search** | Global search across clients, jobs, income, invoices, expenses, bills, documents, tasks — by text, amount (`30`) or date (`2026-10`). |
| **Notifications** | In-app bell, plus an optional **daily email summary** (any SMTP account) and **phone/computer notifications** (web push, installable as a home-screen app): bills due, overdue invoices, upcoming jobs, budget/income/savings alerts, high-priority tasks. Each reminder is sent once. Setup: [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md). |
| **Quick Add** | Floating “+” for a 5-second expense, income, job, task, bill, invoice, receipt or paste. |
| **Settings** | Profile, currency, timezone, theme (light/dark/system, remembered), categories, income sources, payment methods, notifications, invoice details & numbering, integrations status, audit log. |
| **Google Calendar & Drive** | Connect Google once (Settings → Integrations). Calendar: jobs, appointments, events, tasks, bills (recurring, with reminders) and invoice due dates — one event per record, updated on edit, removed on cancel/delete, *Sync now* backfill. **Two-way**: moving or retiming a job or one-off appointment in Google Calendar updates it in the app (audited); deleting the event just unlinks it. Drive: `Personal Finance/Invoices/YYYY/Month`, `Receipts/YYYY`, `Financial Documents`; invoice PDFs auto-upload when sent/paid and are replaced (not duplicated) after edits; receipts upload on add; *Open in Google Drive* links. Least-privilege scopes (`calendar.events`, `drive.file`), refresh token encrypted at rest. Setup: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md). |
| **Security** | bcrypt password hashing, JWT in httpOnly cookie, forgot/reset password (hashed one-time tokens), rate-limited auth, helmet, every query scoped to the logged-in user, cross-user reference checks, input validation (zod + Mongoose), append-only audit trail. |

### Still to come
These have **clean service interfaces** (`server/src/services/integrations`) that report “Not connected” — nothing pretends to work:
nothing major — see the roadmap for future ideas. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap).

---

## Quick start (Windows, macOS or Linux)

**Requirements:** Node.js 20+ and a MongoDB database (free MongoDB Atlas M0 cluster, or MongoDB Community installed locally).

```bash
# 1. install
npm install

# 2. configure
copy .env.example .env        # Windows (PowerShell: Copy-Item .env.example .env)
cp .env.example .env          # macOS / Linux
#   then edit .env: set MONGODB_URI and a long random JWT_SECRET

# 3. (optional) load demo data — login demo@example.com / demo12345
npm run seed

# 4. run API (http://localhost:4000) + web app (http://localhost:5173)
npm run dev
```

Open **http://localhost:5173**, register, then go to **Paste & Import** and click *Try an example*.

### Getting a free MongoDB Atlas database
1. Create an account at mongodb.com/atlas → **Create cluster → M0 (Free)**.
2. *Database Access*: add a user + password. *Network Access*: add your IP (or `0.0.0.0/0` for hosted deploys).
3. *Connect → Drivers* → copy the `mongodb+srv://…` string into `MONGODB_URI` (add a database name, e.g. `/personal-tracker`).

### Generate a JWT secret
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` proxy |
| `npm run build` | Type-check & build server (`server/dist`) and client (`client/dist`) |
| `npm start` | Run the built server; in `NODE_ENV=production` it also serves the web app |
| `npm test` | Parser unit tests + full API integration tests (in-memory MongoDB) |
| `npm run typecheck` | TypeScript checks for both packages |
| `npm run seed` | Reset and load the demo account (refuses in production) |

## Project structure

```
personal-tracker/
├─ server/                 Express + TypeScript + Mongoose API
│  ├─ src/
│  │  ├─ config/           env validation (zod), db connection
│  │  ├─ models/           Mongoose schemas (User, Job, Income, Invoice…)
│  │  ├─ middleware/       auth (JWT cookie), validation, errors
│  │  ├─ routes/           auth, resources (CRUD), import, invoices, analytics, documents, settings
│  │  ├─ services/
│  │  │  ├─ parser/        rule-based message parser (pure, unit-tested)
│  │  │  ├─ integrations/  Calendar / Drive / OCR / Travel interfaces
│  │  │  ├─ crud.ts        generic user-scoped CRUD router with audit trail
│  │  │  ├─ finance.ts     dashboard maths, required income, bills due
│  │  │  ├─ invoices.ts    numbering, totals, PDF rendering (pdfkit)
│  │  │  └─ …              recurrence, insights, alerts, storage, email
│  │  └─ scripts/seed.ts
│  └─ tests/               parser.test.ts, api.test.ts
├─ client/                 React + TypeScript + Vite + MUI + Recharts
│  └─ src/
│     ├─ api/              fetch client + shared types
│     ├─ components/       ResourcePage, EntityForm, charts, common UI
│     ├─ layout/           sidebar, top bar, global search, alerts, Quick Add
│     ├─ pages/            Dashboard, MyDay, PasteImport, InvoiceEditor, …
│     └─ theme/            light/dark theme, validated chart palette
└─ docs/                   ARCHITECTURE.md, API.md
```

## Deploying for free

The production server serves the built React app from the same origin, so **one free web service** is enough:

1. Push to GitHub.
2. Create a **Web Service** on Render (free tier) — or Railway/Fly/Koyeb:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL=https://<your-app>.onrender.com` (+ `GOOGLE_*` with `GOOGLE_REDIRECT_URI=https://<your-app>.onrender.com/api/integrations/google/callback`)
3. Uploaded receipts are stored on local disk (`UPLOAD_DIR`). Free hosts often have **ephemeral disks** — files can disappear on redeploy. Turn on Google Drive (auto-upload keeps a copy of every receipt and sent invoice in your Drive), use a host with a persistent disk, or run locally.

Password-reset emails print to the server console unless `SMTP_*` is set (a Gmail app password or Brevo's free tier works).

## Data safety rules (how they're enforced)
- Parsed data is **never saved automatically** — `/api/import/parse` has no side effects; `/api/import/commit` saves only what you reviewed.
- Same message twice → blocked (SHA-256 of normalised text); same client + date + time → flagged as duplicate.
- Paid income is never changed automatically; linked expected income follows its job until paid.
- Every create/update/delete of financial records is written to an append-only audit log (Settings → Audit log).
- Amounts and dates are validated on both client and server; all routes except auth require login and are scoped to your user id.

## Phone, tablet and Home Screen

The layout adapts to phones, tablets and computers, the app can be added to the Home Screen, and it has in-app notifications (bell, pop-ups, notifications page). See `docs/MOBILE.md` and `docs/NOTIFICATIONS.md`. To try it on a phone on the same Wi‑Fi: `npm run dev:phone`.
#   p e r s o n a l - t r a c k e r  
 