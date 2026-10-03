# Connecting Google Calendar & Google Drive

This takes about 10 minutes and costs nothing. You do it once. After that, you connect your Google account from **Settings → Integrations** in the app.

> Never share your Client Secret in chat or commit it to GitHub. It only goes in your `.env` file, which is already git-ignored.

## 1. Create a Google Cloud project
1. Go to **https://console.cloud.google.com/** and sign in with the Google account you want to use.
2. Click the project picker (top-left) → **New project** → name it `Personal Tracker` → **Create**. Make sure the new project is selected.

## 2. Turn on the two APIs
1. Go to **APIs & Services → Library**.
2. Search **Google Calendar API** → **Enable**.
3. Go back, search **Google Drive API** → **Enable**.
4. Optional, for emails (password reset, daily summary): search **Gmail API** → **Enable**.

## 3. Set up the consent screen
1. Go to **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth Platform → Branding / Audience / Data access**).
2. **User type: External** → fill in:
   - App name: `Personal Tracker`
   - User support email and developer contact: your email
3. **Scopes / Data access → Add or remove scopes** and add:
   - `.../auth/calendar.events` (see, edit, create and delete events)
   - `.../auth/drive.file` (only files created by this app)
   - `openid` and `.../auth/userinfo.email`
   - `.../auth/gmail.send` (send email on your behalf — optional; the app can never read your mail)
4. **Test users / Audience**: add your own Gmail address.
5. **Important — avoid weekly sign-outs.** While the app is in *Testing*, Google expires its access after 7 days. For personal use, click **Publish app** (Audience → *In production*). You don't need Google verification for your own use. When you connect, Google shows *"Google hasn't verified this app"*: click **Advanced → Go to Personal Tracker (unsafe)**. That's expected, because you are the developer.

## 4. Create the OAuth client
1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Personal Tracker web`.
3. **Authorised redirect URIs → Add URI**:
   - Local: `http://localhost:4000/api/integrations/google/callback`
   - Online, later: `https://YOUR-APP.onrender.com/api/integrations/google/callback`
4. **Create** → copy the **Client ID** and **Client secret**.

## 5. Add them to `.env`
Open `personal tracker\.env` and set:

```dotenv
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:4000/api/integrations/google/callback
```

Restart the app: press `Ctrl+C`, then run `npm run dev`.

## 6. Connect in the app
1. **Settings → Integrations → Connect Google**.
2. Choose your account and **tick every box** (Calendar, Drive and "Send email on your behalf") on Google's screen.
3. You come back to the app with "Google connected".
4. **Google Calendar**: switch on *Sync automatically*, choose what to sync, then **Sync now** to add existing upcoming items.
5. **Google Drive**: switch on *Use Google Drive*, then **Create folders**. This makes:
   ```
   Personal Finance/
     Invoices/2026/January … December
     Receipts/2026
     Financial Documents
   ```

## How it behaves
- **Calendar**: jobs, appointments, events, tasks, bills (as repeating all-day events with a reminder) and invoice due dates, depending on what you tick. Each record has exactly one event. Editing a job updates its event, and cancelling or deleting it removes the event. If you delete an event in Google, the next change re-creates it. *Remove synced events* deletes everything the app added.
- **Paste & Import**: the *Add to Google Calendar* switch lets you keep a particular import out of your calendar.
- **Drive**: invoice PDFs upload when an invoice is **sent or paid**. Drafts stay local. Editing an invoice replaces the same Drive file with a new version, so you never get duplicates. Receipts and documents upload when you add them. Each invoice and document shows **Open in Google Drive**.
- **Privacy**: the app can only see Drive files and folders it created itself. Your Google access token is encrypted in the database and never sent to the browser.
- **Disconnect** (Settings) revokes access. Events and files already in Google stay where they are.

## Troubleshooting
| Message | Fix |
|---|---|
| *Not set up on the server yet* | The three `GOOGLE_*` values are missing from `.env`, or the app wasn't restarted. |
| `redirect_uri_mismatch` on Google's page | The redirect URI in Google Cloud must match `GOOGLE_REDIRECT_URI` **exactly**, including `http`, port `4000` and no trailing slash. |
| *Access blocked: app has not completed verification* | Add your email under **Test users**, or **Publish app** (step 3.5). |
| *Reconnect needed* after about a week | The app is still in *Testing*. Publish it (step 3.5), then **Reconnect**. |
| *Calendar permission wasn't granted* | You unticked a box on Google's screen. Click **Reconnect** and tick both. |
| *Google did not return offline access* | Remove the app at https://myaccount.google.com/permissions, then connect again. |

If you change `JWT_SECRET` (or set `TOKEN_ENCRYPTION_KEY`), the stored Google token can no longer be read. Just click **Reconnect**.

## Sending email from your Google account
If you allow **Send email on your behalf** when connecting, the app sends its emails (password-reset links, the daily summary, test emails) from your own Gmail address through Google's web API. No SMTP settings or app password are needed, and it works on hosts that block mail ports, such as Render's free plan.

- Needs the **Gmail API** enabled (step 2.4) and the `gmail.send` scope on the consent screen (step 3.3).
- If you connected before this was added: Settings → Integrations → **Reconnect** and tick the new box.
- The permission only allows sending. The app cannot read, search or delete your mail.
- A password-reset email is sent through the Google connection of the account being reset, so it works while signed out. If that account has no Google connection and there are no SMTP settings, the link is printed in the server log instead.

## Sign in with Google
Once the three `GOOGLE_*` values are set, the login and sign-up pages show **Continue with Google**. Nothing extra is needed in Google Cloud: it uses the same OAuth client and the same redirect address.

- It only asks Google who you are (name and email). It does not connect Calendar, Drive or Gmail; that is still done under Settings → Integrations.
- The first time, an account is created for that Google email. If an account with the same email already exists (for example one you made with a password), you are signed in to that account and keep all its data.
- Accounts created this way have no password. You can add one under Settings → Account → **Set a password** if you also want to log in with email and password.
- Google must report the email as verified, and the sign-in has to finish in the same browser that started it.

## Your Google Calendar inside the app
Once Google is connected (Settings → Integrations → Connect Google — signing in with Google is not enough on its own):

- **Your existing Google events appear in the app.** The Calendar page and My Day show the events from your main Google calendar in their own colour, next to your jobs, tasks and bills. They are read live each time and never copied into the app. Tap one in My Day to open it in Google Calendar, which is where you edit or delete it. Switch this off with *Show my Google Calendar events in the app* under Integrations.
- **Create events from the app.** Calendar → **Add event** (or add/edit a task in My Day) has an **Add to Google Calendar** switch. With it on, the event is created in Google too and stays in step when you edit or delete it here. This works even if "Sync to Google Calendar" is off or that category isn't ticked under "What to sync".
- Only your main calendar is read. Other calendars in your Google account (shared, holidays, birthdays) are not shown, because the app only asks Google for permission to manage events, not to list all your calendars.
