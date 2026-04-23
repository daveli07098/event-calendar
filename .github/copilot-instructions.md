# Copilot Instructions

## Project Context

**event-calendar** — a Next.js 16 (App Router) event calendar app with Google Calendar sync.

**Tech stack:**
- Next.js 16.2 (App Router) with React 19
- TypeScript, Tailwind CSS v4, shadcn/ui
- Prisma 7 + SQLite (dev) via `prisma.config.ts`
- NextAuth v5 (beta) — `src/lib/auth.ts`
- FullCalendar 6 — `@fullcalendar/react`, daygrid, timegrid, list
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

## Session Wrap — Changelog Workflow

After any non-trivial session (debug, fix, feature, refactor, research, or findings):

1. Evaluate what changed or was discovered
2. Commit all modified source files with a conventional commit message
3. Append an entry to `CHANGELOG.md` in Keep a Changelog format

**Trigger phrases (run without asking):** "wrap up", "commit findings", "save and commit",
"update changelog", "log our changes", "write up what we did", "commit the fix".

## Safety

- Never `git push --force` without confirmation
- Never delete files or destructive DB operations without confirmation
- Local commits first; push on explicit request only
