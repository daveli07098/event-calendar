# v2 — personal home, shared ticket calendar, off-app reminders

## What changed

| Area | Where |
|---|---|
| Home dashboard at `/` (agenda, countdowns, bookmarks, quick capture) | `src/app/page.tsx`, `src/components/home/` |
| Calendar moved to `/calendar`; default view is **Upcoming** | `src/app/calendar/page.tsx`, `src/components/calendar/CalendarView.tsx` |
| Agenda grouping (sales / today / tomorrow / next days / ongoing) | `src/lib/agenda.ts`, `src/lib/agenda-data.ts`, `src/components/agenda/UpcomingAgenda.tsx` |
| Top nav on every signed-in page | `src/components/nav/AppNav.tsx`, mounted in `src/app/layout.tsx` |
| Site-shared ticket calendars | `Calendar.isSiteShared`, `src/lib/site-calendar.ts`, `scripts/set-site-shared.ts` |
| Phone calendar feed with alarms | `src/lib/ics.ts`, `src/app/api/feed/[token]`, `src/app/api/user/feed-token` |
| Web push reminders | `src/lib/push*.ts`, `src/app/api/push/*`, `public/sw.js`, `.github/workflows/push-reminders.yml` |

Deep link format used everywhere (tickets, venues, home, push clicks):
`/calendar?date=YYYY-MM-DD&event=<id>`.

## Agenda rules

- Ticket sales (`sale-ticket` calendar) get their own "Sales opening" strip for the next 7 days.
- Events lasting 3+ days (`LONG_EVENT_DAYS`) — fairs, exhibitions, pop-ups — collapse into
  one quiet **Ongoing** row and appear in the day lists only on their start day.
- In Month/Week, `eventOrder` ranks sales → short events → long events; long events render as
  outlined bars (`.fc-event-long` in `globals.css`).

## Rollout checklist (order matters)

1. **Apply the migration** before the code goes live — `pnpm build` does not migrate:
   `pnpm db:migrate:dev` (runs `prisma migrate deploy` against `.env.local`'s `DATABASE_URL`).
   Migration `20261026000000_v2_home_shared_reminders` is additive only.
2. **Mark the curated calendars as site-shared** (owner account):
   `npx tsx scripts/set-site-shared.ts --email <owner> --dry-run`, then without `--dry-run`.
   Every user is auto-joined as viewer on their next home/calendar load. Undo with `--off`.
3. **Vercel env** (Production): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (needed at build time), `CRON_SECRET`. Values are in `.env.local`.
4. **GitHub** repo settings: secret `CRON_SECRET` (same value) and variable `APP_URL`
   (e.g. `https://<prod-domain>`). The workflow calls `/api/push/dispatch` every 5 min.
5. Deploy, then in **Settings → Reminders**: create the calendar feed link and add it to the phone,
   and enable push on each device (iPhone: Add to Home Screen first).

## Reminder channels

| Channel | Timing | Reliability |
|---|---|---|
| Calendar feed (VALARM) | sales −1 d, −15 min · timed events −1 d, −1 h · all-day/long: 20:00 day before, 09:00 on the day | Best — the phone's own calendar fires it; feed refreshes ~hourly |
| Web push | sales −1 d, −1 h, −15 min · timed −1 d, −1 h · all-day/long 09:00 HKT | GitHub cron is best-effort (can run 10–30 min late); a reminder fires if due within the last 30 min |
| In-tab toasts | lead time from `ec-reminder-lead-minutes` | Only while the app is open |

`PushReminderLog` (unique `userId,eventId,kind`) guarantees each push is sent once.
The feed token is a secret URL — regenerate it in Settings if it leaks.

## Gemini

`src/lib/ai/models.ts` holds the free-tier-only pool (checked 2026-10-26 with ListModels + a ping
per model). Scrape route: `maxDuration = 60`, 12 s per model attempt, 40 s cascade budget.
