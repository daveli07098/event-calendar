# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

_No unreleased changes._

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

