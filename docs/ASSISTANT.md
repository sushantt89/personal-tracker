# Assistant

The Assistant page answers money questions using only what you have entered in the app. It is ordinary arithmetic on your own records — no AI service is involved and nothing leaves the server. Treat it as a guide from your numbers, not financial advice.

## Money I have right now
Type what is in your account once (**Enter / Update**). From then on the app adjusts it itself: income marked as received after that date is added, and expenses recorded after that date are taken off. If it drifts from your bank, tap **Update** and type the real figure again.

If you never enter a balance, the Assistant falls back to what is left of this month's income and tells you it is guessing.

## Safe to spend (next 30 days)
`money you have + income expected − bills due − everyday spending − savings target`

- **Income expected**: income records with status expected/pending dated in the next 30 days (for example jobs with an amount that aren't paid yet).
- **Bills due**: unpaid recurring bills falling due in the next 30 days.
- **Everyday spending**: "Expected variable expenses" from Budgets; if that is empty, the average of your non-bill spending over the last two full months.
- **Savings target**: the monthly savings target from Budgets.

## Should I buy it?
Enter a price (and optionally what it is). The verdict comes from these checks, each shown with its numbers:

1. **Do you have the money today?**
2. **Are bills still covered until your next income?** Looks at bills and everyday spending up to your next expected income (or the next two weeks if none is recorded within three weeks).
3. **Do the next 30 days still work?** Needs to leave at least about a week of normal costs as a cushion.
4. **Is your savings target safe?** (only if you set one)
5. **Is it a big purchase for you?** Flags anything over about 40% of a typical month's income.

| Verdict | Meaning |
| --- | --- |
| **Yes** | Every check passes. |
| **Yes, but tight** | Nothing fails, but something is flagged (little slack, savings target, big purchase). |
| **Wait** | It fails today, but there is a day in the next two months when it fits — the date is shown. |
| **Not now** | It doesn't fit now or soon. Shows how much more you'd need and how many hours of work that is. |

It also shows the price as hours of work at your recent hourly rate, as a share of a typical month's income, and as days of everyday spending.

## Wishlist
Add anything you checked to the wishlist. Each item is re-checked every time the page opens, so you can see when it turns from "Not now" to "Yes". **I bought it** records the expense (dated today) and ticks it off.

## Savings goal planner
"I want to save $X by a date" → the amount per week, whether your usual weekly surplus (average income minus average spending) covers it, and if not, how many extra hours of work a week or how much less spending would.

## Also on the page
- **Heads up** notes: days when money is on course to run short, expected income that is past its date, and this month's income gap.
- **The next 7 days**: bills going out, income expected, jobs booked.
- **How much more do I need to work?** This month's shortfall turned into hours at your usual rate.
- **Where is my money going?** Top categories this month against last month.

## Accuracy
The answers are only as good as the records: income you expect but haven't entered isn't counted, and one-off costs you haven't recorded aren't either. Your hourly rate is taken from completed jobs with both pay and hours in the last 90 days.

## API
`GET /api/assistant/overview` · `PUT /api/assistant/balance {amount}` · `POST /api/assistant/afford {amount, name?}` · `POST /api/assistant/goal {target, byDate, alreadySaved?}` · `GET|POST /api/assistant/wishlist` · `DELETE /api/assistant/wishlist/:id` · `POST /api/assistant/wishlist/:id/buy`
