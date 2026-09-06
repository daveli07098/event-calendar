# Event Section (`/tickets`)

Covers the "Event Section" page: tab routing, the Discount Sale scanner, venue
detection, the theme-boot script every page inherits from the root layout, and the tests
pinning all of the above. For multi-slot ticket grouping see
`docs/multi-slot-event-rules.md`; for category detection see
`docs/country-category-detection.md`; for World Cup scores see `docs/worldcup-scores.md`.

## 1. Overview

`src/app/tickets/page.tsx` requires a session (redirects to `/login` otherwise) and
renders `TicketSection` (`src/components/tickets/TicketSection.tsx`), which owns a
`section` state of type `"import" | "venues" | "classify" | "discounts" | "worldcup"`
and a nav for it (`VenueSection`, `DiscountSection`, `WorldCupSection`, plus inline
"Import Event"/"Category Detection" panels).

Deep-linking is bidirectional:

- **Reading**: on mount, and again whenever `useSearchParams()` returns a new query
  string (browser back/forward), an effect reads `?section=` and calls `setSection` if
  it's one of the five known values.
- **Writing**: `handleSectionChange` sets local state immediately and mirrors the choice
  into the URL with `router.replace(\`/tickets?section=${id}\`, { scroll: false })` —
  `replace`, not `push`, so tab-switching doesn't spam browser history.

Local state, not the URL, is the source of truth for rendering; the URL is kept in sync
so reload/back/share preserve the open tab. Pinned by `TicketSection.test.tsx`.

## 2. Discount Sale scanner

`DiscountSection` (`src/components/tickets/DiscountSection.tsx`) posts a URL to
`POST /api/discounts/scan` (`src/app/api/discounts/scan/route.ts`), which requires an
authenticated session and a configured AI provider (`hasAiProvider()`).

### Pipeline

1. **SSRF guard** — `assertPublicUrl(url)` (`src/lib/safe-fetch.ts`) resolves DNS and
   validates every hop before any fetch, and non-`http(s)` protocols are rejected up
   front. Failure → `400 Private URLs are not allowed`.
2. **Fetch** — `safeFetch` with a browser-like `User-Agent` (large retailers reject bot
   UAs), a 15s timeout, `cache: "no-store"`. A non-`ok` response (often 403/429 bot
   protection) → `422` with a hint.
3. **Link extraction on raw HTML** — `extractLinksFromHtml`
   (`src/lib/discounts/links.ts`) regex-scans the **raw** HTML for anchors (no DOM lib
   server-side); must run before text extraction strips tags. Nav links are kept —
   promo menus often live there. `selectDiscountCandidates` narrows this to ≤40
   same-origin-first links whose text or path+query matches `DISCOUNT_KEYWORDS`
   (English + Chinese, including `折`, `優惠`, `減價`, `清貨`, `低至`).
4. **Text extraction** — `extractTextFromHtml(html, DISCOUNT_KEYWORDS)`
   (`src/lib/ai/html.ts`) strips tags (including `<nav>`) for the prompt. Under 100
   characters of result → treated as JS-rendered/bot-blocked, `422`.
5. **AI** — `aiExtractJson(DISCOUNT_PROMPT(...))` runs the prompt (in the route) against
   the page text plus a numbered "Links on the page" block built from the candidates.
6. **Server normalisation** — the route never trusts the AI's raw JSON directly; every
   field is coerced/validated into a `DiscountScanResult` (below).

### `DiscountScanResult` contract

Defined once in `src/lib/discounts/types.ts` and imported by both the route (producer)
and `DiscountSection` (consumer) so they can't drift. Key shape: `hasDiscount`,
`confidence`, `title`, `discountSummary`, `discountPercent`, `promoCode`, `startDate`/
`endDate`, `categories`, `offers: DiscountOffer[]`, `evidence`, `items: DiscountItem[]`,
`sourceUrl`, `url`, `aiUsed`, `tokensUsed` — see the file for full field docs.

**Deep links are index-based**: the AI is never trusted to author a URL. The prompt asks
for `url` (top-level and per-offer) as the **number** of an entry in the "Links on the
page" list, not a string. `urlOf()` in the route only accepts an integer in
`[0, candidates.length)` and resolves it to `candidates[v].href`; anything else (a
string, out-of-range number, a float) becomes `null` — so every non-null `url` in the
response literally appeared on the page.

### 折 (zhé) semantics

Chinese retail states discounts as "pay N/10 of the price" — the opposite sense of a
Western "% off" — and the AI regularly mistranslates it. `src/lib/discounts/percent.ts`
normalises this: a `折` token found anywhere in the raw value or its context **wins**
over whatever number the AI returned.

| Text | Meaning | Normalised `discountPercent` |
|---|---|---|
| `3折` | pay 30% of the price | `70%` |
| `85折` | pay 85% of the price | `15%` |
| `低至3折` | pay *as low as* 30% (a ceiling) | `up to 70%` |

`normalizeDiscountPercent(raw, context)` runs both for the headline (`discountSummary`/
`title` as context, falling back to `evidence` only when those two yield nothing) and
per-offer (`detail`/`label` as context) in `src/app/api/discounts/scan/route.ts`. The
"up to" prefix only applies when a ceiling marker (`低至`/`最低`/`up to`/`as low as`)
sits immediately before the number it qualifies — a marker elsewhere in the string
(e.g. "最低消費$500 ... 全場85折", minimum spend) does not trigger it.

**Client persistence**: `DiscountSection` uses two `localStorage` keys: `discount-sources`
(custom source URLs, appended to `DEFAULT_SOURCES` — Nike, adidas, Puma, Marathon Sports
HK) and `discount-results` (scan results keyed by source URL, restored on mount so a
reload doesn't wipe them, filtered to sources still in the current list;
`hydratedResultsRef` guards the persistence effect from clobbering storage before this
restore runs). A result shows muted ("stale") once `STALE_AFTER_MS` (24h) has passed
since `checkedAt` (`isStale()`); `relativeTime()` renders "Checked Nh ago" regardless.

**Quota gating**: every scan calls `checkRemainingAiLimit(uid)` before fetching and
`incrementAiLimit(uid)` after a successful AI call (`src/lib/ai/quota.ts`) — a shared
per-user daily budget (`AI_DAILY_LIMIT = 250`) covering *all* AI features (ticket
scraping, discount scanning, category detection, …), DB-backed with an in-memory
fallback, resetting at midnight HKT regardless of server TZ. Exhausting it returns `429`
with `resetAt`, surfaced to the client via `onQuotaUpdate`.

**Known limits**:
- **JS-rendered / bot-protected sites** — raw HTML only, no headless browser; sites
  needing client-side rendering or returning a bot-protection 403/429 fail with `422`.
- **Prompt size** — ≤40 candidate links are listed (`selectDiscountCandidates(...,
  max = 40)`); pages with far more promo-shaped links have some silently dropped
  (same-origin ones prioritised).
- **No server persistence** — deliberately no Prisma model for scan results: this is a
  live, shared database with no migration step in this workflow, so results live only
  in the two `localStorage` keys above (device-local, not shared across devices/users).

## 3. Venues — detection

`EventVenue` (Prisma) is a **shared directory with no `userId`** — not scoped to one
user's calendars. By design: matching an event's free-text location to a venue is
match-only, never auto-creating a venue or rewriting `Event.location`; turning an
unmatched location into a directory entry always requires a human clicking "Add to
directory" (`handleAddUnmatched` in `VenueSection.tsx`, `POST /api/venues`). Deleting a
venue is likewise guarded by a confirmation dialog ("This affects everyone using this
directory") since the directory is shared.

### Matching rules (`src/lib/venue-match.ts`)

`normalizeVenueText(s)` does Unicode NFKC, lowercase, folds fullwidth/halfwidth
punctuation (`()（）[]【】,，、·・-–—/|`) to spaces, collapses whitespace, then removes
spaces *between* CJK characters (so "啟德體育園 主場館" and "啟德體育園主場館" compare
equal). `venueKeys(venue)` builds every normalized key a venue is recognized by: its
name, its `aliases`, and — for names with a parenthesised part like "香港體育館 (紅館)"
— the parenthesised part alone ("紅館") and the name with it stripped, since both forms
appear in the wild.

`matchVenue(locationText, venues)` runs two passes. **Pass 1 (exact)**: split
`locationText` on `,` `，` `;` `\n`, normalize each segment, and look for a segment
equal to one of a venue's keys (longest wins ties). **Pass 2 (conservative substring)**,
only if pass 1 found nothing: look for a key contained anywhere in the whole normalized
text, but only keys specific enough for containment to be safe — pure-CJK keys of ≥4
characters, or Latin/mixed keys of ≥2 words or ≥8 characters, matched on word
boundaries. This is why venue "PORTAL" does not match "Kowloon Portal Plaza" but does
match "PORTAL, Hong Kong". `isPlaceholderLocation(text)` filters out bare city/country
names (e.g. "Hong Kong") and TBD-style markers (`tbd`, `tba`, `待定`, `coming soon`,
`未定`, `to be announced`) so they're never reported as an "unmatched venue".

### `GET /api/venues/events` response

Requires a session; scopes to the caller's accessible calendars (owned + shared
memberships, mirroring `accessibleCalendarIds` in `src/app/api/events/route.ts`).
Returns `{ venues, unmatched }`:

- `venues[]`: one entry per matched venue — `venueId`, `hasSeatMap`, `upcoming`
  (capped at 20, sorted ascending, each with `seat`/`ticketUrl` parsed from the event
  description's `Seat: ...`/`Ticket URL: ...` lines), `pastCount`.
- `unmatched[]`: upcoming events whose venue text matched nothing, grouped by raw text
  (top 20 by count) with a `sampleEventId`/`sampleTitle` — feeds `VenueSection`'s
  "Locations in your events not in the directory" panel.

An event's venue text is `extractVenueText(event)`: the `Venue: ...` line from
`description` (what the ticket-scraping flow writes) if present, else `location`.

### `hasSeatMap`

Ties into the seat-map registry (`src/lib/venue-seatmap/registry.ts`,
`matchVenueConfig(name)`), which only matches full confirmed aliases (case-insensitive
substring) against a small built-in `REGISTRY` (currently Kai Tak Stadium only) — never
a bare landmark name, since e.g. Kai Tak Cruise Terminal is a different venue sharing
the "Kai Tak" landmark. Two flags are computed in the route: **venue-level** `hasSeatMap`
(true if the venue's own name *or any alias* resolves to a config) and **event-level**
`hasSeatMap` on each `VenueEventSummary` (the venue-level flag, OR the event's own raw
venue text resolving to a config directly).

**Adding aliases**: to make a venue match more ticket texts, add the name to its
`aliases` array (`EventVenue.aliases`) — every alias becomes a `venueKeys()` entry
considered in both matching passes above. To make a venue render a built-in seat map,
its name or an alias must contain a string from the matching
`VenueSeatMapConfig.aliases` in `src/lib/venue-seatmap/venues/`.

## 4. Theme boot script

Every page (via `src/app/layout.tsx`) inherits a boot script eliminating the light→dark
(and default-accent→real-accent) flash of unstyled content on first paint. The root
cause it works around, quoted from the layout's comment:

> This is a plain inline `<script>` rendered directly inside `<head>` (not
> `next/script`'s `strategy="beforeInteractive"` — that queues the content ... rather
> than emitting a real parser-blocking `<head>` script, and having `next/script`'s
> returned `<script>` node sit under `<html>` before `<body>` also trips React 19's
> "Cannot render a sync or defer `<script>` outside the main document" warning).

So `layout.tsx` renders `<script id="theme-boot" dangerouslySetInnerHTML={{ __html:
buildThemeBootScript() }} />` directly inside an explicit `<head>` element, guaranteeing
it lands in server-rendered `<head>` markup ahead of `<body>` (a plain `<script>` is
rendered by React exactly where it appears in the tree). Being synchronous and
non-async/defer, it blocks parsing until it finishes, which is the point: it runs
before hydration and sets the same `class`/custom properties on `<html>` that
`ThemeContext`'s post-mount effect would otherwise set, just before paint instead of
after. `suppressHydrationWarning` on `<html>` tells React not to complain that the
script's attributes differ from server-rendered markup. `buildThemeBootScript()`
(`src/lib/theme-boot.ts`) stringifies the exact same `applyThemeToDocument` function
`ThemeContext` calls at runtime (via `.toString()`), so boot-time and runtime behaviour
can't silently drift apart.

## 5. Testing (paths under `src/__tests__/`)

| File | Pins |
|---|---|
| `TicketSection.test.tsx` | Tab click → `router.replace` with `?section=`; only the active tab gets `aria-current="page"` (default `import`); opening directly on `?section=<x>`; the nav's accessible label; re-syncing on `searchParams` change (back/forward). |
| `TicketSection.abort.test.tsx` | Cancel aborts the in-flight scrape and preserves the typed URL; a timeout shows a distinct message; Retry re-issues the same request. |
| `components/DiscountSection.test.tsx` | Restoring a persisted result from `localStorage` verbatim; not restoring a result for a source no longer in the list; an offer's/item's link rendering only when its `url` is set; validity-chip formatting (`D – D Mon` / `Until D Mon`); no timezone day-shift for date-only strings. |
| `lib/discounts/percent.test.ts` | `normalizeDiscountPercent`: bare/two-digit/decimal `折` conversion; finding `折` embedded in other text or only in context; the "up to" prefix and its "immediately before the number" restriction (vs. unrelated markers like 最低消費); pass-through of ranges/"as low as" with no `折`; headline evidence-fallback ordering. |
| `lib/discounts/links.test.ts` | `extractLinksFromHtml`: relative-href resolution, keeping nav links, dedup-by-href, dropping `#`/`javascript:`/`mailto:` hrefs, entity decoding, cross-origin links. `selectDiscountCandidates`: keyword matching (Chinese/English/`折`) in text or URL, same-origin-first ordering, the `max` cap. `matchItemLink`: name↔link-text overlap and its ≥6-character/short-anchor-rejection rules. |
| `api/venues-events.test.ts` | 401 when unauthenticated; grouping matched events by venue with ticket/seat/seat-map flags; counting past events without listing them; excluding placeholder locations from `unmatched`; grouping duplicate unmatched text and capping at 20. |
| `lib/venue-match.test.ts` | `normalizeVenueText` punctuation/CJK-gap folding; `venueKeys` (name, aliases, parenthesised nickname); `matchVenue`'s exact vs. substring passes, including the PORTAL/"Kowloon Portal Plaza" false-positive guard; `extractVenueText`/`isPlaceholderLocation`. |
| `components/VenueSection.test.tsx` | Event-activity badges (upcoming/ticketed/seat-map/past) render from the events payload; "Show events" discloses seat text and ticket link; "Add to directory" posts to `/api/venues`; delete requires confirmation before the DELETE call fires. |
| `lib/venue-seatmap.test.ts` | `matchVenueConfig` matching a full Kai Tak alias, rejecting a bare landmark name, returning `null` for an unrelated venue (plus geometry-resolution cases outside this doc's scope). |
| `lib/theme-boot.test.ts` | The boot script references the exact `STORAGE_KEY` `ThemeContext` writes; applies the OS-dark class pre-paint when storage is empty and mode is `system`; skips dark when the OS prefers light; prefers a persisted theme over OS preference; applies the same `--primary`/`--ring`/`--radius`/density as the runtime `applyThemeToDocument`; degrades gracefully on corrupt `localStorage` JSON. |
