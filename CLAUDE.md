@AGENTS.md

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

## Session Wrap

Follow the "Session Wrap — Changelog Workflow", Conventions, Tool Restrictions, and Safety
Rules defined in @AGENTS.md (included above) — they apply to Claude Code sessions verbatim.
