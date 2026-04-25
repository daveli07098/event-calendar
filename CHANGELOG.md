# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- feat(db): Switch to PostgreSQL via `@prisma/adapter-pg`; `prisma.ts` uses `PrismaPg` driver adapter; `DATABASE_URL` points to postgres
- feat(db): Prisma migration `20260425172814_add_user_theme_settings` — adds theme/appearance columns to User model
- feat(calendars): Calendar sharing — `ShareCalendarDialog`, `/api/calendars/[id]/share`, `/api/calendars/[id]/members` routes; `CalendarMember` model; share modes (view/collaborative)
- feat(calendars): ICS import — `/api/ics/import` route; `ICSImport` settings component
- feat(calendars): `/api/join` route and `/join` page for accepting calendar share invites
- feat(events): `accessibleCalendarIds` helper — events GET returns owned + shared calendars; POST guards write access via `canWriteToCalendar`
- feat(events): Day detail panel (`DayDetailPanel`) — click a day cell to see events for that day
- feat(settings): `/api/user/settings` route for persisting user preferences
- feat(auth): Default calendar auto-created on `createUser` event (Google sign-in) and on `/api/auth/register`
- fix(events): Remove duplicate `POST` export in `/api/events/route.ts` (caused build error)
- fix(auth): Stale-session safeguard in `page.tsx` — auto signs out when JWT user no longer exists in DB; imports `signOut` from auth

### Changed
- refactor(infra): Docker multi-stage build, docker-compose with PostgreSQL, .dockerignore
- docs: Getting-started guide covering local dev, Docker, and Google OAuth setup
- feat(testing): Vitest test suite — 49 tests across 7 suites (API routes, lib, components)
- feat(auth): Email/password registration and login with bcryptjs; Credentials provider in NextAuth v5;  JWT session strategy; `/register` page
- feat(google): Post-login Google Calendar sync flow — prompt → multi-select calendar picker → bulk sync → results; `/google/connect` page; `/api/google/sync/bulk` route; Checkbox component
- feat(appearance): Calendar theme settings — dark/light/system mode, 6 accent colours, 4 border-radius presets, comfortable/compact density; persisted to localStorage; no DB required

### Changed
- refactor(auth): NextAuth switched from database to JWT session strategy (required for Credentials provider); Google login now redirects to `/google/connect` for new users
- refactor(middleware): Added `/google/:path*` to auth-protected matcher so `/google/connect` requires login

### Maintenance
- chore(schema): Added `password String?` field to User model (run `pnpm db:push` to apply)

