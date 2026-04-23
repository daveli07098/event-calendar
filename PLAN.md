# Event Calendar — Project Plan

## Overview

A Google Calendar-like web app with multiple calendar support and Google Calendar import. Hosted on Vercel + Supabase for zero-cost deployment.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14+ |
| Language | TypeScript | 5.x |
| UI Components | shadcn/ui + Radix UI | latest |
| Styling | Tailwind CSS | 3.x |
| Calendar UI | FullCalendar | 6.x |
| ORM | Prisma | 5.x |
| Database | PostgreSQL (Supabase) | 15 |
| Auth | NextAuth.js (Auth.js v5) | 5.x |
| Google API | Google Calendar API v3 | — |
| Hosting | Vercel (frontend + API) | — |
| DB Hosting | Supabase (Postgres) | — |

---

## Data Model

```
User
├── id            UUID PK
├── email         String UNIQUE
├── name          String?
├── image         String?
├── accounts[]    → NextAuth managed (stores Google OAuth tokens)
├── sessions[]    → NextAuth managed
├── calendars[]   → Calendar[]
└── createdAt     DateTime

Calendar
├── id              UUID PK
├── userId          UUID FK → User
├── name            String        (e.g. "Work", "Personal")
├── color           String        (hex, e.g. "#4285f4")
├── isDefault       Boolean       (one per user)
├── isVisible       Boolean       (toggle on/off in sidebar)
├── googleCalendarId String?      (null = local calendar)
├── events[]        → Event[]
├── createdAt       DateTime
└── updatedAt       DateTime

Event
├── id              UUID PK
├── calendarId      UUID FK → Calendar
├── title           String
├── description     String?
├── location        String?
├── startTime       DateTime
├── endTime         DateTime
├── allDay          Boolean
├── recurrenceRule  String?       (RRULE, RFC 5545)
├── googleEventId   String?       (null = local event)
├── createdAt       DateTime
└── updatedAt       DateTime
```

---

## Project Structure

```
event-calendar/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout (auth provider, sidebar)
│   │   ├── page.tsx                      # Main calendar page (server component)
│   │   ├── login/
│   │   │   └── page.tsx                  # Login page
│   │   ├── settings/
│   │   │   └── page.tsx                  # Manage calendars, Google connection
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       │   └── route.ts             # NextAuth handler
│   │       ├── calendars/
│   │       │   ├── route.ts             # GET (list) / POST (create)
│   │       │   └── [id]/
│   │       │       └── route.ts         # GET / PUT / DELETE single calendar
│   │       ├── events/
│   │       │   ├── route.ts             # GET (by date range) / POST (create)
│   │       │   └── [id]/
│   │       │       └── route.ts         # GET / PUT / DELETE single event
│   │       └── google/
│   │           └── sync/
│   │               └── route.ts         # POST: import Google Calendar events
│   ├── components/
│   │   ├── calendar/
│   │   │   ├── CalendarView.tsx         # FullCalendar wrapper (client)
│   │   │   ├── CalendarSidebar.tsx      # Calendar list + visibility toggle
│   │   │   ├── MiniCalendar.tsx         # Small month picker in sidebar
│   │   │   └── CalendarHeader.tsx       # View switcher (day/week/month)
│   │   ├── events/
│   │   │   ├── EventModal.tsx           # Create / edit event dialog
│   │   │   ├── EventPopover.tsx         # Quick preview on click
│   │   │   └── EventForm.tsx            # Form fields (reusable)
│   │   ├── settings/
│   │   │   ├── CalendarManager.tsx      # Add/edit/delete calendars
│   │   │   └── GoogleImportButton.tsx   # Connect & import Google calendars
│   │   └── ui/                          # shadcn/ui components (auto-generated)
│   ├── lib/
│   │   ├── prisma.ts                    # Prisma client singleton
│   │   ├── auth.ts                      # NextAuth config (Google provider)
│   │   ├── google-calendar.ts           # Google Calendar API helpers
│   │   └── utils.ts                     # Date helpers, color utils
│   └── types/
│       └── index.ts                     # Shared TypeScript types
├── public/
│   └── favicon.ico
├── .env.local                           # Secrets (not committed)
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
└── README.md
```

---

## Feature Breakdown

### Phase 1 — Core (MVP)

| # | Feature | Details |
|---|---|---|
| 1.1 | **Project setup** | Next.js + TypeScript + Tailwind + shadcn/ui + Prisma + Supabase |
| 1.2 | **Auth** | Google OAuth via NextAuth; login/logout; session management |
| 1.3 | **Calendar CRUD** | Create/rename/delete calendars; pick color; set default |
| 1.4 | **Event CRUD** | Create/edit/delete events via modal; title, time, description, location |
| 1.5 | **Calendar views** | Month / Week / Day views via FullCalendar |
| 1.6 | **Sidebar** | Calendar list with color dots; toggle visibility; mini month picker |
| 1.7 | **Multi-calendar** | Events colored by calendar; filter by visible calendars |
| 1.8 | **Drag & drop** | Move events by dragging; resize to change duration |

### Phase 2 — Google Integration

| # | Feature | Details |
|---|---|---|
| 2.1 | **Google Calendar import** | OAuth2 → list Google calendars → select which to import |
| 2.2 | **Event sync** | Fetch events from Google Calendar API; store with `googleEventId` for dedup |
| 2.3 | **Refresh token** | Store Google refresh token; re-sync on demand |
| 2.4 | **Visual indicator** | Badge/icon on imported calendars to distinguish from local |

### Phase 3 — Polish

| # | Feature | Details |
|---|---|---|
| 3.1 | **Recurring events** | RRULE input (daily/weekly/monthly/yearly); expand on client with `rrule.js` |
| 3.2 | **All-day events** | Rendered as banners at top of day |
| 3.3 | **Quick event** | Click a time slot → inline event creation (like Google Calendar) |
| 3.4 | **Today button** | Jump to current date |
| 3.5 | **Responsive** | Mobile-friendly sidebar collapse; touch-friendly on tablet |
| 3.6 | **Dark mode** | Tailwind dark mode toggle |

### Phase 4 — Future (Out of Scope for Now)

| Feature | Notes |
|---|---|
| Calendar sharing | Share with other users (view/edit permissions) |
| Notifications / reminders | Email or push notifications before events |
| Two-way Google sync | Write back to Google Calendar (not just import) |
| iCal feed export | Publish .ics URL for external subscribers |
| Search | Full-text search across events |
| Timezone support | Per-event timezone; user default timezone |

---

## API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/calendars` | List user's calendars |
| `POST` | `/api/calendars` | Create a new calendar |
| `PUT` | `/api/calendars/[id]` | Update calendar (name, color) |
| `DELETE` | `/api/calendars/[id]` | Delete calendar + its events |
| `GET` | `/api/events?start=&end=` | List events in date range |
| `POST` | `/api/events` | Create event |
| `PUT` | `/api/events/[id]` | Update event |
| `DELETE` | `/api/events/[id]` | Delete event |
| `POST` | `/api/google/sync` | Import events from Google Calendar |

---

## Auth Flow

```
User clicks "Sign in with Google"
  → NextAuth redirects to Google OAuth
  → User grants calendar.readonly + profile scopes
  → Google returns auth code
  → NextAuth exchanges for access_token + refresh_token
  → Tokens stored in Account table (Prisma)
  → User redirected to calendar page
  → refresh_token reused later for Google Calendar API calls
```

### Required Google OAuth Scopes

```
openid
email
profile
https://www.googleapis.com/auth/calendar.readonly
```

---

## Environment Variables

```bash
# .env.local

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-32-char-string>

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>

# Supabase PostgreSQL
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
```

---

## Setup Checklist

- [ ] Create Supabase project → get DATABASE_URL
- [ ] Create Google Cloud project → enable Calendar API → create OAuth credentials
- [ ] `npx create-next-app@latest event-calendar --typescript --tailwind --app`
- [ ] Install dependencies (prisma, next-auth, @fullcalendar/*, shadcn/ui)
- [ ] Set up Prisma schema + run migrations
- [ ] Configure NextAuth with Google provider
- [ ] Build Phase 1 features
- [ ] Deploy to Vercel
- [ ] Build Phase 2 (Google import)
- [ ] Build Phase 3 (polish)

---

## Development Commands

```bash
# Install
pnpm install

# Dev server
pnpm dev

# Prisma
pnpm prisma generate        # Generate client
pnpm prisma db push          # Push schema to Supabase
pnpm prisma studio           # Visual DB browser

# Build & deploy
pnpm build
vercel deploy                # Or just git push (auto-deploys)
```
