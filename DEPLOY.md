# Fantasy Cricket — Deployment Guide

## Architecture on Railway

```
Railway Project
├── Backend Service   (Node.js + SQLite)  → fantasy-cricket-api.railway.app
└── Frontend Service  (Vite build + Express static)  → fantasy-cricket.railway.app
```

---

## Step 1 — Push to GitHub

```bash
cd fantasy-cricket
git remote add origin https://github.com/YOUR_USERNAME/fantasy-cricket.git
git push -u origin main
```

---

## Step 2 — Create Railway project

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `fantasy-cricket` repo
4. Railway will detect two services — we'll configure them separately

---

## Step 3 — Deploy the Backend

1. In Railway, click **New Service → GitHub Repo → fantasy-cricket**
2. Set **Root Directory** to `backend`
3. Railway auto-detects Node.js via nixpacks.toml

### Add a Volume (for SQLite persistence)
1. Click your backend service → **Settings → Volumes**
2. Click **Add Volume**
3. Mount path: `/data`
4. This ensures your DB survives redeploys

### Set Environment Variables
In your backend service → **Variables**, add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DB_PATH` | `/data/fantasy.db` |
| `JWT_SECRET` | *(generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)* |
| `JWT_EXPIRES_IN` | `7d` |
| `CRICAPI_KEY` | *(your key from cricketdata.org)* |
| `VAPID_PUBLIC_KEY` | *(from `npx web-push generate-vapid-keys`)* |
| `VAPID_PRIVATE_KEY` | *(from above)* |
| `VAPID_EMAIL` | `mailto:you@email.com` |
| `FRONTEND_URL` | *(your frontend Railway URL — fill after step 4)* |

### Get your Backend URL
After deploy, Railway gives you a URL like:
`https://fantasy-cricket-api-production.up.railway.app`

Test it: `curl https://your-backend.railway.app/health`
Should return: `{"status":"ok","timestamp":"..."}`

---

## Step 4 — Deploy the Frontend

1. In Railway, click **New Service → GitHub Repo → fantasy-cricket**
2. Set **Root Directory** to `frontend`
3. Set **Build Command** to `npm run build`
4. Set **Start Command** to `node server.cjs`

### Set Environment Variables

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://your-backend.railway.app` *(no trailing slash)* |

### Update Backend FRONTEND_URL
Go back to backend service → Variables → update `FRONTEND_URL` to your frontend Railway URL.
Then **redeploy** the backend.

---

## Step 5 — First-time setup (run once)

### Create your admin account
```bash
curl -X POST https://your-backend.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin",
    "email": "admin@youremail.com",
    "password": "yourpassword",
    "inviteCode": "BOOTSTRAP"
  }'
```

> Note: The first registration uses a bootstrap flow — you'll need to temporarily
> create a season manually or use the DB directly. See "Bootstrap Admin" below.

### Bootstrap Admin (easier way)

SSH into Railway or use the Railway shell:
```bash
# In Railway dashboard → your backend service → Shell
node -e "
const { initDb, getDb } = require('./src/db/database');
initDb();
const db = getDb();
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('YOUR_ADMIN_PASSWORD', 10);
const user = db.prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?,?,?,1)')
  .run('Admin', 'admin@youremail.com', hash);
const season = db.prepare(\"INSERT INTO seasons (name, year, status, invite_code, admin_user_id) VALUES (?,?,?,?,?)\")
  .run('IPL 2026', 2026, 'active', 'IPL2026', user.lastInsertRowid);
console.log('Done. Invite code: IPL2026');
"
```

---

## Step 6 — Today's LLC Test Run (Mumbai Spartans vs India Tigers)

### In the Admin Dashboard:

1. **Log in** as admin at your frontend URL
2. Go to **Admin → Auto-Schedule**
3. Click **⚙ Series IDs**
4. Enter the LLC 2026 series ID — find it at:
   `https://cricketdata.org/cricket-data-formats/series`
   Search "Legends League Cricket 2026" and copy the UUID from the URL
5. Click **Save Series IDs**
6. Click **↻ Sync Now**

This will automatically create the Mumbai Spartans vs India Tigers match
with ID `106f2025-7660-4a5f-aa6e-8ab8a3a62124`.

### Or add the match manually (faster for today):
- **CricAPI Match ID:** `106f2025-7660-4a5f-aa6e-8ab8a3a62124`
- **Team A:** Mumbai Spartans
- **Team B:** India Tigers
- **Type:** T20
- **Start Time:** 2026-03-14 19:30 (IST) → `2026-03-14T14:00` (UTC)
- **Entry Units:** 300

### Then:
1. Go to **Match → Set Squad → ↻ Sync from CricAPI**
2. Share invite code with friends: they register and pick teams
3. Watch live scores update every 60 seconds
4. After match: **Admin → Match → Finalise**

---

## Step 7 — IPL 2026 Setup (before March 28)

1. Find IPL 2026 series ID on CricAPI:
   - Go to `https://cricketdata.org/cricket-data-formats/series`
   - Search "Indian Premier League 2026"
   - Copy the UUID from the URL
2. Add it to your season's Series IDs
3. Click **↻ Sync Now** — all 84 IPL matches will be created automatically
4. Squads auto-sync 48 hours before each match

---

## Monitoring & Logs

- Railway dashboard → your service → **Logs** tab
- Key log lines to watch:
  - `[cron:livePoller] Syncing N live match(es)...` — every 60s during matches
  - `[autoSchedule] Done — created:N updated:N squads:N` — every hour
  - `[cron:swapTrigger] Processed swaps for N teams` — at match start
  - `[db] Migration: ...` — one-time on first deploy

---

## Cost

| Service | Cost |
|---|---|
| Railway Hobby plan | $5/month (covers both services + volume) |
| CricAPI S plan | $5.99/month (needed for live match polling) |
| **Total** | **~$11/month** |

Railway free tier (500 hrs/month) is enough for testing before committing.

---

## Railway Login

Railway uses **GitHub OAuth** — no separate username/password. Here's how:

1. Go to https://railway.app
2. Click **Login with GitHub**
3. Authorize Railway to access your GitHub account
4. That's it — your Railway account is your GitHub account

If you haven't pushed to GitHub yet, do that first (Step 1 above).

---

## Seeding Test Data (LLC 2026 Season)

Instead of starting with an empty database, run the seed script to get
a realistic-looking season with 3 completed matches + today's match.

### Locally:
```bash
cd backend
npm install
node scripts/seed.js
```

### On Railway (after deploy):
In Railway dashboard → your backend service → **Shell** tab:
```bash
node scripts/seed.js
```

This creates:
- **Season:** LLC 2026 Test League (invite code: `LLC2026`)
- **3 completed matches** with realistic scores, leaderboards, prizes
- **Today's match:** Mumbai Spartans vs India Tigers (upcoming)
- **5 user accounts** — all password `password123`:
  - `admin@test.com` (admin)
  - `rahul@test.com`
  - `priya@test.com`
  - `karthik@test.com`
  - `sneha@test.com`

To reset and reseed:
```bash
node scripts/seed.js --reset
```

### What the seeded leaderboard looks like:
Players have different team picks across 3 matches so the standings
look organic — some ahead on net units, some on top finishes.
Today's match (Mumbai Spartans vs India Tigers) is upcoming so all
5 users can pick their teams and experience the full flow tonight.

---

## Polling — API Call Budget

The live poller uses a smart 2-call approach:
1. **Cheap check** every 90 seconds: `match_info` (just ball count)
2. **Full sync** only when 3+ new balls: `match_scorecard`

**Per single match:** ~88 calls (fits free tier of 100/day)
**Two matches same day:** ~176 calls (needs S plan at $5.99/mo)

For the LLC test tonight (single match): **free tier is fine**.
For IPL (often 2 matches/day): upgrade to S plan before March 28.
