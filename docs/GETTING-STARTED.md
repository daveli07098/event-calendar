# Getting Started

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@latest`)
- **PostgreSQL** 15+ (or use Docker — see below)
- **Google Cloud** project with OAuth 2.0 credentials and Calendar API enabled

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
