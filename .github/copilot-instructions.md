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

**If you edited or created any source file in this response → the FINAL action must be `git commit`. No exceptions. Do not end the response without committing.**

### Commit checklist (run in order, at the end of every response that touched a file):

```bash
# 1. Stage everything related to the change
git add <changed files>

# 2. Commit with conventional message
git commit -m "type(scope): description"

# 3. Get the short SHA and append to CHANGELOG.md
git rev-parse --short HEAD
```

### CHANGELOG format — always use dated session blocks:
```markdown
## [YYYY-MM-DD] — Session: <topic>
### Added / Fixed / Changed / Maintenance
- type(scope): what changed ([short-sha])
```
Create a new `## [YYYY-MM-DD]` block if today's date isn't already there. Then `git add CHANGELOG.md && git commit --amend --no-edit` (or a separate `chore: update CHANGELOG` commit).

### What triggers a commit:
- Any `replace_string_in_file`, `multi_replace_string_in_file`, or `create_file` call was made
- A feature implementation is complete (even if other unrelated work is still pending)
- A bug fix is applied and verified
- That's it — file touched or logical unit done = commit. No other judgment required.

### Ordering — commit BEFORE writing the summary text:
The commit step must execute **before** producing the final explanation paragraph.
Correct order per response:
1. Make the code change (replace_string_in_file / create_file)
2. `get_errors` to verify
3. `git add` + `git commit` + update CHANGELOG + `git commit --amend --no-edit`
4. **Then** write the explanation to the user

This ordering prevents short/simple fixes from "accidentally" finishing the response
before the commit checklist runs. If step 4 is reached without step 3 having run,
something went wrong — go back and commit before sending the reply.

### What does NOT trigger a commit:
- Response was read-only (searches, reads, explanations only)
- User explicitly says "don't commit yet"

### Never:
- Skip a commit because "more work is coming later" — commit each logical unit as it finishes
- `git push` without explicit user request
- `git push --force` without confirmation
- Delete files or run destructive DB operations without confirmation

## Knowledge Vault

All research, drafts, and persistent memory for this project go into the Obsidian vault at
`/Users/daveli/git/obsidian-ai-collab-vault/`. Route content automatically using the table
below — do not ask the user where to save, and do not require explicit vault paths in prompts.

| Content type | Save to |
|---|---|
| Web research, summaries, findings | `ai-workspace/research/YYYY-MM-DD-<slug>.md` |
| WIP thinking, scratch, exploratory | `ai-workspace/drafts/<slug>.md` |
| Bug fix — root cause, solution, prevention | `ai-workspace/fix/YYYY-MM-DD-<slug>.md` |
| Feature implementation notes & decisions | `ai-workspace/implement/YYYY-MM-DD-<slug>.md` |
| User-requested documentation | `ai-workspace/docs/YYYY-MM-DD-<slug>.md` |
| Persistent facts about this project | `ai-workspace/memory/projects/event-calendar.md` |
| Finished deliverables for human review | `review/inbox/YYYY-MM-DD-<slug>.md` |

Rules:
- Base path: `/Users/daveli/git/obsidian-ai-collab-vault/`
- Use `integration/templates/note-template.md` as the base for all new notes if it exists.
- Set `project: event-calendar` in frontmatter.
- Never write to `review/approved/` — human domain only.
- Never store secrets in the vault except under `ai-workspace/memory/secrets/` (git-ignored).
- Confirm each save with one line: "Saved to vault: `<relative-path>`"
