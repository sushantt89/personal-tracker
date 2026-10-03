# Assistant

The Assistant page answers money questions using only what you have entered in the app. It is ordinary arithmetic on your own records — no AI service is involved and nothing leaves the server. Treat it as a guide from your numbers, not financial advice.

## Money I have right now
Type what is in your account once (**Enter / Update**). From then on the app adjusts it itself: income marked as received after that date is added, and expenses recorded after that date are taken off. If it drifts from your bank, tap **Update** and type the real figure again.

If you never enter a balance, the Assistant falls back to what is left of this month's income and tells you it is guessing.

## Safe to spend (next 30 days)
`money you have + income expected − bills due − everyday spending − savings target − saving goals`

- **Income expected**: income records with status expected/pending dated in the next 30 days (for example jobs with an amount that aren't paid yet). Shifts whose pay you don't know yet count once you give them an expected amount (Jobs → Expected pay).
- **Bills due**: unpaid recurring bills falling due in the next 30 days.
- **Everyday spending**: "Expected variable expenses" from Budgets; if that is empty, the average of your non-bill spending over the last two full months.
- **Savings target**: the monthly savings target from Budgets.
- **Saving goals**: what you still have to put aside for your goals in the weeks starting within the next 30 days.

## Should I buy it?
Enter a price (and optionally what it is). The verdict comes from these checks, each shown with its numbers:

1. **Do you have the money today?**
2. **Are bills still covered until your next income?** Looks at bills and everyday spending up to your next expected income (or the next two weeks if none is recorded within three weeks).
3. **Do the next 30 days still work?** Needs to leave at least about a week of normal costs as a cushion.
4. **Is your savings target safe?** (only if you set one)
5. **Are your saving goals safe?** (only if you have goals under *Saving up for something*) Counts what you still have to put aside for them in the weeks starting within the next 30 days. If the purchase eats into that, it is flagged — and if one of those goals is due within 30 days, the answer is no.
6. **Is it a big purchase for you?** Flags anything over about 40% of a typical month's income.

| Verdict | Meaning |
| --- | --- |
| **Yes** | Every check passes. |
| **Yes, but tight** | Nothing fails, but something is flagged (little slack, savings target, saving goals, big purchase). |
| **Wait** | It fails today, but there is a day in the next two months when it fits — the date is shown. |
| **Not now** | It doesn't fit now or soon. Shows how much more you'd need and how many hours of work that is. |

It also shows the price as hours of work at your recent hourly rate, as a share of a typical month's income, and as days of everyday spending.

## Wishlist
Add anything you checked to the wishlist. Each item is re-checked every time the page opens, so you can see when it turns from "Not now" to "Yes". **I bought it** records the expense (dated today) and ticks it off.

## Saving up for something
For when you need a set amount by a set date — a fee, a bond, a trip. Press **New goal**, give it a name, the amount, the date, and anything you have already put aside.

**What it works out**
- **To earn this week / this month** — your normal costs (bills, everyday spending, usual savings target) plus what your goals need, less what you have already received or are expecting.
- **This week** — how much to put aside this week. It is always *what is left ÷ weeks left*, so the plan corrects itself.
- **This month** and **each week after**.
- **What is spare** — income received this week, less what you spent and what you already put aside. The page tells you whether that covers this week's amount, and how much extra you could put in.

**Putting money aside**
Type an amount under *Put money aside* (or tap **Needed** / **All spare**). Before you save it, you see what it does to the plan:
- More than needed — e.g. $300 needed and you put in $400: "$100 more than this week needs. The next 3 weeks drop to $266.67 each."
- Less than needed — e.g. $300 needed and you put in $150: "$150 short of what this week needs. It gets made up over the next 3 weeks: $350 each instead of $300."

Nothing is moved in your bank — this records what *you* moved. If you entered your balance under *Money I have right now*, money put aside is taken off it, so "Safe to spend" and "Should I buy it?" don't count it twice.

**Show week-by-week plan** lists every week (extra / short / done) and each entry, which you can remove if you made a mistake.

**Reminders** — from Friday to Sunday you get a notification if a goal still needs money that week, and another if a goal's date passes with money missing. Up to 10 goals.

## Also on the page
- **Heads up** notes: days when money is on course to run short, expected income that is past its date, and this month's income gap.
- **The next 7 days**: bills going out, income expected, jobs booked.
- **How much more do I need to work?** This month's shortfall turned into hours at your usual rate.
- **Where is my money going?** Top categories this month against last month.

## Accuracy
The answers are only as good as the records: income you expect but haven't entered isn't counted, and one-off costs you haven't recorded aren't either. Your hourly rate is taken from completed jobs with both pay and hours in the last 90 days.

## API
`GET /api/assistant/overview` · `PUT /api/assistant/balance {amount}` · `POST /api/assistant/afford {amount, name?}` · `GET|POST /api/assistant/goals {name, target, dueDate, alreadySaved?}` · `PATCH|DELETE /api/assistant/goals/:id` · `POST /api/assistant/goals/:id/preview {amount}` · `POST /api/assistant/goals/:id/contributions {amount, date?, note?}` · `DELETE /api/assistant/goals/:id/contributions/:cid` · `GET|POST /api/assistant/wishlist` · `DELETE /api/assistant/wishlist/:id` · `POST /api/assistant/wishlist/:id/buy`
