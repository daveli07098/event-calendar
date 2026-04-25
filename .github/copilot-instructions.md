# Copilot Instructions

## Project Context

**event-calendar** — a Next.js 16 (App Router) event calendar app with Google Calendar sync.

**Tech stack:**
- Next.js 16.2 (App Router) with React 19
- TypeScript, Tailwind CSS v4, shadcn/ui
- Prisma 7 + PostgreSQL via `@prisma/adapter-pg` (docker-compose runs the DB on port 5432)
- NextAuth v5 (beta) — `src/lib/auth.ts`; JWT session strategy; Credentials + Google providers
- Custom calendar UI (no FullCalendar) — `CalendarView`, `DayDetailPanel`, `CalendarSidebar`
- Google Calendar API via `googleapis` — `src/lib/google-calendar.ts`
- pnpm workspace

**Key conventions:**
- App routes under `src/app/`, API routes under `src/app/api/`
- Shared UI components in `src/components/ui/` (shadcn)
- Server-side logic in `src/lib/`
- Types in `src/types/index.ts`
- **IMPORTANT:** This is Next.js 16 — APIs may differ from training data. Read
  `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

## Tool Restrictions

Allowed by default:
- read_file, list_dir, grep_search, file_search, semantic_search
- replace_string_in_file, multi_replace_string_in_file, create_file
- run_in_terminal (only when the task requires running commands)
- get_errors

Never invoke without explicit user request:
- Browser / web tools
- MCP server tools
- External API calls

## Auto-Commit Rule

**Commit immediately and automatically — without being asked — whenever:**
- A feature is fully implemented (new route, component, or behaviour works end-to-end)
- A bug or build error is fixed and verified
- A refactor or cleanup is complete
- Any source file is modified as the direct result of completing a user request

**How to commit:**
1. `git add` all modified/new source files related to the change
2. Write a conventional commit message: `feat:`, `fix:`, `refactor:`, `chore:` etc.
3. Append a one-line entry to `CHANGELOG.md` under the current dated session block:
   ```
   ## [YYYY-MM-DD] — Session: <topic>
   ### Added / Fixed / Changed / Maintenance
   - type(scope): description ([short-sha])
   ```
   Create a new dated block if today's date isn't already there.
4. Commit (local only — never push without explicit user request)

**Do NOT commit:**
- Mid-implementation (only on completion)
- Lock files or generated files alone (bundle with the feature commit)
- When the user is still iterating ("hmm, let me think…")

**Also run on these phrases:** "wrap up", "commit findings", "save and commit",
"update changelog", "log our changes", "write up what we did", "commit the fix".

## Safety

- Never `git push --force` without confirmation
- Never delete files or destructive DB operations without confirmation
- Local commits first; push on explicit request only
