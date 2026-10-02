# Putting Personal Tracker online with Render (and Docker)

The app ships as one Docker container that serves both the website and the API. Render builds it straight from your GitHub repository using the `Dockerfile` and `render.yaml` in this folder.

> Secrets (database password, Google client secret) are typed into Render's dashboard. They never go in GitHub or in chat.

## What you need
- The code pushed to GitHub (`git push`).
- A free **MongoDB Atlas** database — the same one you use locally is fine.
- A free **Render** account (sign in with GitHub at https://render.com).

## 1. Let Render reach your database
In MongoDB Atlas → **Network Access** → **Add IP address** → **Allow access from anywhere** (`0.0.0.0/0`). Render's free plan has no fixed address, so this is required. Your database is still protected by its username and password.

## 2. Create the service
1. Render dashboard → **New +** → **Blueprint**.
2. Connect your GitHub account and pick the `personal-tracker` repository.
3. Render reads `render.yaml` and asks for the values it can't guess:
   - **MONGODB_URI** — your Atlas connection string (the same value as in your local `.env`).
   - **GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI** — leave empty for now if you haven't set Google up; you can add them later.
   - `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` are generated for you.
4. **Apply**. The first build takes 5–10 minutes. When it says **Live**, open the address shown at the top, e.g. `https://personal-tracker-xxxx.onrender.com`.

Every later `git push` redeploys automatically.

## 3. After it's live
- **Your account**: if Render uses the same Atlas database as your computer, log in with the same email and password. Otherwise create a new account.
- **Install on your phone**: open the address on your phone and use **Install** (Android) or **Share → Add to Home Screen** (iPhone). Then turn on notifications in Settings → Notifications.
- **Google Calendar & Drive**:
  1. In Google Cloud → Credentials → your OAuth client → **Authorised redirect URIs**, add `https://YOUR-APP.onrender.com/api/integrations/google/callback` (keep the localhost one too).
  2. In Render → your service → **Environment**, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to that same https address. Save (Render redeploys).
  3. In the app: Settings → Integrations → **Connect Google**. (A connection made on your computer doesn't carry over — connect again here.)

## What the free plan can't do
| Limit | What it means for you |
| --- | --- |
| Sleeps after 15 minutes without visitors | The first visit after a pause takes about a minute to wake up. |
| No reminders while asleep | Phone notifications and the calendar check only run while the app is awake. Recurring income is still caught up whenever you open the app. |
| Files are wiped on every restart or sleep | Uploaded receipts/documents are deleted from Render's disk. **Turn on Google Drive** (Settings → Integrations): each upload is copied to Drive, and the app fetches it back from Drive automatically when the local copy is gone. Without Drive, receipt images are lost (the expense records themselves are safe in the database). |
| Email ports are blocked | The daily email summary can't be sent from the free plan. In-app and phone notifications are unaffected. |
| 750 free hours a month | Enough for one always-available service. |

Render's paid **Starter** plan removes all of these: no sleeping, email works, and you can attach a disk — set `UPLOAD_DIR` to the disk's mount path (e.g. `/data/uploads`). To switch, change `plan: free` to `plan: starter` in `render.yaml`. Check Render's pricing page for the current cost.

## Running it with Docker on your own computer
You only need this if you want to run the packaged version locally; `npm run dev` is still the easy way while developing.

```powershell
docker compose up --build
```

Then open http://localhost:4000. This starts the app plus its own MongoDB container, using the other settings from your `.env`. Data is kept in Docker volumes between runs. To use your Atlas database instead, delete the `MONGODB_URI` line in `docker-compose.yml`.

Just the app image, without compose:

```powershell
docker build -t personal-tracker .
docker run -p 4000:4000 --env-file .env -e NODE_ENV=production -e COOKIE_SECURE=false -e CLIENT_URL=http://localhost:4000 personal-tracker
```

## If something goes wrong
| Symptom | Fix |
| --- | --- |
| Deploy fails with `MONGODB_URI is required` | Add it under **Environment** in Render. |
| Logs show `MongoServerSelectionError` / timeout | Atlas Network Access doesn't allow Render — see step 1. Also check the password in the connection string. |
| Page loads but you can't stay logged in | Make sure you're on the `https://` address. |
| Google says `redirect_uri_mismatch` | The address in Google Cloud and `GOOGLE_REDIRECT_URI` must match exactly. |
| "This file is no longer stored on the server" | The file was uploaded while Drive was off and Render has since restarted. Upload it again with Drive turned on. |
