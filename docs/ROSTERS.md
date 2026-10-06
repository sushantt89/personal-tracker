# Rosters and pay you only know later

For shift work where an employer gives you a roster (any employer — nothing here is tied to one company) and you only find out the pay on payday.

## 1. Upload the roster
1. **Paste & Import → Upload roster photo** and pick a screenshot or photo of your roster (JPG, PNG, WebP, HEIC or PDF). You can also paste the roster as text and click **Analyse**.
2. The app reads the text in the image on the server and finds each shift: date, start, finish (including shifts that end after midnight), paid hours, location and role.
3. Type the **Employer** once. It is used as the name on every shift and remembered for next time.
4. Check the shifts, fix anything that was misread, and click **Import**. Nothing is saved before that.

Shifts are saved as **Employee** work: paid as wages, never offered for invoicing. The Amount is left empty.

Uploading an updated roster later is safe: shifts that are already in the app are left unticked, so only new ones are added. If a shift's time changed, edit that shift under Jobs.

### What the reader understands
- Blocks with labelled lines: `Start 10:00 PM …` / `Finish 1:00 AM …` (also Begin/End, From/To, Clock in/out, `Start time: 22:00`).
- One line per shift: `Mon 5 Oct 9:00am - 5:00pm Checkout`.
- Dates like `06/Oct/2026`, `6 Oct`, `12/10/2026`; hours like `3:30hrs` or `7.5 hrs`.
- A location line such as `DARLINGTON SA` or a street address, and a role line such as `PB:Production Beginner`.
- Lines like "viewed at …" or "published …" are ignored.

Weekly grid/table rosters (days across the top, people down the side) are not read reliably — crop to your own shifts or type them in.

## 2. Optional: pencil in expected pay
So the dashboard and the Assistant can count shifts before you're paid, give them an estimate:

- **When uploading a roster:** fill in *Expected pay per hour*. Each shift gets hours × rate.
- **Later, for any jobs:** Jobs → **Expected pay**. Tick the jobs and enter an amount per hour, per job, or a total to share.
- **One job:** edit it, type the amount and switch on *This amount is an estimate*.

Estimated jobs show an **Expected** label, create an "expected" income record, and still count as waiting for actual pay.

## 3. Record the pay when you know it
**Jobs → Record pay**
1. Tick the shifts the payment covers (all waiting shifts for that employer are ticked to start with).
2. Enter the amount that reached your account and the date paid.
3. Choose how to share it: **Equally per job** (a lump sum divided by the number of jobs ticked) or **By hours worked**. Your choice is remembered.
4. **Record pay**. Each job gets its share, past jobs are marked completed, and the income is recorded as received.

This works for any jobs without an amount, not only rostered shifts. Under **Paid by**, pick the contractor or employer, or **Everyone** to tick jobs across several of them.

You can also open a single shift and type its amount.

Until then, shifts show a **Pay not set** label, the Jobs page has a **Pay → Not set yet** filter, and the bell reminds you when past shifts still have no pay.

## API
- `POST /api/import/roster` — multipart `file` (+ optional `employer`); returns the same review data as `/import/parse` plus `text` (what was read) and `format: 'roster'`. Nothing is saved.
- `POST /api/import/parse` — also accepts `employer`; roster-shaped text is detected automatically.
- `GET /api/jobs?pay=unset|set`
- `POST /api/jobs/record-pay` — `{ jobIds, total, paidDate?, paymentMethod?, split?: 'equal' | 'hours' }` (replaces any estimate)
- `POST /api/jobs/expected-pay` — `{ jobIds, mode: 'perHour' | 'perJob' | 'total', value }` (sets `amountEstimated`)
- Work types: `own`, `subcontract`, `employee`.

## Breaks
A break line inside a shift ("Break time 4:00 AM - 4:30 AM", "6:30hrs + 0:30hrs Break", "Meal break: 30 min") is kept with that shift — it never becomes a shift of its own. Breaks are treated as **unpaid**: a 12:00 am – 7:00 am shift with a 30-minute break is saved with **6.5 paid hours**, and the break is noted in the shift's description. Paid hours are what expected pay (hours × rate) and "share pay by hours" use. If a break is paid at your workplace, change *Paid hours* on the review screen before saving.

## A single shift screen (rostering apps)
A screenshot of one shift's details page — title, status, date, start–finish time, job type, address, notes, "Published by …" — is read as **one job at a client's place**, not as an employee roster:

- **Client** — from the title, with scheduling words removed ("Jordan Example weekly wednesdays" → "Jordan Example"). The full title is kept in the description with the job type.
- **Date, start, finish, paid hours** — from the date and time lines.
- **Address** — including apartment and level; a postcode that wrapped onto the next line is joined back on. For driving routes the apartment/level part is ignored when looking the street up on the map.
- **Special instructions** — the notes under "Attachments" / "Notes", with wrapped lines joined.
- **Working as** — "Under a contractor", with the contractor set to whoever published the shift. If you already have a contractor with that name (and an income source for it) those are selected; otherwise a new contractor is created when you import. Switch to *Employee* on the review screen if that's how you're paid.
- The app's own buttons, the phone's status bar and your own name are ignored. No pay is shown on these screens, so add the amount on the review screen or set expected pay later.

It is recognised by its shape (one date, one start–finish time, and words such as "Shift details", "Published by" or "Timeclock"), not by a particular app.
