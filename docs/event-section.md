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

### Governing constraint: server-rendered HTML only

There is no headless browser — the scanner reads whatever a plain server-side `fetch`
returns, so **a site is only scannable if its promo text is present in the raw HTML
response**, not injected client-side after load. This one fact decides the default
source list and most of the error taxonomy below — "Paste page" below is the escape
hatch for the sites it rules out. Measured directly against the app's own text extraction
(`extractTextFromHtml`) — readable characters left after tag-stripping:

| Site | Readable chars | Usable? |
|---|---|---|
| Marathon Sports HK | ~91k | Yes — default source |
| GigaSports HK | ~63k | Yes — default source |
| Skechers HK | ~5.5k | Yes — default source |
| nike.com (global) | ~2.3k | No — US-facing, near-textless |
| nike.com/hk | ~76 | No — JS-rendered shell |
| hk.puma.com | ~36 | No — JS-rendered shell, **not bot-blocked** (see "Paste page" below) |

adidas.com, adidas.com.hk and fanatics.com aren't in the table at all: they sit behind
Akamai Bot Manager and are unfetchable from any server, full stop (`src/lib/discounts/blocked.ts`).
Their 403 body carries `"page_owner":"AKAMAI"`, sets `bm_s`/`bm_so` sensor cookies, and
serves `/_es_/fo/customdeny/`. A full Chrome header set (`sec-ch-ua`, `sec-fetch-*`, etc.)
only flips the status from 403 to 200 — same ~2.5KB JS-sensor block page, just harder to
detect by status code alone — which is exactly why the scan route deliberately does
**not** send those headers, and why a Googlebot UA is never used as a fallback either:
spoofing a crawler identity doesn't bypass the sensor challenge, it just trades one
detectable signature for another. GigaSports (same `hkstore.com` platform as Marathon
Sports) is the one route that still surfaces real adidas markdowns. Verified directly in
a browser: all three block **a real, automation-controlled Chrome instance** too, not
just a plain `fetch` — so a headless-browser fallback on the server would be caught the
same way; this is not a fetching problem to solve better (see "Paste page" below).
hk.puma.com is the opposite case: not bot-blocked at all, purely client-rendered.

### Pipeline

1. **SSRF guard** — `assertPublicUrl(url)` (`src/lib/safe-fetch.ts`) resolves DNS and
   validates every hop before any fetch, and non-`http(s)` protocols are rejected up
   front. Failure → `400 Private URLs are not allowed`.
2. **Fetch** — `safeFetch` with a browser-like `User-Agent` but deliberately no full
   Chrome `sec-ch-ua`/`sec-fetch-*` header set (see above), a 15s timeout, `cache:
   "no-store"`. The response now also exposes `finalUrl` (the post-redirect,
   post-validation URL actually fetched — plain `Response.url` doesn't survive
   `safeFetch`'s manually-constructed, size-capped `Response`), used below to detect a
   corporate redirect; per-hop SSRF re-validation inside `assertPublicUrl` is unchanged. A
   non-`ok` response is run through `detectBlockReason` (below) before a generic `422`.
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
   field is coerced/validated into a `DiscountScanResult` (below), including running
   every offer through the **offer concreteness gate** (`src/lib/discounts/offers.ts`,
   see below) before the result is returned.

### Paste page — the escape hatch for bot-walled / JS-rendered sites

`POST /api/discounts/scan` also accepts an optional `pageContent` alongside the existing
`url` (still required/validated as on a normal scan — it labels the result and is the
base URL pasted-HTML relative links resolve against). Non-blank `pageContent` skips the
fetch pipeline **entirely**: no `assertPublicUrl`/`safeFetch`/`detectBlockReason` — nothing
is fetched, so there's nothing to validate or inspect for a block signature; the user's
own browser already got past whatever blocks the server.

`looksLikeHtml()` (`src/lib/discounts/text.ts` — requires a real open/close tag on a
bounded 4000-char sample, so a stray "<"/">" in plain text like "price < $50" isn't
misclassified) picks the path: **HTML** runs `extractLinksFromHtml` →
`selectDiscountCandidates` → `extractTextFromHtml`, same as a fetched page, so deep links
still resolve to real URLs. **Plain text** has no links, so every `url` in the result is
`null`; it still gets `prioritizeAndTruncate()` — a deliberate local duplicate of
`extractTextFromHtml`'s keyword-priority truncation (`src/lib/ai/html.ts`), not an import,
because the pasted-content feature's allowed scope excluded that file and the algorithm
is short enough to duplicate cheaply.

Two error reasons guard the paste (full table below): `content_too_large` (over 400,000
characters, checked *before* the quota check so an oversized paste costs nothing) and
`empty_content` (under 100 characters extracted, mirrors `thin_content`'s floor).
`DiscountSection` treats both as fixable input, not a scan failure: the dialog stays open
and shows the server message inline (`pasteError`) so the paste can be corrected.

A pasted scan is otherwise identical to a fetched one — same prompt, normalisation, and
concreteness gate — and it **still consumes AI quota**. The only marker is
`DiscountScanResult.fromPastedContent`, optional so a result persisted before the field
existed still satisfies the type; `DiscountSection` renders it as "· from pasted page"
beside "Checked Nh ago". Pasted content is untrusted exactly like fetched HTML — it only
ever becomes prompt text and extracted strings, never rendered markup.

**Verified end-to-end**: pasting hk.puma.com's rendered text produced three offers — the
headline "🍂AUTUMN SPECIAL! 3件6折" read as **40% off** (pay 60% for 3 items), "正價2件8折"
as **20% off**, and "滿$1500減$200" as a separate minimum-spend offer.

Every row has an always-available small paste icon regardless of status, plus a primary
"Paste page" button on `bot_protected`/`corporate_redirect` rows (replacing Re-check) and
`thin_content` rows (alongside Re-check).

### `DiscountScanResult` contract

Defined once in `src/lib/discounts/types.ts` and imported by both the route (producer)
and `DiscountSection` (consumer) so they can't drift. Key shape: `hasDiscount`,
`confidence`, `title`, `discountSummary`, `discountPercent`, `promoCode`, `startDate`/
`endDate`, `categories`, `offers: DiscountOffer[]`, `evidence`, `items: DiscountItem[]`,
`sourceUrl`, `url`, `aiUsed`, `tokensUsed`, `fromPastedContent` (optional — see "Paste
page" above) — see the file for full field docs.

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

### Default sources

`DEFAULT_SOURCES` in `DiscountSection.tsx` is the three server-rendered HK storefronts
from the evidence table above — Marathon Sports, GigaSports, Skechers HK — chosen purely
because their promo text is actually present server-side, not for brand preference.
GigaSports stands in for adidas, whose own domains are unreachable.

### Error reasons

Every scan-route error carries both a human `error` string and a machine
`DiscountScanErrorReason` (`src/lib/discounts/types.ts`) so the UI branches on the code
instead of pattern-matching text:

| Reason | Meaning | UI treatment |
|---|---|---|
| `bot_protected` | 403/429, or a 200 whose body matches a known challenge-page signature (`detectBlockReason`) | Amber "Can't scan", **Open-site** link + primary **Paste page** button instead of Re-check (re-checking can never succeed — the wall still blocks the next request) |
| `corporate_redirect` | Final URL lands on a different host that's a corporate/investor subdomain (`about.`/`corporate.` prefix) | Amber "Can't scan", **Open-site** link + primary **Paste page** button instead of Re-check |
| `thin_content` | Extracted page text < 100 characters — likely JS-rendered | Amber "Can't scan", but **keeps Re-check** alongside a **Paste page** button (a different path on the same site, or a future server-rendered version, may work) |
| `content_too_large` | Pasted `pageContent` over 400,000 characters — checked before the AI-provider/quota checks, so it never costs a quota call | Paste dialog stays open, server message shown inline (`pasteError`); no error row written over the source |
| `empty_content` | Pasted `pageContent` yielded under 100 characters of extracted text — mirrors `thin_content` for the paste path | Paste dialog stays open, server message shown inline; no error row written over the source |
| `fetch_failed` / `invalid_url` / `private_url` / `no_ai` / `quota` / `ai_failed` | Everything else — network error, bad input, SSRF block, no AI provider, daily quota exhausted, AI extraction failure | Red "Failed", keeps Re-check |

`detectBlockReason` catches the `www.puma.com` → `about.puma.com` case specifically: a
final-URL host differing from the requested host AND starting with `about.`/`corporate.`
is `corporate_redirect`, not ordinary empty content — otherwise it would silently report
"no discount found" instead of pointing at `hk.puma.com`. In `DiscountSection`, `cantScan`
(amber, no red) covers all three of `bot_protected`/`corporate_redirect`/`thin_content`;
`unfetchable` (Open-site, no Re-check) is the narrower `bot_protected`/`corporate_redirect`
pair — see "Paste page" above for which rows get the Paste page button.

### Offer concreteness gate

`src/lib/discounts/offers.ts` re-checks every AI-returned offer against the page's own
claims before the result reaches the client — the prompt tells the model not to
manufacture offers from navigation-link text alone, but models don't reliably comply. A
real regression this guards against: nike.com returned `hasDiscount: true, confidence:
"high"` with offers "Sale Shoes", "Student Discount", "Military Discount" and **no
percentage, code, or price anywhere on the page** — those were candidate-link labels off
the "Links on the page" list, not promotions.

`filterConcreteOffers(offers, evidence)` keeps an offer only when it has a `promoCode`
(a checkable claim on its own), its `label`+`detail` contains a digit or `折` (NFKC-normalized,
so fullwidth digits count), or an entry in the page-wide `evidence` list does (a fallback
for a vague offer whose own text lacks the number the model captured elsewhere).
`applyConcretenessGate(result, filteredOffers)` then handles total wipeout: if no offers
survived AND the headline has no `discountPercent`/`promoCode` either, there's nothing
left backing `hasDiscount: true` — it's forced to `false, confidence: "low"` rather than
surfacing an empty-but-confident sale. Both run in the scan route before the response is built.

### Client persistence & custom sources

`DiscountSection` uses two `localStorage` keys: `discount-sources` (custom source URLs,
appended to `DEFAULT_SOURCES`) and `discount-results` (scan results keyed by source URL,
restored on mount so a reload doesn't wipe them, filtered to sources still in the current
list; `hydratedResultsRef` guards the persistence effect from clobbering storage before
this restore runs). A result shows muted ("stale") once `STALE_AFTER_MS` (24h) has passed
since `checkedAt` (`isStale()`); `relativeTime()` renders "Checked Nh ago" regardless.
**Scan results remain localStorage-only by design** — see "Known limits" below.

**Custom sources are account-backed**: `User.discountSources` (`prisma/schema.prisma`,
`Json?`, nullable, migration `20260920000000_add_user_discount_sources`) persists a
user's added source URLs so they survive across browsers/devices. `GET`/`PUT
/api/discounts/sources` require a session; `PUT` validates every entry as a parseable
`http(s)` URL (rejecting the whole request on the first bad one), normalises with `new
URL(...).toString()`, dedupes, and caps the list at `MAX_SOURCES = 50`.

Client flow (mount effect): render the localStorage copy first, then `GET` the server
list. Any local-only sources get one-time `PUT`ed up as a union so they aren't silently
dropped, then the server's confirmed list wins. On any failure — offline, unauthenticated,
server error, or that migration `PUT` itself failing — fall back to this-device-only
storage, with a "Saved on this device only" note near the Add-source input. Adding/
removing afterwards uses `mutate()`'s optimistic update + `rollback` (error toast
`"Couldn't save your sources"`) on failure. localStorage stays an offline mirror
throughout, never the source of truth once the server is reachable.

**Quota gating**: every scan calls `checkRemainingAiLimit(uid)` before fetching and
`incrementAiLimit(uid)` after a successful AI call (`src/lib/ai/quota.ts`) — a shared
per-user daily budget (`AI_DAILY_LIMIT = 250`) covering *all* AI features (ticket
scraping, discount scanning, category detection, …), DB-backed with an in-memory
fallback, resetting at midnight HKT regardless of server TZ. Exhausting it returns `429`
with `resetAt`, surfaced to the client via `onQuotaUpdate`.

**Known limits**:
- **JS-rendered / bot-protected sites** — the governing constraint above; such sites fail
  `422` with `bot_protected`/`corporate_redirect`/`thin_content` on a normal scan.
  "Paste page" (above) is the standing workaround for all three.
- **Prompt size** — ≤40 candidate links are listed (`selectDiscountCandidates(...,
  max = 40)`); pages with far more promo-shaped links have some silently dropped
  (same-origin ones prioritised).
- **No server persistence for scan results** — deliberately no Prisma model for them
  (live, shared database, no migration step in this workflow), so results still live only
  in `discount-results` (device-local) even though custom *sources* are now account-backed.

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
| `components/DiscountSection.test.tsx` | Restoring a persisted result from `localStorage` verbatim; not restoring a result for a source no longer in the list; an offer's/item's link rendering only when its `url` is set; validity-chip formatting (`D – D Mon` / `Until D Mon`); no timezone day-shift for date-only strings; the three server-rendered HK defaults render (not the JS-rendered/blocked ones); `bot_protected`/`corporate_redirect` render amber "Can't scan" with an Open-site link and no Re-check button; custom sources load from the account-backed API on mount, not localStorage; a failed add rolls back with an error toast; a trailing-slash-only duplicate is rejected client-side; a failed one-time local→server migration still renders the local-only source, shows the device-only note, and toasts once. **Paste page**: opening the dialog from a `bot_protected` row posts `{ url, pageContent }` to the scan endpoint; a successful pasted scan renders offers plus a "from pasted page" marker; an `empty_content` response keeps the dialog open and shows the server's message inline instead of writing an error row. |
| `api/discounts/scan/route.test.ts` | Pasted-content path: skips `safeFetch`/`assertPublicUrl` entirely; an HTML paste extracts offers and resolves a relative deep link against `url`; a plain-text paste yields offers with every `url` field `null`; a too-short paste returns `422`/`empty_content`; an oversized paste returns `413`/`content_too_large` before any quota check; a pasted scan still calls `checkRemainingAiLimit`/`incrementAiLimit`; `fromPastedContent` is `false` on a normal fetched scan. |
| `lib/discounts/text.test.ts` | `looksLikeHtml`: detects real tag pairs with and without attributes; does not misclassify a stray "<"/">" comparison or arrow (e.g. "price < $50", "10% -> 20%") in plain text as markup. `prioritizeAndTruncate`: reorders keyword-matching sentences to the front; truncates to `maxLen` after reordering. |
| `lib/discounts/percent.test.ts` | `normalizeDiscountPercent`: bare/two-digit/decimal `折` conversion; finding `折` embedded in other text or only in context; the "up to" prefix and its "immediately before the number" restriction (vs. unrelated markers like 最低消費); pass-through of ranges/"as low as" with no `折`; headline evidence-fallback ordering. |
| `lib/discounts/links.test.ts` | `extractLinksFromHtml`: relative-href resolution, keeping nav links, dedup-by-href, dropping `#`/`javascript:`/`mailto:` hrefs, entity decoding, cross-origin links. `selectDiscountCandidates`: keyword matching (Chinese/English/`折`) in text or URL, same-origin-first ordering, the `max` cap. `matchItemLink`: name↔link-text overlap and its ≥6-character/short-anchor-rejection rules. |
| `lib/discounts/blocked.test.ts` | `detectBlockReason`: 403/429 always flag `bot_protected`; a sub-8KB Akamai sensor stub served as 200 flags `bot_protected`; a large page merely containing "Access Denied" text does NOT false-positive; a small 200 body containing `customdeny` flags `bot_protected`; a `www.puma.com` → `about.puma.com` redirect flags `corporate_redirect`; a same-host 200 or a same-brand regional-subdomain redirect does not flag either reason. |
| `lib/discounts/offers.test.ts` | `filterConcreteOffers`: drops nav-link-only offers with no digit/折/code claim (the nike.com shape); keeps offers with a concrete 折/percent claim or a promo code; keeps a vague offer backed only by page-wide evidence; treats a fullwidth digit as concrete after NFKC normalization. `applyConcretenessGate`: forces `hasDiscount:false, confidence:"low"` when every offer was dropped and there's no headline percent/code; keeps `hasDiscount:true` when offers survived or the headline alone carries a percent/code. Plus an end-to-end filter+gate pipeline case for both the nike.com (all dropped) and Marathon Sports (kept, "up to 20%") shapes. |
| `api/discounts/sources/route.test.ts` | 401 when unauthenticated (both GET and PUT); GET returns `[]` for a null `discountSources` and filters non-string entries out of the stored JSON; PUT rejects a non-array body, an invalid URL entry, and a non-`http(s)` entry with 400, persisting nothing; PUT normalises and dedupes entries; PUT caps the stored list at 50 entries. |
| `api/venues-events.test.ts` | 401 when unauthenticated; grouping matched events by venue with ticket/seat/seat-map flags; counting past events without listing them; excluding placeholder locations from `unmatched`; grouping duplicate unmatched text and capping at 20. |
| `lib/venue-match.test.ts` | `normalizeVenueText` punctuation/CJK-gap folding; `venueKeys` (name, aliases, parenthesised nickname); `matchVenue`'s exact vs. substring passes, including the PORTAL/"Kowloon Portal Plaza" false-positive guard; `extractVenueText`/`isPlaceholderLocation`. |
| `components/VenueSection.test.tsx` | Event-activity badges (upcoming/ticketed/seat-map/past) render from the events payload; "Show events" discloses seat text and ticket link; "Add to directory" posts to `/api/venues`; delete requires confirmation before the DELETE call fires. |
| `lib/venue-seatmap.test.ts` | `matchVenueConfig` matching a full Kai Tak alias, rejecting a bare landmark name, returning `null` for an unrelated venue (plus geometry-resolution cases outside this doc's scope). |
| `lib/theme-boot.test.ts` | The boot script references the exact `STORAGE_KEY` `ThemeContext` writes; applies the OS-dark class pre-paint when storage is empty and mode is `system`; skips dark when the OS prefers light; prefers a persisted theme over OS preference; applies the same `--primary`/`--ring`/`--radius`/density as the runtime `applyThemeToDocument`; degrades gracefully on corrupt `localStorage` JSON. |
