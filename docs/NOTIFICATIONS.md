# Email and phone reminders

Reminders always appear in the bell menu inside the app. You can also get them by **email** and as **notifications on your phone or computer**. Both are free.

The server checks every 10 minutes while it is running. If the app is switched off (or a free host has put it to sleep), reminders wait until it is running again.

## Phone & computer notifications (no setup on the server)

1. Open the app **on the device** you want reminders on.
2. Go to **Settings → Notifications → Turn on for this device** and allow notifications when the browser asks.
3. Click **Send a test**.

Notes:
- **Android / Windows / Mac:** works in Chrome, Edge and Firefox.
- **iPhone / iPad:** Apple only allows this for apps on the Home Screen. In Safari tap **Share → Add to Home Screen**, open the app from the new icon, then do the steps above.
- Notifications need a secure address: `http://localhost` on your own computer, or `https://…` once the app is online. A plain `http://192.168.x.x` address on your phone will not work.
- Each reminder is sent once, between 7am and 9pm your time. A bill reminds you again as it gets closer ("in 3 days", "tomorrow", "today").
- The keys used for sending are created automatically and kept in your database. (Optional: set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env` to use your own.)

## Daily email summary (needs an email account for sending)

The app sends email through any SMTP account. The easiest free option is a Gmail **app password**:

1. Turn on 2-Step Verification for your Google account (https://myaccount.google.com/security).
2. Go to https://myaccount.google.com/apppasswords, create an app password called `Personal Tracker`, and copy the 16 characters.
3. Add to `.env` (never share these or commit them):

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youraddress@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM="Personal Tracker <youraddress@gmail.com>"
```

4. Restart the app, then go to **Settings → Notifications**, switch on **Email me a daily summary**, pick the time, and click **Send a test email**.

The email goes to the address on your account (Settings → Account). It is sent once a day at the hour you choose, and only when there is something to report. The same SMTP settings also make "Forgot password" emails work.

Other free SMTP options: Brevo (300 emails/day), Outlook/Hotmail (`smtp-mail.outlook.com`, port 587).

## What you get reminded about

Chosen in **Settings → Notifications**: upcoming bills (and how many days ahead), overdue and due-soon invoices, jobs today and tomorrow, budget / income / savings alerts, and high-priority tasks for today.

## In-app notifications

These need no setup and work on every device.

- **Bell** (top right) shows a red number for notifications you haven't opened yet. On a phone it slides up from the bottom; elsewhere it's a dropdown.
- Tap one to open the related page — it's then marked as read. **×** dismisses it. **Mark all read** clears the number.
- **Notifications page** (bell → See all, or avatar menu → Notifications): everything current, with All / New filter and Clear all.
- **Pop-ups:** when something new comes up while the app is open, a small card appears at the top for a few seconds. When you first open the app you get one summary of what's new. Turn pop-ups off in Settings → Notifications.
- Read and dismissed state is saved to your account, so it's the same on your phone and computer.
- A dismissed notification comes back only when it changes stage — e.g. a bill going from "due in 3 days" to "due tomorrow".
- The installed app's icon shows the unread count on devices that support icon badges.

API: `GET /api/alerts` → `{ items, unread }`; `POST /api/alerts/read|unread|dismiss` with `{ keys: [...] }` or `{ all: true }`.
