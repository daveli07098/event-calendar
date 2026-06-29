# World Cup scores — how they're sourced and kept fresh

The tournament view (`src/components/tickets/WorldCupSection.tsx`) shows group
standings + the knockout bracket. Fixtures themselves are calendar **events**
(seeded by `scripts/seed-worldcup*.ts`, parsed by `src/lib/worldcup.ts`). Scores
come from two layers:

## Layer A — verified results (source of truth, always wins)

`src/lib/worldcup-results.ts` holds hand/Workflow-verified scorelines:

- `VERIFIED_GROUP_SCORES` — group A–L final scores, keyed by group + home + away
  (seed home/away orientation).
- `VERIFIED_KNOCKOUT_SCORES` — knockout scores keyed by FIFA match number
  (`matchId`), with optional `winner` for penalty shootouts.

`mergeVerifiedGroups()` / `mergeVerifiedKnockout()` overlay these over whatever
the AI produced — **verified always wins** — both at read time (GET) and on
refresh (POST/cron). This exists because AI grounding has repeatedly recorded
wrong scorelines.

### Updating the verified data

Re-run the multi-agent workflow, then paste results in:

```
Workflow({ name: "worldcup-2026-results" })   # .claude/workflows/worldcup-2026-results.js
```

It fetches group + knockout results from Wikipedia (per-group articles — the
`/...group_stage` URL 404s; WebFetch summaries can hallucinate, so it falls back
to raw MediaWiki wikitext) and adversarially verifies each table. Cross-check
group standings against the knockout bracket (e.g. K third = DR Congo ⇒ M80
England vs DR Congo). Populate `VERIFIED_KNOCKOUT_SCORES` as matches are played.

## Layer B — AI refresh (live, fills the gaps)

`refreshWorldCupScores(uid)` in `src/lib/worldcup-refresh.ts` is the single
refresh engine:

1. reads the user's WC fixtures,
2. resolves Round-of-32 to real teams from the standings,
3. grounds group + R32 scores via Gemini (numbered 1000+matchId for KO),
4. computes standings, overlays verified (A), persists the singleton snapshot.

Triggered two ways — both go through the same engine:

- **Manual:** `POST /api/worldcup/scores` (signed-in user, the in-app refresh button).
- **Daily cron (A's automation):** `GET /api/worldcup/cron` at **07:00 UTC = 15:00 HKT**
  (`vercel.json`). Writes straight to the DB, so it goes live without a redeploy.

Deeper rounds (R16+) use "winner of match N" placeholders that can't be resolved
until earlier results propagate, so they are scored via the verified file only.

### Cron setup

Set in the deployment env:

- `CRON_SECRET` — Vercel Cron sends it as `Authorization: Bearer $CRON_SECRET`;
  other schedulers can use `?key=$CRON_SECRET`.
- `WORLDCUP_CRON_USER_EMAIL` — whose calendar the refresh reads (defaults to the
  owner of the earliest WC fixture).

Manual trigger: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/worldcup/cron`

## Precedence summary

```
verified file (A)  >  AI snapshot (B, manual or cron)  >  cache  >  null
```
