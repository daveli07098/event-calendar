# Getting Started

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@latest` |
| OrbStack or Docker Desktop | latest | [orbstack.dev](https://orbstack.dev) |
| Google Cloud project | — | [console.cloud.google.com](https://console.cloud.google.com) |

---

## 1. Clone and configure

```bash
git clone <repo-url> event-calendar
cd event-calendar
```

Copy the env template:

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
AUTH_SECRET=        # run: openssl rand -base64 32
AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=   # from Google Cloud Console (see §3 below)
GOOGLE_CLIENT_SECRET=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/event_calendar
```

> **Note:** `DATABASE_URL` already matches the docker-compose Postgres — no change needed if you use `dev.sh`.

---

## 2. Start with one command

```bash
./dev.sh
```

This script:
1. Runs `pnpm install`
2. Starts the Postgres container (`docker-compose up db -d`)
3. Waits until Postgres is ready
4. Runs `pnpm db:push` (syncs the schema)
5. Starts Next.js dev server → **http://localhost:3000**

> **First run** takes ~30 s to pull the `postgres:17-alpine` image.  
> **Subsequent runs** are instant — the DB container and volume persist.

---

## 3. Google OAuth setup

Google login and Calendar sync require OAuth credentials.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project → **APIs & Services → Credentials**
3. Click your OAuth 2.0 Client ID (or create one: **+ Create Credentials → OAuth client ID → Web application**)
4. Under **Authorised redirect URIs** add:
   ```
   http://localhost:3000/api/auth/callback/google
   ```
5. Copy the **Client ID** and **Client Secret** into your `.env`
6. Enable the **Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable

---

## 4. Useful commands

```bash
# Dev
pnpm dev            # Start Next.js (assumes DB is already up)
pnpm build          # Production build
pnpm start          # Start production server

# Database
pnpm db:push        # Sync Prisma schema → DB (no migration files)
pnpm db:studio      # Open Prisma Studio at http://localhost:5555

# Database container
docker-compose up db -d     # Start Postgres only
docker-compose stop db      # Stop Postgres
docker-compose down -v      # Remove containers + data volume (destructive)

# Tests
pnpm test           # Run all tests once
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report
```

---

## 5. Project structure

```
src/
├── app/
│   ├── page.tsx                  # Calendar page (Server Component)
│   ├── login/                    # Login page
│   ├── register/                 # Register page
│   ├── settings/                 # Settings + appearance
│   ├── google/connect/           # Post-Google-login sync flow
│   └── api/                      # REST API routes (backend)
│       ├── auth/register/        # POST /api/auth/register
│       ├── calendars/            # GET/POST/PUT/DELETE /api/calendars
│       ├── events/               # GET/POST/PUT/DELETE /api/events
│       └── google/sync/          # GET/POST /api/google/sync
├── components/                   # UI components
├── context/ThemeContext.tsx       # Theme (dark/light/accent/density)
├── lib/
│   ├── auth.ts                   # NextAuth v5 config
│   ├── prisma.ts                 # Prisma client
│   ├── google-calendar.ts        # Google Calendar API helpers
│   └── theme.ts                  # Theme constants
└── types/                        # Shared TypeScript types
```


---

## 1. Local Development (without Docker)

### Clone & install

```bash
git clone <repo-url> event-calendar
cd event-calendar
pnpm install
```

### Environment variables

Copy the example and fill in real values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/event_calendar` |
| `AUTH_SECRET` | Random 32-char secret (`openssl rand -base64 32`) |
| `AUTH_URL` | App URL, e.g. `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |

### Database setup

```bash
# Push schema to your PostgreSQL database
pnpm db:push
```

### Run dev server

```bash
pnpm dev
# → http://localhost:3000
```

### Other commands

```bash
pnpm build          # Production build (runs prisma generate + next build)
pnpm start          # Start production server
pnpm lint           # ESLint
pnpm db:studio      # Prisma Studio (DB browser)
```

---

## 2. Docker (single container, BYO database)

```bash
docker build -t event-calendar .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/event_calendar" \
  -e AUTH_SECRET="your-secret" \
  -e AUTH_URL="http://localhost:3000" \
  -e GOOGLE_CLIENT_ID="..." \
  -e GOOGLE_CLIENT_SECRET="..." \
  event-calendar
```

---

## 3. Docker Compose (recommended for local dev)

Spins up the app **and** PostgreSQL together — zero local dependencies required.

```bash
# Copy env file and fill in Google OAuth values
cp .env.example .env

# Start everything
docker compose up -d

# Push the schema to the database (first run only)
docker compose exec app pnpm db:push

# View logs
docker compose logs -f app
```

App is at **http://localhost:3000**, Prisma Studio available via:

```bash
docker compose exec app pnpm db:studio
```

### Tear down

```bash
docker compose down         # Stop containers (data persists in volume)
docker compose down -v      # Stop + delete PostgreSQL data
```

---

## Google OAuth Setup

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Enable the **Google Calendar API** in APIs & Services
5. Copy Client ID and Client Secret to your `.env`
