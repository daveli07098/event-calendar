# Deployment Guide

## Step-by-step: Vercel + Supabase (Recommended)

### Step 1 — Supabase: Create a project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Pick a name, set a strong DB password (save it), choose region closest to you (e.g. `ap-southeast-1` for HK)
3. Wait ~2 min for provisioning

### Step 2 — Supabase: Get connection strings

Go to **Project Settings → Database → Connection string**

Copy both:

| Mode | Port | Use for |
|---|---|---|
| **Transaction** (Session pooler) | 6543 | Prisma runtime (`DATABASE_URL`) |
| **Direct connection** | 5432 | `prisma migrate deploy` (`DIRECT_URL`) |

They look like:
```
postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

### Step 3 — Update `prisma/schema.prisma`

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### Step 4 — Run migrations against production DB

```bash
DIRECT_URL="postgresql://postgres.xxxx:PASSWORD@....:5432/postgres" \
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@....:6543/postgres?pgbouncer=true" \
pnpm prisma migrate deploy
```

### Step 5 — Vercel: Import the project

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import from GitHub
2. Select this repo
3. Framework preset: **Next.js** (auto-detected)
4. Do **not** deploy yet — add env vars first

### Step 6 — Vercel: Add environment variables

In Vercel project → **Settings → Environment Variables**, add:

| Variable | Value | Where to get |
|---|---|---|
| `DATABASE_URL` | Transaction pooler URL + `?pgbouncer=true` | Supabase → Settings → Database |
| `DIRECT_URL` | Direct connection URL (port 5432) | Supabase → Settings → Database |
| `AUTH_SECRET` | Run `openssl rand -base64 32` locally | Terminal |
| `AUTH_URL` | `https://your-project.vercel.app` | After first deploy, update this |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console | See below |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | See below |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Google AI Studio |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | Optional |

### Step 7 — Google OAuth: add production redirect URI

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click your OAuth 2.0 client
3. Under **Authorised redirect URIs**, add:
   ```
   https://your-project.vercel.app/api/auth/callback/google
   ```
4. Save

### Step 8 — Deploy

Click **Deploy** in Vercel (or push to `main` if you connected the branch).

After first deploy, update `AUTH_URL` in Vercel env vars to your actual domain, then redeploy.

### Step 9 — Verify

- Visit `https://your-project.vercel.app` → login should work
- Try creating an event → DB write works
- Try the ticket scanner → Gemini AI should respond

---

## Hosting Options Comparison

### 1. Vercel + Neon

| Part | Service |
|---|---|
| Next.js app | [Vercel](https://vercel.com) |
| PostgreSQL | [Neon](https://neon.tech) |

**Pros:** One-click Neon integration from Vercel marketplace, `@prisma/adapter-pg` already compatible.

**Cons:** Neon free tier auto-suspends after 5 min inactivity (cold start ~1 s on first query).

**Quick setup:** Vercel → Integrations → Neon → Connect → injects `DATABASE_URL` automatically.

---

### 2. Vercel + Supabase

| Part | Service |
|---|---|
| Next.js app | [Vercel](https://vercel.com) |
| PostgreSQL | [Supabase](https://supabase.com) |

**Pros:** Never suspends, 500 MB free, great dashboard.

**Cons:** Requires two connection URLs for Prisma + pooling (see steps above).

---

### 3. Railway (all-in-one)

| Part | Service |
|---|---|
| Next.js app | [Railway](https://railway.app) |
| PostgreSQL | Railway Postgres plugin |

**Pros:** Single dashboard, no cold starts, `$5/month` credit usually enough for personal use.

**Quick setup:** New project → Deploy from GitHub → Add Postgres plugin → env vars auto-injected.

---

### 4. Fly.io + Supabase

**Pros:** Most control, global edge, Supabase DB never suspends.

**Cons:** More setup (Dockerfile, `fly.toml`), steeper learning curve.

---

## Required Environment Variables (full list)

```env
# Auth
AUTH_SECRET=          # openssl rand -base64 32
AUTH_URL=             # https://your-domain.com

# Database
DATABASE_URL=         # pooler URL (port 6543) — runtime queries
DIRECT_URL=           # direct URL (port 5432) — migrations only

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# AI providers
GEMINI_API_KEY=       # https://aistudio.google.com/apikey
GROQ_API_KEY=         # optional — https://console.groq.com
GITHUB_TOKEN=         # optional — Copilot cascade fallback
```

---

## CI/CD

### Option A — Local deploy script (recommended for public repos)

Create `deploy.sh` and add to `.gitignore`:

```bash
#!/usr/bin/env bash
set -euo pipefail
pnpm build
vercel deploy --prod
```

```bash
chmod +x deploy.sh
bash deploy.sh
```

**Why:** No secrets ever touch GitHub. Safe for public repos.

---

### Option B — GitHub Actions (auto-deploy on push to main)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    if: github.repository_owner == 'YOUR_GITHUB_USERNAME'  # blocks forks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
          AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
          AUTH_URL: ${{ secrets.AUTH_URL }}

      - name: Deploy to Vercel
        run: pnpm dlx vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}
```

Add secrets at: GitHub repo → **Settings → Secrets and variables → Actions**

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `DATABASE_URL` | Production pooler URL |
| `DIRECT_URL` | Production direct URL |
| `AUTH_SECRET` | Same as Vercel env var |
| `AUTH_URL` | `https://your-domain.com` |

---

## Database Migrations

Run once manually for initial production setup (Step 4 above).

For subsequent deploys, add to `package.json` to auto-migrate on every build:

```json
"scripts": {
  "postbuild": "prisma migrate deploy"
}
```

> `postbuild` uses `DIRECT_URL` (the direct connection) automatically via `directUrl` in `schema.prisma`.


### 1. Vercel + Neon (Recommended — easiest setup)

| Part | Service | Notes |
|---|---|---|
| Next.js app | [Vercel](https://vercel.com) | Free tier, great DX, automatic preview deployments |
| PostgreSQL | [Neon](https://neon.tech) | Serverless Postgres, Vercel marketplace integration |

**Pros:** One-click Neon integration from Vercel dashboard, `@prisma/adapter-pg` already compatible, automatic SSL.

**Cons:** Neon free tier auto-suspends after 5 min inactivity (cold start ~1 s on first query).

**Setup:**
1. Push repo to GitHub
2. Import project on Vercel
3. Add Neon integration from Vercel marketplace → it injects `DATABASE_URL` automatically
4. Add remaining env vars (see below)
5. `vercel env pull .env.local` to sync locally

---

### 2. Vercel + Supabase

| Part | Service | Notes |
|---|---|---|
| Next.js app | [Vercel](https://vercel.com) | Same as above |
| PostgreSQL | [Supabase](https://supabase.com) | 500 MB free, no auto-suspend, nice dashboard |

**Pros:** Supabase free tier never suspends (unlike Neon), 500 MB storage, built-in auth/storage/realtime if you ever need them, official Vercel integration injects `DATABASE_URL` automatically.

**Cons:** Supabase uses PgBouncer connection pooling by default — Prisma requires the **Transaction pooler** URL (port 6543), not the direct URL, for serverless. Use the **direct connection** (port 5432) only for migrations.

**Setup:**
1. Create project on Supabase → Project Settings → Database → copy connection strings
2. In Vercel: Integrations → Supabase → Connect project (auto-injects `DATABASE_URL`)
3. In `.env.local` / Vercel env vars, set **two** URLs:

```env
# For Prisma runtime queries (Transaction pooler — port 6543)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# For prisma migrate deploy (direct connection — port 5432)
DIRECT_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

4. Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")  // used by prisma migrate only
}
```

> Both URLs are in Supabase → Project Settings → Database → **Connection string** tab. Switch between "Transaction" (port 6543) and "Session" (port 5432) modes.

---

### 3. Railway (Best all-in-one)

| Part | Service | Notes |
|---|---|---|
| Next.js app | [Railway](https://railway.app) | Docker-based, no cold starts |
| PostgreSQL | Railway Postgres plugin | Same project, no cross-service latency |

**Pros:** Single dashboard for app + DB, persistent DB (no suspend), `$5/month` free credit usually covers personal use.

**Setup:**
1. New project → Deploy from GitHub repo
2. Add PostgreSQL plugin → Railway injects `DATABASE_URL`
3. Add env vars in Railway dashboard
4. Railway auto-detects `pnpm build` from `package.json`

---

### 3. Fly.io + Supabase

| Part | Service | Notes |
|---|---|---|
| Next.js app | [Fly.io](https://fly.io) | Docker, full control, global edge |
| PostgreSQL | [Supabase](https://supabase.com) | Generous free tier, nice UI, 500 MB storage |

**Pros:** Most control, Supabase free tier doesn't suspend.

**Cons:** More setup (Dockerfile, `fly.toml`), Supabase uses connection pooling (use `DATABASE_URL` pooler URL for Prisma).

---

## Required Environment Variables

```env
# Auth
AUTH_SECRET=          # generate: openssl rand -base64 32
AUTH_URL=             # https://your-domain.com

# Database
DATABASE_URL=         # postgres://... (injected by Neon/Railway/Supabase)

# Google OAuth (for Google Calendar sync)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# AI providers
GEMINI_API_KEY=       # https://aistudio.google.com/apikey
GROQ_API_KEY=         # https://console.groq.com (optional, cascade fallback)
GITHUB_TOKEN=         # optional, Copilot cascade fallback

# After deploy, update Google OAuth redirect URI:
# https://console.cloud.google.com → APIs → Credentials → your OAuth client
# Add: https://your-domain.com/api/auth/callback/google
```

---

## CI/CD

### Option A — Local deploy script (recommended for personal/public repos)

Create `deploy.sh` (add to `.gitignore`):

```bash
#!/usr/bin/env bash
set -euo pipefail
pnpm build
vercel deploy --prod
```

Run manually when ready: `bash deploy.sh`

**Why:** No secrets in GitHub Actions, no risk from public repo forks.

---

### Option B — GitHub Actions (automatic on push to main)

Safe to use **if you restrict to your account only**.

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    # Blocks forks and other users from triggering this with secrets
    if: github.repository_owner == 'YOUR_GITHUB_USERNAME'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
          # add other build-time vars here

      - name: Deploy to Vercel
        run: pnpm dlx vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}
```

**Add secrets at:** GitHub repo → Settings → Secrets and variables → Actions

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | From vercel.com → Account Settings → Tokens |
| `DATABASE_URL` | Your production DB connection string |
| `AUTH_SECRET` | Same as production |

> **Note:** GitHub blocks secrets from being passed to fork PRs by default. The `if: github.repository_owner` guard adds a second layer of protection.

---

## Database Migrations on Deploy

Add a `postbuild` script in `package.json` to auto-run migrations:

```json
"scripts": {
  "postbuild": "prisma migrate deploy"
}
```

Or run manually before deploying:

```bash
DATABASE_URL=<prod_url> pnpm prisma migrate deploy
```
