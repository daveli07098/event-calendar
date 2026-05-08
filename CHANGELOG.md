# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2026-05-09] — Session: Related Events + Quota Persistence + Scraper Fixes
### Fixed
- fix(scrape): `ReferenceError: name is not defined` in AI provider catch block — `name` was destructured inside `try` and not accessible in `catch`; fixed with `let currentProviderName` declared before try ([ab9fc90])
- fix(diff): missing `/**` comment opener caused ECMAScript parse error in diff/route.ts ([d75c0a1])
- fix(tickets): AI quota now DB-persisted (`aiQuotaDate`/`aiQuotaCount` on User); survives dev hot-reloads and server restarts ([d75c0a1])
- fix(scrape): JSON-LD location as plain string now used directly as venue (fixes empty venue on timable multi-night events like IVE) ([d75c0a1])
### Added
- feat(tickets): `GET /api/events/related` endpoint — finds events sharing the same Ticket URL across calendars ([d75c0a1])
- feat(events): EventModal shows "Related Events 相關活動" panel above description when concert ↔ ticket-sale events share a Ticket URL ([d75c0a1])
- feat(events): clicking a related event chip in EventModal switches the modal to that event ([d75c0a1])
### Changed
- feat(tickets): "Extracted by" replaced with a styled badge (blue=AI, grey=og-meta, amber=error) showing exact model name ([ab9fc90])

## [2026-05-02] — Session: Quota + Venue + Diff context
### Fixed
- fix(tickets): quota badge now fetches on mount via GET /api/tickets/scrape; always visible regardless of extractMethod ([cadbf6a])
- fix(tickets): venue field now falls back to data.location for events where AI sets location instead of venue (e.g. ZUTOMAYO) ([cadbf6a])
- fix(tickets): diff context panel now shows stored sale windows (label + date + time) for all ticket events ([cadbf6a])
### Added
- feat(tickets): GET /api/tickets/scrape endpoint returns current AI quota without running a scrape ([cadbf6a])

## [2026-05-02] — Session: Quota
### Changed
- chore(quota): raise AI daily scrape limit from 100 to 250 per user ([eb2d428])

## [2026-04-27] — Session: Ticket Section
### Added
- feat(tickets): AI-powered Ticket Section page for auto-importing event URLs ([b226c5a])
  - `/tickets` page — paste any ticket/event URL; AI extracts title, date, time, venue, description
  - `/api/tickets/scrape` — server-side HTML fetch (SSRF-protected) + AI extraction with 4 provider tiers:
    1. `GEMINI_API_KEY` — Google Gemini 1.5 Flash (free: 1M tokens/day)
    2. `GITHUB_TOKEN` — GitHub Copilot Chat API (OpenAI-compatible proxy)
    3. `GROQ_API_KEY` — Groq / Llama 3 (free tier)
    4. OG/Schema.org + JSON-LD fallback (no key required)
  - `/api/tickets/add` — auto-creates a `ticket-reminders` calendar (orange) on first use, then adds extracted event
  - Sidebar nav updated with Ticket icon → `/tickets` link

## [2026-04-27] — Session: Google sync + account management
### Added
- feat(calendar): per-calendar Google sync button + unlink Google account ([bcf01e7])
  - `POST /api/calendars/[id]/sync` — re-runs full Google Calendar event import for a linked calendar; only owner can trigger; returns count of synced events
  - `GET /api/google/account` — returns 200/404 to tell the UI if Google is linked
  - `DELETE /api/google/account` — unlinks Google OAuth; clears `googleCalendarId` on all user calendars; permanent but reversible via reconnect
  - RefreshCw icon button per Google-linked calendar row in Settings (spins while syncing, shows synced count in alert)
  - GoogleCalendarImport card: persistent "Google Account linked / No Google Account linked" footer with Unlink / Connect buttons; replaces old static text + error-only reconnect button

## [2026-04-27] — Session: ICS export + Google account management
### Added
- feat(calendar): ICS export + Google account reconnect and deduplication ([61872bf])
  - `GET /api/calendars/[id]/export` — RFC 5545 compliant ICS download (works in Google Calendar, Apple Calendar, Outlook)
    - Proper line folding at 75 chars, text escaping, UTC datetimes
    - All-day events use `VALUE=DATE` with exclusive DTEND
    - Auth-gated: owner + members can export
  - FileDown button (per owned calendar in Settings) → instant `.ics` download
  - `allowDangerousEmailAccountLinking: true` on Google provider — prevents duplicate user records when same email is used for credentials + Google OAuth
  - `signIn` callback deduplication — if a Google sign-in would create/use an OAuth-only user but a credentials user with the same email exists, the Google Account is transferred to the credentials user (one canonical identity)
  - "Reconnect Google Account" button appears in Google Calendar Import card when token fetch fails — triggers fresh Google OAuth flow → updates stored tokens

## [2026-04-27] — Session: Event creation animation
### Added
- feat(calendar): spring bounce animation for newly created events ([195bc39])
  - `newEventId` state tracks the just-created event for 2 s
  - `eventClassNames` callback adds `fc-event-new` to the FC event wrapper
  - `@keyframes eventBirth` — spring bounce scale-in with slight rise (cubic-bezier spring curve)
  - `@keyframes eventShine` — white ring expands outward and fades on event appear

---

## [2026-04-26] — Session: Auto-commit rules + feature commits

### Added
- feat(calendar): event reminder toasts + browser notifications (10-min warning + "starting now") with slide animations ([8e0d71c])
- feat(calendar): `EventReminder` component with progress bar and auto-dismiss ([8e0d71c])
- feat(calendars): `/api/calendars/[id]/duplicate` — duplicate a calendar with all its events ([8e0d71c])

### Fixed
- fix(events): `+` in timezone offset parsed as space causing `Invalid Date` in Prisma query ([8e0d71c])
- fix(events): removed duplicate `PUT`/`DELETE` exports in `/api/events/[id]/route.ts` ([8e0d71c])
- fix(share): block collaborative→broadcast downgrade; auto-promote viewers on broadcast→collaborative upgrade ([8e0d71c])

### Changed
- feat(calendar): read-only event modal for broadcast viewers — dimmed form, amber banner, Close-only button ([8e0d71c])
- feat(calendar): `Megaphone` icon for broadcast-owned calendars in sidebar; `Users` for collaborative ([8e0d71c])
- feat(calendar): drag/resize blocked client-side for non-writable calendars ([8e0d71c])
- feat(calendars): Duplicate button in settings "My Calendars" section ([8e0d71c])
- fix(share-dialog): layout overhaul — separate header/body sections, `pr-12` to avoid close-button overlap, `max-h-[70vh]` scroll ([8e0d71c])

### Added (previous entries)
- feat(calendars): `/api/calendars/[id]/share` — generate share links with view/collaborative modes ([b1fdb74])
- feat(calendars): `ShareCalendarDialog` — UI for generating and copying share links; share action in sidebar context menu ([b1fdb74])
- feat(events): Event edit/delete in `EventModal`; CalendarView and settings improvements ([7aa72ec])

### Maintenance
- chore(instructions): Make auto-commit mechanical — file edited or logical unit complete = commit, remove "more work coming" loophole ([39689ef])
- chore(instructions): Restructure CHANGELOG to use dated session blocks with commit SHAs ([aa563c1])
- chore(instructions): Fix stale tech stack reference and clarify auto-commit trigger ([308fbfc], [c8b8aa3])

---

## [2026-04-26] — Session: Agent instructions + build fixes

### Fixed
- fix(events): Remove duplicate `POST` export in `/api/events/route.ts` — caused Turbopack build error "name POST is defined multiple times" ([72f7cc9])
- fix(auth): Stale-session safeguard in `page.tsx` — auto signs out + redirects to `/login` when JWT user ID no longer exists in DB (e.g. after a DB reset) ([72f7cc9])

### Maintenance
- chore(instructions): Update `.github/copilot-instructions.md` — fix stale tech stack (PostgreSQL, custom calendar UI instead of SQLite/FullCalendar); clarify auto-commit rule ([308fbfc])
- chore(instructions): Change commit trigger from session-end to feature/fix completion — event-driven, not time-driven ([c8b8aa3])

---

## [2026-04-25] — Session: PostgreSQL migration + calendar features

### Added
- feat(db): Switch to PostgreSQL via `@prisma/adapter-pg`; `prisma.ts` uses `PrismaPg` driver adapter ([72f7cc9])
- feat(db): Prisma migration `20260425172814_add_user_theme_settings` — theme/appearance columns on User model ([72f7cc9])
- feat(calendars): Calendar sharing — `ShareCalendarDialog`, `/api/calendars/[id]/share`, `/api/calendars/[id]/members` routes; `CalendarMember` model; view/collaborative share modes ([72f7cc9])
- feat(calendars): ICS import — `/api/ics/import` route; `ICSImport` settings component ([72f7cc9])
- feat(calendars): `/api/join/[token]` route and `/join/[token]` page for calendar share invite acceptance ([72f7cc9])
- feat(events): `accessibleCalendarIds` helper — GET /api/events returns owned + shared calendar events; POST guards write access via `canWriteToCalendar` ([72f7cc9])
- feat(events): Day detail panel (`DayDetailPanel`) — click a day cell to see a filtered event list ([72f7cc9])
- feat(settings): `/api/user/settings` route for persisting user preferences to DB ([72f7cc9])
- feat(auth): Default "My Calendar" auto-created on `createUser` event (Google OAuth) and on `/api/auth/register` ([72f7cc9])
- feat(appearance): Calendar theme — dark/light/system mode, 6 accent colours, 4 border-radius presets, comfortable/compact density; persisted to localStorage ([6283225])
- feat(google): Post-login Google Calendar sync flow — prompt → multi-select calendar picker → bulk import → results; `/google/connect` page; `/api/google/sync/bulk` route ([9ba46ab])
- feat(auth): Email/password registration and login with bcryptjs; Credentials provider in NextAuth v5; JWT session strategy; `/register` page ([b83db1c])
- feat(testing): Vitest test suite — 49 tests across 7 suites (API routes, lib, components) ([a08ac86])
- feat(infra): Docker multi-stage build, `docker-compose.yml` with PostgreSQL service, `.dockerignore` ([a2d6eaa])

### Fixed
- fix(infra): Prisma env loading and middleware renamed to `proxy.ts` to avoid Next.js middleware conflicts ([710c202])

### Documentation
- docs: Rewrite getting-started guide; add `dev.sh` quickstart script ([5a297a1])

### Changed
- refactor(auth): NextAuth switched from database to JWT session strategy (required for Credentials provider); Google login redirects to `/google/connect` for new users ([b83db1c])

---

## [2026-04-24] — Session: Agent bootstrap

### Maintenance
- chore: Bootstrap Copilot agent files with session-wrap changelog workflow ([30d2bce])
- chore: VS Code settings — enable/configure Copilot sidecar ([54255ca], [d172a80])

