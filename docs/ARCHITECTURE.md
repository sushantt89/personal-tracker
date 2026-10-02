# Architecture

## Overview

```
Browser (React SPA) ──fetch /api (httpOnly JWT cookie)──► Express API ──► MongoDB (Atlas M0)
                                                            │
                                                            ├─ services/parser       (pure, no I/O)
                                                            ├─ services/finance      (dashboard maths)
                                                            ├─ services/invoices     (pdfkit)
                                                            ├─ services/storage      (local disk → Drive later)
                                                            └─ services/integrations (Calendar/Drive/OCR/Travel interfaces)
```

### Key decisions
- **Dates are stored as `YYYY-MM-DD` strings and times as `HH:mm`.** A personal planner is calendar-based; strings avoid timezone drift (“a job on 2 Oct is on 2 Oct”), compare chronologically, and make month grouping trivial. The client sends its local date as `?today=` so “today” follows the device; the profile timezone is the fallback.
- **Money** is stored as numbers rounded to cents on write (schema setter + zod transform) and summed with a rounding helper.
- **Invoice line items are embedded** in the invoice document (they're always read/written together) — this is the `InvoiceItem` entity from the spec.
- **Job ↔ Income link.** A job with an amount gets one income record (`status: expected`, `jobId`). Job edits mirror into that income until it is paid; cancelling a job cancels unpaid income. This keeps income-based charts complete without double entry.
- **Generic CRUD factory** (`services/crud.ts`) gives every resource the same behaviour: user scoping, validation, referenced-id ownership checks, search/filter/date-range/pagination, audit logging and hooks.
- **Alerts and insights are computed on request** from live data — no stale notification rows. A `Notification` collection can be added later for push/email delivery.

## Data model

| Collection | Purpose / key fields | Relationships |
|---|---|---|
| `User` | name, email (unique), passwordHash (bcrypt), currency, timezone, theme, reset token hash/expiry, tokenVersion | — |
| `Settings` | payment methods, notification toggles, invoice details & numbering (`numberFormat`, `nextSequence`), GST, logo, integration prefs | 1:1 User |
| `Category` | expense categories (name, colour, archived) | User |
| `IncomeSource` | Cleaning, McDonald's, … (colour, isJobBased, archived) | User |
| `Client` | name, contact, address, default rate | User, IncomeSource |
| `Job` | date, start/end, amount, hours, address, meeting point, description, tasks[], rooms, bathrooms, instructions, status, sourceMessage | User, Client, IncomeSource, Invoice, ImportBatch |
| `Income` | date, amount, status (expected/pending/paid/cancelled), paidDate, method, hours, invoiceNumber, recurring | User, IncomeSource, Client, Job, Invoice |
| `Expense` | date, amount, category, merchant, method, GST, recurring flag, bill occurrence | User, Category, RecurringBill, Document (receipt) |
| `RecurringBill` | amount, frequency (+custom days), first due date, start/end, auto-renew/pay, reminder days | User, Category |
| `Invoice` | number (unique per user), dates, client snapshot, **items[]** (date, description, qty, rate, amount, jobId), subtotal, GST, total, status, period | User, Client, IncomeSource, Job (via items) |
| `Task` | My Day items: title, date, times, location, priority, status, category, recurrence, per-occurrence status | User |
| `Budget` | income target, spending limit, expected variable expenses, savings/emergency targets & balances, category budgets[] | 1:1 User, Category |
| `Document` | uploaded receipts/invoices/statements: storage provider + key, sha256 (dedupe), receipt metadata | User, Expense, Invoice, Category |
| `ImportBatch` | message hash + created job/income ids (duplicate-import protection, history) | User, Job, Income |
| `InvoiceTemplate` | reusable invoice content: bill-to, items, GST, terms, notes | User, Client, IncomeSource |
| `GoogleAccount` | connected Google account: email, **encrypted** refresh token, granted scopes, reconnect flag, Drive folder id cache | 1:1 User |
| `TravelDay` | one work day's route: stops, legs (km/min), totals, addresses not found, signature (skip recompute when nothing changed) | User, Job |
| `GeocodeCache` | address → coordinates, looked up once per user | User |
| `AuditLog` | entity, entityId, action, before, after, note (append-only) | User |

External sync ids (`sync.googleCalendarEventId`, `sync.googleDriveFileId/link`) live on Job, Task, Bill, Invoice and Document so a future sync can be idempotent (update instead of duplicate).

## Minimum income required
```
monthly equivalent of each active bill:
  weekly × 52 ÷ 12 · fortnightly × 26 ÷ 12 · monthly · quarterly ÷ 3 · yearly ÷ 12 · custom × 365 ÷ 12 ÷ days
minimum monthly income = Σ bills + expected variable expenses + monthly savings target
```

## The parser (`server/src/services/parser`)
Line-oriented state machine, pure and unit-tested:
1. Normalise text (dashes, quotes, whitespace); detect greeting (“Hi SUSHANT”).
2. **Date lines** (“Friday 2 OCT”, “2/10”, “tomorrow”, “Saturday 3 Oct” between jobs for multi-day schedules); year inferred as the nearest sensible occurrence.
3. **Meeting point** (“Meet at … at 8:45am”).
4. **Job headers**: a line with a time/time-range plus a name and/or amount (`Sonia 8:45am ($25)`, `Andrew Dana - 10am ($30)`, `9am-11am Jane $60`). Lines like “Arrive by 9am please” are rejected.
5. Lines after a header: **street line** (number + street suffix, units like `4/18`), **locality line** (suburb/state/postcode/“Australia”), then description sentences → tasks (action verbs, split on commas and “and” only when the next phrase is an action), special instructions (please/key/code/pet…), rooms & bathrooms counts, phone numbers.
6. Confidence score + warnings per job; summary totals.
7. Payment lines (“received/paid/transfer … $X from Name … INV-…”).

AI parsing can be added later as another implementation behind the same `ParseResult` shape, used only as a fallback.

## Cost

| Component | Cost |
|---|---|
| React, MUI, Recharts, Express, Mongoose, pdfkit, zod, bcryptjs, jsonwebtoken, multer, nodemailer | **Free** (open source) |
| MongoDB Atlas M0 (512 MB) | **Free** |
| Hosting: Render / Railway / Koyeb free tiers (one service serves API + app) | **Free** (cold starts on idle) |
| Rule-based parser | **Free** (no API) |
| Google Calendar & Drive APIs | **Free** within quotas |
| Receipt OCR with tesseract.js (runs on your server, offline) | **Free** |
| Routing with OpenRouteService / OSRM (phase 2) | **Free** tier |
| *Optional:* AI parsing fallback (Claude / OpenAI API) | Paid per use |
| *Optional:* Google Maps Distance Matrix | Paid beyond monthly credit |
| *Optional:* Persistent disk for uploads on a host, SMTP provider beyond free tier | Paid |

## Roadmap

**Done — Google integration** (`server/src/services/google`): OAuth with signed state, AES-256-GCM encrypted refresh token, calendar upsert by stored id → private `ptRef` property → insert (no duplicates), recurring bills/tasks via RRULE, Drive folder cache + sha256 de-duplication + in-place file updates, background queue so Google never slows requests.

**Done — travel & exports**: OSM geocoding (postcode/suburb-checked, cached) + OSRM routing behind a swappable provider, per-day `TravelDay` with signature-based caching and background recompute; Excel (exceljs) and PDF (pdfkit) report exports from one `buildReport` service.

**Next ideas**: optional AI parse fallback; Google Drive fallback for receipt files on hosts with temporary disks.

**Later** (architecture already allows): bank/Open Banking import (new `Transaction` source feeding Expense/Income with review), SMS/email/WhatsApp parsing (same parser entry point), GST/tax estimation (GST fields exist), savings goals & net worth, multi-currency, shared/family accounts (add `accountId` alongside `userId`), client portal, invoice emailing & payment links, recurring invoices, AI summaries.
