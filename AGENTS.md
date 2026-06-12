<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Knowledge Vault

All research, drafts, and persistent memory for this project go into the Obsidian vault at
`/Users/daveli/git/obsidian-ai-collab-vault/`. Route content automatically using the table
below — do not ask the user where to save, and do not require explicit vault paths in prompts.

| Content type | Save to |
|---|---|
| Web research, summaries, findings | `ai-workspace/research/YYYY-MM-DD-<slug>.md` |
| WIP thinking, scratch, exploratory | `ai-workspace/drafts/<slug>.md` |
| Persistent facts about this project | `ai-workspace/memory/projects/event-calendar.md` |
| Finished deliverables for human review | `review/inbox/YYYY-MM-DD-<slug>.md` |

Rules:
- Base path: `/Users/daveli/git/obsidian-ai-collab-vault/`
- Use `integration/templates/note-template.md` as the base for all new notes if it exists.
- Set `project: event-calendar` in frontmatter.
- Never write to `review/approved/` — human domain only.
- Never store secrets in the vault except under `ai-workspace/memory/secrets/` (git-ignored).
- Confirm each save with one line: "Saved to vault: `<relative-path>`"

## Session Wrap — Changelog Workflow

After any non-trivial session, automatically run the session-wrap workflow:

1. Identify what was produced: source changes, configs, discoveries, or procedures.
2. Stage and commit source changes using conventional commits.
3. Write `docs/<topic>.md` for reusable findings or procedures.
4. Append to `CHANGELOG.md` using Keep a Changelog format (create if absent).

**Trigger phrases (run without asking):** "wrap up", "commit findings", "save and commit",
"update changelog", "log our changes", "write up what we did", "commit the fix", "record this change".

### Changelog format — dated session blocks

```markdown
## [YYYY-MM-DD] — Session: <topic>
### Added / Fixed / Changed / Maintenance
- type(scope): what changed ([short-sha])
```

Create a new `## [YYYY-MM-DD]` block if today's date isn't already there.

## Conventions

- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- One commit per logical change
- Keep a Changelog format for CHANGELOG.md
- `docs/` for reusable guides; `docs/adr-*.md` for architecture decisions

## Tool Restrictions

Minimal permissions — default deny, explicit allow.

Allowed by default:
- File read/write/search tools
- Terminal commands (only when the task requires it)
- Git operations

Require explicit user request:
- Browser / web tools
- MCP server tools
- Network / external API calls

## Safety Rules

- Never force-push without explicit confirmation
- Never delete files or destructive DB operations without confirmation
- Local commits first; push on explicit request only
