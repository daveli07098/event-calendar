@AGENTS.md

## Knowledge Vault

This repo shares the Obsidian collaboration vault at `~/git/obsidian-ai-collab-vault/`.

All routing rules (where to save research, drafts, fixes, memory, deliverables) are defined
**once** in the vault. Read and follow that contract — do not duplicate it here:

→ `~/git/obsidian-ai-collab-vault/_integration/agent-guide.md`

Set `project: event-calendar` frontmatter on any note you save to the vault.
`audience:` is always a YAML list (e.g. `[self]`, `[agent]`), never a bare string.
Confirm each save with one line: `Saved to vault: <relative-path>`.

Never write secrets into the vault except under `2-agent/secrets/` (git-ignored).

## Session Wrap

Follow the "Session Wrap — Changelog Workflow", Conventions, Tool Restrictions, and Safety
Rules defined in @AGENTS.md (included above) — they apply to Claude Code sessions verbatim.
