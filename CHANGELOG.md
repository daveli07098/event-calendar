## [2026-05-12] — Session: DB migration infra for Supabase
### Fixed
- fix(db): `prisma/schema.prisma` datasource now has `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")` — this is the correct way Prisma uses the direct connection for migrations (b5abf15)
- fix(db): `prisma.config.ts` simplified — removed non-functional `datasource.directUrl` override from `defineConfig` (b5abf15)
- fix(db): `prisma.config.ts` now loads `.env.local` before `.env` so Supabase URLs are picked up (cce61ae)

## [2026-05-12] — Session: Event Section + Category Detection UI
### Changed
- feat(events): "Ticket Section" renamed to "Event Section" — page title, header, and sidebar link (1372810)
- feat(events): `/api/events/classify` POST now accepts optional `calendarIds[]` to restrict classification to specific calendars (security-checked against user's accessible set) (1372810)
### Added
- feat(events): "Category Detection" left-nav section added to Event Section — calendar multi-select (sale-ticket excluded, event-reminders pre-selected), only-unclassified toggle, Run Classification button, live result + updated category distribution panel (1372810)

## [2026-05-12] — Session: event categories
### Added
- feat(events): `category` field (`String?`) added to `Event` Prisma model; migration `20260511180724_add_event_category` applied (2e95583)
- feat(types): `EVENT_CATEGORIES`, `EventCategory`, `CATEGORY_LABELS` exported from `src/types/index.ts` (2e95583)
- feat(scrape): AI prompt now extracts `category` during ticket import — Gemini picks one of 11 categories from title/venue cues (2e95583)
- feat(api): `POST /api/events/classify` — AI batch-classifies all (or only unclassified) events in batches of 30 via Gemini (2e95583)
- feat(api): `GET /api/events/classify` — returns category counts and unclassified count (2e95583)
- feat(settings): "Event Categories" card with **Classify Unclassified Events** + **Re-classify All** buttons (2e95583)
- feat(sidebar): category filter chips (Concert, Exhibition, Theatre, Anime, Pop-up …) toggled per-click; active filter highlights in primary colour; "Clear" link resets (2e95583)
- feat(modal): Category dropdown selector in EventModal — persists with event save/edit (2e95583)

## [2026-05-12] — Session: venue image upload
### Added
- feat(venues): Vercel Blob storage for venue images — upload multiple photos per venue, delete individual images (5273ea7)
- feat(venues): `imageUrls String[]` field added to `EventVenue` Prisma model; migration applied (5273ea7)
- feat(venues): `POST /api/venues/[id]/images` — multipart upload, validates type (jpeg/png/webp/gif) + size (≤5 MB), stores under `venues/{id}/{timestamp}-{random}.ext` (5273ea7)
- feat(venues): `DELETE /api/venues/[id]/images` — removes image from Vercel Blob and DB array (5273ea7)
- feat(venues): VenueSection card layout with collapsible image gallery grid and per-image delete (5273ea7)

## [2026-05-12] — Session: sync creates new sale reminders
### Fixed
- feat(sync): `Sync` in EventModal now **creates** new sale-ticket calendar events when the re-scraped page contains a sale window that didn't exist before — previously these were silently skipped (ad753a6)
- feat(sync): existing sale windows with updated dates are still updated in-place (ad753a6)
- feat(sync): after applying a sync, the Related Events panel in the modal refreshes immediately so newly-created sale reminder events appear without reopening (ad753a6)
- feat(sync): a notice is shown when sync created new reminders: "✓ Synced — N new sale reminder(s) created" (ad753a6)

## [2026-05-12] — Session: smarter duplicate detection + merge UX
### Changed
- feat(tickets): duplicate detection window tightened from ±36 h to ±12 h (6b72b76)
- feat(tickets): when AI (Gemini Flash Lite) is available, title similarity is scored 0–1 in a single batch call; only candidates ≥ 0.85 are shown. Without AI, falls back to exact title match (6b72b76)
- feat(tickets): each duplicate candidate is now a checkbox — tick to select merge target; score % shown per candidate (6b72b76)
- feat(tickets): primary action button switches to "Update existing event" when a merge target is selected; event with score ≥ 0.9 is auto-selected on scan (6b72b76)

## [2026-05-12] — Session: multi-day events + duplicate merge
### Added
- feat(calendar): multi-day timed events (endDate > startDate) now display as all-day spanning banners in month/week view — popup stores, opera runs, multi-week exhibitions no longer appear as a single dot on the start day (3e31bfa)
- feat(tickets): "Merge URL" button in duplicate warning — appends the new ticket URL as an additional `Ticket URL:` line in the existing event, and merges any new platforms/prices not already present (3e31bfa)
### Fixed
- feat(modal): EventModal "Ticket Link" section now shows ALL ticket URLs in the description (via `matchAll`) — events merged from multiple sources display all links (3e31bfa)

## [2026-05-12] — Session: AI resilience + duplicate detection
### Fixed
- fix(ai): network-level errors (`UND_ERR_SOCKET`, `fetch failed`, `ECONNREFUSED`, `ETIMEDOUT`) now fall through to the next AI provider in the cascade instead of stopping — Gemini socket drops no longer abort all AI extraction (3670bd8)
### Added
- feat(tickets): scrape route now checks user's calendar for events on the same day with a similar title and returns `duplicateCandidates[]` in the response (3670bd8)
- feat(ui): amber warning banner shown in the ticket review card when a similar event already exists in the calendar (3670bd8)

## [2026-05-11] — Session: HK location enrichment for ticket imports
### Fixed
- feat(location): new imports from HK ticketing domains (timable.com, cityline.com, hkticketing.com, urbtix.hk, etc.) now automatically append ", Hong Kong" to the event location when not already present (8efe466)
- feat(location): PUT /api/events backfills existing ticket-imported events missing "Hong Kong" in location — scans description for "Ticket URL:", checks HK domain, updates location in bulk (8efe466)
- feat(ui): "Fix Locations" button added to Venue Settings section — triggers backfill with one click (8efe466)

## [2026-05-11] — Session: multi-slot sale dedup
### Fixed
- fix(tickets): when adding a multi-slot event, sale-ticket calendar events (presale, priority, public sale) are now created only once — tied to the first slot — instead of once per slot, eliminating duplicate sale reminders (b2c5e56)

## [2026-05-10] — Session: scraper end time + sale date accuracy
### Fixed
- fix(tickets): `extractMeta` now extracts end time from JSON-LD concert event's `endDate` field — single-night shows (e.g. "20:00–22:30") now populate the END TIME field in the form instead of leaving it blank (f31cc05)
- fix(tickets): POST handler sanitizes concert date from all sale-window fields after build — AI hallucinating `saleFirstDate = concert date` is now silently corrected (f31cc05)
- fix(tickets): EXTRACT\_PROMPT significantly strengthened: explicit examples of ALL sale window types (VIP priority, credit card, ticketing-platform, fan club, public sale), strict rule that saleFirstDate must be before performance date, clearer endTime extraction instruction (f31cc05)

## [2026-05-10] — Session: ticket slot end time extraction
### Fixed
- fix(tickets): `extractTextSlots` now parses optional end time from Chinese date-range patterns ("2026年8月6至16日 7:30 PM – 10:10 PM") — end time 22:10 is captured and shown in slot label (3a33c78)
- fix(tickets): multiple time rows for the same date range (matinee 14:30–17:10 + evening 19:30–22:10) are merged into one slot — time = earliest start (14:30), endTime = latest end (22:10) — matches user expectation of "2 slots" for Cats/Timable pages (3a33c78)
- fix(tickets): `buildSlotLabel` now includes `–endTime` in the chip label when present: `Aug 6–16 · 14:30–22:10` (3a33c78)
- fix(tickets): text slot extraction now always runs (not gated on `!dateConfident`) so it can supplement endTimes on JSON-LD-derived slots even when JSON-LD only has the matinee block with location (3a33c78)

## [2026-05-10] — Session: ticket scraper sale windows + platforms
### Fixed
- fix(tickets): Strategy A now uses JSON-LD event `name` as the sale-window label (e.g. "DBS 信用卡預訂") instead of generic positional "Priority Sale" (c071adc)
- fix(tickets): Strategies A (sale-window events) and B (offers.validFrom) are now **merged** instead of one overriding the other — all sale windows appear for pages like Timable football that use both (c071adc)
- fix(tickets): POST merge now unions AI saleDates + meta saleDates instead of AI winning outright; meta labels (from event names) survive when AI only returns a subset (c071adc)
- fix(tickets): Ticket platforms (快達票, Cityline, etc.) are now extracted from JSON-LD offer.seller.name and offer.url, with HTML text-scan fallback — no longer purely AI-dependent (c071adc)
- fix(tickets): "Buy Tickets 立即購票" section renamed to "Platforms 售票平台" and rendered as pill badges (c071adc)

## [2026-05-10] — Session: calendar UX + location tags + venue cleanup
### Added
- feat(calendar): "+N more" link now opens DayDetailPanel instead of FC default popover (19b1e4e)
- feat(events): location region badge (e.g. "Hong Kong") shown in EventModal label and DayDetailPanel event cards, derived from location string (19b1e4e)
- feat(calendar): HK region badge rendered on every event chip across all views — list (listWeek), month grid (dayGridMonth), week/day time grid, and all-day events (f7a1652)
### Fixed
- fix(venues): GET /api/venues now filters out 地點待定 TBD placeholder entries and deduplicates "X, Y" rows where "X" already exists (19b1e4e)
- fix(venues): PUT import skips 地點待定 entries; cleanup deletes existing TBD venues and merges "X, Y" duplicates (19b1e4e)

## [2026-05-10] — Session: event navigation + seating plan propagation
### Changed
- fix(events): clicking a calendar event now opens the DayDetailPanel (day schedule) first instead of jumping straight to the edit modal; user picks the event from the list (ca7b26d)
- fix(events): clicking a related event from the event modal now navigates to that date and opens the event detail modal directly (works across months — fetches via new GET /api/events/:id) (ca7b26d)
### Added
- feat(api): GET /api/events/[id] — fetch a single event by id (ca7b26d)
- feat(events): saving an event with a Seating Plan URL automatically propagates it to all other events that share the same Ticket URL (ca7b26d)

## [2026-05-10] — Session: seating plan + related event navigation
### Added
- feat(modal): Seating Plan 座位圖 section — URL input with live image preview, clickable to open full image in new tab, drag-and-drop URL from browser; stored as `Seating Plan: URL` line in description (e91ed32)
### Fixed
- fix(modal): clicking a Related Event now closes the modal and navigates the calendar to that event's date, opening the DayDetailPanel (day schedule view) first instead of jumping straight into the edit modal; works for out-of-range events (e.g. Oct 21 concert from May sale event) since navigation uses the `startTime` already in the related-event list (e91ed32)

## [2026-05-10] — Session: venue dedup + text-based slot extraction
### Fixed
- fix(venues): import now splits `"Venue Name, Address"` location strings — uses name as key, address as field; no more duplicate rows (4ccb368)
- fix(venues): PUT import runs a cleanup pass that finds existing `"Name, Address"` style venues, updates address on the clean-name entry, and deletes the malformed duplicate (4ccb368)
- fix(scrape): add `extractTextSlots()` — parses Chinese date-range patterns directly from page text when JSON-LD event blocks have no `location` field (e.g. Timable football events); produces correct multi-slot output even without JSON-LD concert blocks (4ccb368)

## [2026-05-10] — Session: date extraction accuracy fix
### Fixed
- fix(scrape): add `dateConfident` flag to MetaFallback — when date came from JSON-LD concert blocks (events with location), prefer it over AI result (which can confuse ticket-sale dates with performance dates) (15b2dbe)
- fix(scrape): AI prompt now has CRITICAL instruction — "date" = performance date, NEVER a sale/presale date (15b2dbe)

## [2026-05-10] — Session: multi-slot classification fix
### Fixed
- fix(scrape): reclassify location-less JSON-LD events within concert date range as slots, not sale windows (4e1d8d8)
- fix(scrape): expand multi-day JSON-LD events (e.g. Jun 13–14 block) into individual nights in `groupIntoSlots` so consecutive-day merging produces correct "Jun 13–14 · 19:30" label (4e1d8d8)
- fix(scrape): remove unused `months` variable in `extractDateFromText` (4e1d8d8)

## [2026-05-10] — Session: venue import from events
### Added
- feat(venues): PUT /api/venues imports venue names from user's existing event locations/descriptions (e98d716)
- feat(venues): "Import" button in VenueSection UI with loading state (e98d716)
### Fixed
- fix(venues): regenerate Prisma client so EventVenue model is available (e98d716)

## [2026-05-10] — Session: multi-slot, venue directory, sync diff
### Added
- feat(tickets): slot picker for multi-night events (f37dd18)
- feat(tickets): Venues sidebar section with add/delete (f37dd18)
- feat(tickets): EventVenue Prisma model + API (f37dd18)
- feat(tickets): EventModal Sync now diffs before applying (f37dd18)
- docs: multi-slot-event-rules.md decision table (f37dd18)
### Changed
- feat(tickets): removed Re-fix Times button (f37dd18)

## [2026-05-10] — Session: UI improvements
### Added
- feat(ui): calendar favicon SVG (9189426)
- feat(ui): always-visible search bar on desktop (9189426)
- feat(ui): quota reset time displayed in user's local timezone (9189426)

## [2026-05-10] — Session: multi-day events & scraper fixes
### Fixed
- fix(calendar): DayDetailPanel shows spanning events on day 2+ (2da4cab)
- fix(scrape): AI prompt now extracts endDate for multi-night concerts (2da4cab)

# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2026-05-09] — Session: Related Events + Quota Persistence + Scraper Fixes
- feat(modal): Sync button, search in FC toolbar, openEventId API fallback ([d0ecada])
- feat(search): event search dialog (Cmd+K) with keyboard navigation, no AI quota ([f19fafa])
### Fixed
- fix(quota): `remaining` was read before `incrementAiLimit` — badge always showed pre-scan count; now reads after increment ([d02893e])
- fix(quota): fallback to in-memory if DB columns not yet migrated (prevents 500 crash) ([fc3c9d3])
- fix(scrape): `ReferenceError: name is not defined` in AI provider catch block ([2e3b1e3])
- fix(diff): missing `/**` comment opener caused ECMAScript parse error in diff/route.ts ([d75c0a1])
- fix(tickets): AI quota now DB-persisted (`aiQuotaDate`/`aiQuotaCount` on User); survives dev hot-reloads and server restarts ([d75c0a1])
- fix(scrape): JSON-LD location as plain string now used directly as venue (fixes empty venue on timable multi-night events like IVE) ([d75c0a1])
### Added
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
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
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
- feat(tickets): GET /api/tickets/scrape endpoint returns current AI quota without running a scrape ([cadbf6a])

## [2026-05-02] — Session: Quota
### Changed
- chore(quota): raise AI daily scrape limit from 100 to 250 per user ([eb2d428])

## [2026-04-27] — Session: Ticket Section
### Added
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
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
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
- feat(calendar): per-calendar Google sync button + unlink Google account ([bcf01e7])
  - `POST /api/calendars/[id]/sync` — re-runs full Google Calendar event import for a linked calendar; only owner can trigger; returns count of synced events
  - `GET /api/google/account` — returns 200/404 to tell the UI if Google is linked
  - `DELETE /api/google/account` — unlinks Google OAuth; clears `googleCalendarId` on all user calendars; permanent but reversible via reconnect
  - RefreshCw icon button per Google-linked calendar row in Settings (spins while syncing, shows synced count in alert)
  - GoogleCalendarImport card: persistent "Google Account linked / No Google Account linked" footer with Unlink / Connect buttons; replaces old static text + error-only reconnect button

## [2026-04-27] — Session: ICS export + Google account management
### Added
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
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
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
- feat(calendar): spring bounce animation for newly created events ([195bc39])
  - `newEventId` state tracks the just-created event for 2 s
  - `eventClassNames` callback adds `fc-event-new` to the FC event wrapper
  - `@keyframes eventBirth` — spring bounce scale-in with slight rise (cubic-bezier spring curve)
  - `@keyframes eventShine` — white ring expands outward and fades on event appear

---

## [2026-04-26] — Session: Auto-commit rules + feature commits

### Added
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
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
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
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


## [2026-05-09] — Session: mobile responsive
### Added
- fix(mobile): DayDetailPanel as bottom-sheet on mobile ([605f755])
- feat(mobile): sidebar drawer, list view on mobile, hamburger FC toolbar button ([3dc8a4b])
- feat(url): event URL anchor (?event=id&date=YYYY-MM-DD); gotoDate on open ([100cef3])
