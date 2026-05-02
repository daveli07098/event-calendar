# Deployment Guide

## Hosting Options

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

### 2. Railway (Best all-in-one)

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
