# Multi-Slot Event Grouping Rules

When a ticket URL has **multiple performance dates**, the scraper groups them into
distinct calendar events according to these rules.

## Grouping Algorithm

1. **Collect all performance nights** from JSON-LD `Event` blocks that have a `location`
   field (presence of a venue distinguishes concert nights from sale-window events).

2. **Group by start time** (HH:MM). Nights at the same time are candidates for merging.

3. **Within each time-group, find consecutive calendar day runs** (gap = exactly 1 day).
   A run of 2+ consecutive days becomes a single range event (`date` → `endDate`).
   A gap of 2+ days breaks the run into separate events.

4. **Different times always produce separate events**, even if dates are adjacent.

5. **Sort all resulting slots chronologically** by `date` ascending.

## Decision Table

| Scenario | Example | Result |
|---|---|---|
| Same time, consecutive days | Sep 5 + Sep 6 · 18:00 | ONE event Sep 5–6 18:00 |
| Same time, non-consecutive | Apr 11–13 and Apr 18–20 · 12:00 | TWO events (each weekend) |
| Different times, same day | Jun 14 13:30 and Jun 14 19:30 | TWO separate events |
| Single night only | May 16 · 20:00 | ONE event May 16 |
| Multi-night, same time | May 16 + May 17 · 20:00 | ONE event May 16–17 |

## Examples

### 粵劇特朗普5.0 (Theatre — evening run + matinee)

JSON-LD nights: Jun 13 19:30, Jun 14 19:30, Jun 14 13:30

- Time 19:30 group → [Jun 13, Jun 14] consecutive → **Event A: Jun 13–14 · 19:30**
- Time 13:30 group → [Jun 14] single → **Event B: Jun 14 · 13:30**

Both appear as checkboxes in the import UI; user picks which to add.

### IVE World Tour (Friday special + weekend run)

JSON-LD nights: Sep 4 20:00, Sep 5 18:00, Sep 6 18:00

- Time 20:00 group → [Sep 4] → **Event A: Sep 4 · 20:00**
- Time 18:00 group → [Sep 5, Sep 6] consecutive → **Event B: Sep 5–6 · 18:00**

### Coachella (2-weekend festival)

JSON-LD nights: Apr 11–13 (Week 1), Apr 18–20 (Week 2) all at same open time

- Time group has 6 dates; gap Apr 13→Apr 18 = 5 days → breaks run
- Run 1: Apr 11–13 → **Event A: Apr 11–13**
- Run 2: Apr 18–20 → **Event B: Apr 18–20**

## Implementation Reference

- Scraper: `groupIntoSlots(concertEvents)` in `src/app/api/tickets/scrape/route.ts`
- Returned as `slots: EventSlot[]` in the scrape API response
- UI: slot checkboxes in `src/components/tickets/TicketSection.tsx`
  - All slots selected by default
  - One calendar event created per selected slot
- If only 1 slot (or 0), the picker is hidden and the normal single-event flow runs

## Edge Cases

- **No JSON-LD at all**: Slots array is empty; AI-extracted `date`/`endDate` used as-is.
- **Single slot returned**: Picker hidden; behavior identical to before this feature.
- **All slots deselected**: "Add" button is disabled (must select at least 1).
- **endTime**: Derived from JSON-LD `endDate` of the event block if present; otherwise
  the add route defaults to start + 3 hours.
