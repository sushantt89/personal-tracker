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
