# API reference

Base URL: `/api`. JSON in/out. All routes except `/auth/*` (register, login, forgot/reset) and `/health` require a session cookie (`pt_token`, httpOnly) or `Authorization: Bearer <jwt>`. Every record is scoped to the authenticated user.

Optional query `today=YYYY-MM-DD` on any request sets "today" (the web app sends the device's local date).

Errors: `{ "error": "message", "details"?: [{ "path": "amount", "message": "…" }] }` with status 400 (validation), 401, 404, 409 (duplicate/conflict), 413, 500.

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password, timezone? }` | Creates defaults (categories, sources, settings) and signs in |
| POST | `/auth/login` | `{ email, password }` | Rate-limited |
| POST | `/auth/logout` | – | Clears cookie |
| GET | `/auth/me` | – | Current user |
| PATCH | `/auth/me` | `{ name?, email?, currency?, timezone?, theme? }` | |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | Signs out other sessions |
| POST | `/auth/forgot-password` | `{ email }` | Always returns the same message |
| POST | `/auth/reset-password` | `{ token, password }` | Token valid 1 hour, single use |

## Standard resources
`/categories`, `/income-sources`, `/clients`, `/jobs`, `/income`, `/expenses`, `/bills`, `/tasks`, `/invoice-templates`

| Method | Path | Notes |
|---|---|---|
| GET | `/{resource}` | Query: `q` (text search), `from`, `to` (date range, where applicable), resource filters (e.g. `status`, `incomeSourceId`, `categoryId`, `clientId`, `jobId`, `paymentMethod`), `page`, `limit` → `{ items, total, page, limit }` |
| GET | `/{resource}/:id` | |
| POST | `/{resource}` | Validated body |
| PATCH | `/{resource}/:id` | Partial update |
| DELETE | `/{resource}/:id` | |

Extra behaviour:
- **Work arrangement**: jobs have `workType` (`own` | `subcontract`), `contractorId`, `contractorName`. If `workType` is omitted it comes from the income source (`workType`, `contractorId`). For subcontract jobs the linked income's payer (`clientId/clientName`) is the contractor. A new `contractorName` creates a client with `type: "contractor"`. Clients filter: `?type=client|contractor`.
- **Jobs**: creating a job with `amount` creates a linked expected income (send `createIncome: false` to skip); updates sync to unpaid linked income; invoiced jobs can't be deleted. `POST /jobs/complete-past` `{ ids? }` marks past scheduled jobs completed.
- **Bills**: `GET /bills/due?from&to` → occurrences with `paid` flag; `GET /bills/summary` → monthly equivalents + minimum income required; `POST /bills/:id/pay` `{ occurrence, date?, amount?, paymentMethod?, notes? }` creates the expense (409 if that occurrence is already paid).
- **Tasks**: `PATCH /tasks/:id/occurrence` `{ date, status }` for one occurrence of a recurring task.
- **Categories / income sources**: delete returns 409 if in use — archive with `PATCH { archived: true }`.

## Paste & Import
| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/import/parse` | `{ text }` | `{ kind, jobs[], payments[], summary, meetingPoint, warnings, alreadyImported, paymentMatches, suggestedIncomeSourceId }` — **no side effects** |
| POST | `/import/commit` | `{ sourceMessage, incomeSourceId?, workType?, contractorId?, contractorName?, createIncome=true, allowDuplicates=false, jobs[], payments[] }` | Creates clients (if new), jobs, expected income; payments create paid income or mark `matchIncomeId` paid. 409 on duplicate message/jobs unless `allowDuplicates`. Rolls back on failure. |
| GET | `/import/history` | – | Last 50 imports |

## Invoices
| Method | Path | Notes |
|---|---|---|
| GET | `/invoices` | `q`, `status` (`draft/sent/paid/cancelled/overdue/unpaid`), `clientId`, `incomeSourceId`, `from`, `to`. Each item has `effectiveStatus` (sent + past due → overdue) |
| GET | `/invoices/next-number` | Preview of next number |
| GET | `/invoices/candidates` | `from, to, incomeSourceId?, workType? (own|subcontract), clientId?, contractorId?, includeScheduled?` → un-invoiced jobs + total |
| GET | `/invoices/:id` | |
| POST | `/invoices` | `{ number?, issueDate, dueDate, clientName, clientId?, incomeSourceId?, items[{date?, description, quantity, rate, jobId?}], gstRate?, notes?, paymentDetails?, status?, periodFrom?, periodTo? }` — totals computed server-side; links jobs/income |
| PUT | `/invoices/:id` | Same body; re-links jobs |
| POST | `/invoices/:id/status` | `{ status, paidDate?, updateIncome?, paymentMethod? }` |
| POST | `/invoices/:id/duplicate` | New draft without job links |
| DELETE | `/invoices/:id` | Unlinks jobs/income |
| GET | `/invoices/:id/pdf` | `?download=1` for attachment |
| POST | `/invoices/:id/drive` | 409 until Google Drive is connected (phase 2) |

## Documents (receipts, uploaded invoices, statements)
| Method | Path | Notes |
|---|---|---|
| GET | `/documents` | `kind`, `q`, `expenseId` |
| POST | `/documents` | multipart: `file` (PDF/JPEG/PNG/WebP/HEIC, ≤ `MAX_UPLOAD_MB`) + `meta` JSON (optional `createExpense: { date, amount, merchant?, categoryId?, paymentMethod?, gst? }` creates and links the expense). Same file twice returns the existing record with `duplicate: true` |
| POST | `/documents/scan` | multipart `file` → OCR suggestions `{ merchant, date, total, gst, paymentMethod, categoryHint, items[], warnings[], rawText, confidence, source }` — **nothing is saved** |
| POST | `/documents/:id/scan` | Same, for an uploaded document |
| GET | `/documents/:id/file` | Streams the file (`?download=1`) |
| PATCH | `/documents/:id` | Metadata |
| POST | `/documents/:id/create-expense` | `{ date, amount, merchant?, categoryId?, paymentMethod?, gst? }` |
| DELETE | `/documents/:id` | |

## Analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | `from, to, incomeSourceId?, categoryId?` → money, month, week (this Mon–Sun: income, expenses, requiredIncome, previous week, changeFromPrevious), required, savings, bills, invoices, work, today, budget, charts |
| GET | `/calendar` | `from, to` → merged tasks (recurrences expanded), jobs, bills, invoice due dates |
| GET | `/search` | `q` — text, amount (`30`, `$30.00`) or date (`2026-10`, `2026-10-02`) |
| GET | `/reports/:type` | type = `income|expenses|cashflow|work|all`; `from, to, groupBy, format=json|csv|xlsx|pdf, detail=true` (`all` = full workbook/PDF) |
| GET | `/insights` | Factual summaries |
| GET | `/alerts` | Computed notifications (respects settings) |

## Settings
| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/settings` | Partial nested updates (payment methods, notifications, invoice, integrations) |
| GET | `/settings/invoice-number-preview` | `format, seq` |
| GET/PUT | `/budget` | |
| GET | `/integrations` | Status of Calendar / Drive / OCR / Travel |
| GET | `/audit` | `entity?, entityId?` → last 200 changes |

## Google (Calendar & Drive)
| Method | Path | Notes |
|---|---|---|
| GET | `/integrations/google/auth-url` | Consent URL (scopes `openid email calendar.events drive.file`, offline access, signed 10-minute `state`) |
| GET | `/integrations/google/callback` | Public; Google redirects here. Verifies `state`, stores the encrypted refresh token, redirects to `/settings?tab=integrations&google=connected|error` |
| POST | `/integrations/google/disconnect` | Revokes and removes the connection |
| POST | `/integrations/google/calendar/sync` | `{ removeAll? }` → `{ counts: { created, updated, removed, skipped, error } }` |
| POST | `/integrations/google/drive/setup` | Creates the folder structure → `{ rootFolderId, link }` |
| POST | `/invoices/:id/drive` | Upload, or replace the earlier upload |
| POST | `/documents/:id/drive` | Upload a document to Receipts / Invoices / Financial Documents |

Automatic sync: creating/updating/deleting jobs, tasks and bills (and invoice status changes) queues a background calendar sync when enabled; sent/paid invoices and new documents auto-upload when Drive auto-upload is on. `POST /import/commit` accepts `syncCalendar: false` to keep an import out of the calendar.

## Distance & travel
| Method | Path | Notes |
|---|---|---|
| GET | `/travel/day?date=` | Route for a day: `stops`, `legs` (km, minutes), `totalKm`, `totalMinutes`, `missing` (addresses not found), `fuel` |
| POST | `/travel/day/recalculate` | `{ date }` — force a fresh lookup |
| GET | `/travel/summary?from&to` | Per-day km, minutes, litres, fuel cost, income, income after fuel, income per km + totals |
| POST | `/travel/backfill` | `{ from, to }` — calculate days that have jobs but no route yet (max 62 per call) |

Settings: `PATCH /settings { travel: { enabled, homeAddress, startFrom: home|first_job, returnHome, fuelPricePerLitre, litresPer100km, countryCode } }`. Routes recalculate in the background when jobs are created, moved, edited, cancelled, deleted or imported.

## Notifications & background work
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications/status` | `{ emailConfigured, pushPublicKey, devices[], emailEnabled, pushEnabled }` |
| POST | `/notifications/push/subscribe` | `{ subscription }` (from `pushManager.subscribe`) — registers this device |
| POST | `/notifications/push/unsubscribe` | `{ endpoint }` |
| POST | `/notifications/test` | `{ channel: "email" | "push" }` |
| POST | `/income/:id/stop-recurring` | `{ removeFuture=true }` — stop a repeating income |

A scheduler runs every 10 minutes while the server is up: creates upcoming entries for repeating income, sends the daily email (once, at the chosen hour) and new push notifications (once each, 7am–9pm), and pulls changes made in Google Calendar. `POST /integrations/google/calendar/sync` now returns `pulled` and `detached` counts as well.

## In-app notifications
- `GET /api/alerts` → `{ items: [{ key, id, type, severity, title, message, link, read, firstSeenAt }], unread }`
- `POST /api/alerts/read | unread | dismiss` — body `{ keys: string[] }` or `{ all: true }`; returns the updated inbox
