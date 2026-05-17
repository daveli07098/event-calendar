# Country Detection & Category Sync

## Country Detection

### Goal
Automatically append the host country to every event's `location` field so calendar entries read clearly — e.g. `東武動物公園, 埼玉県, Japan` instead of just `埼玉県`.

### Detection Priority

| Priority | Method | Example |
|---|---|---|
| 1 | **Known domain map** | `collabo-cafe.com` → Japan |
| 2 | **TLD-based** | `.jp` → Japan, `.hk` → Hong Kong, `.tw` → Taiwan |
| 3 | **AI-extracted** | AI reads the page text and returns `"country"` field |
| 4 | **None** | Location stored without country suffix |

Domain detection is intentionally the primary method — it's instant, offline, and accurate for the sites this app targets (Japanese collabo cafés, HK ticketing platforms, etc.). AI is the fallback for unlisted `.com` / international domains.

### Shared Utility

`src/lib/detect-country.ts` exposes:

```ts
// Returns "Japan", "Hong Kong", null, etc.
detectCountry(sourceUrl: string): string | null

// Appends country to location string if not already present
enrichLocationWithCountry(
  rawLocation: string | null,
  sourceUrl: string,
  aiCountry?: string | null,   // from AI prompt
): string | null
```

Used in:
- `src/app/api/tickets/add/route.ts` — when creating events from scan
- `src/app/api/tickets/update/route.ts` — when applying sync changes

### Adding New Domains

Edit `DOMAIN_COUNTRY` in `src/lib/detect-country.ts`:

```ts
const DOMAIN_COUNTRY: Record<string, string> = {
  "collabo-cafe.com": "Japan",
  // Add new site:
  "mynewsite.com": "Japan",
};
```

Set the value to `""` (empty string) for known ambiguous global domains (e.g. `ticketmaster.com`) — this prevents the TLD fallback from misclassifying them.

### AI Prompt Field

The AI extraction prompt includes:

```json
"country": "country name in English (e.g. Japan, Hong Kong, Taiwan) or null if unknown"
```

This is only used when domain/TLD detection returns null. The AI country is stored in `ticket.country` and passed to `enrichLocationWithCountry`.

---

## Category in Sync Diff

### Goal
When a user clicks **Sync** on an existing event, the diff should detect if the AI classification returned a different category than the one stored, and offer to update it.

### Flow

```
Sync button clicked
  → POST /api/tickets/scrape     (re-scrapes URL, returns ticket.category)
  → POST /api/tickets/diff       (compares ticket vs stored event)
     ├── category changed?  → push { field: "category", label, oldValue, newValue }
     └── hasChanges: true
  → User sees preview with category change listed
  → Confirm → PATCH /api/tickets/update
     └── apply.has("category") → mainUpdate.category = ticket.category
```

### Diff Logic (`src/app/api/tickets/diff/route.ts`)

```ts
if (ticket.category && ticket.category !== mainEvent.category) {
  changes.push({ field: "category", label: "Category 分類", oldValue: ..., newValue: ... });
}
```

Category is skipped if:
- `ticket.category` is null (AI couldn't classify)
- Category is already the same as stored

### Update Logic (`src/app/api/tickets/update/route.ts`)

```ts
if (apply.has("category") && ticket.category) {
  mainUpdate.category = ticket.category;
}
```

Category is only applied if the user explicitly confirmed the category change in the sync preview.

---

## Known Limitations

- Country detection cannot distinguish regional variants (e.g. `.jp` always → Japan, even for foreign events hosted on Japanese platforms)
- AI country extraction adds no latency since it reuses the existing AI call
- The diff will always flag a category change when re-syncing if the stored event has no category yet (null → new value)
