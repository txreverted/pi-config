# Agent Rules

Use [`README.md`](README.md) as the repo map. Then read code and tests. Code wins.

## Work

- Keep the diff small.
- Keep dirty user changes.
- Never reset the checkout.
- Never edit `node_modules/`.
- Never commit secrets, auth, settings, sessions, or transcripts.
- Before Pi extension, prompt, skill, theme, or TUI changes, read the installed Pi docs and examples.
- After code or prompt changes, run `npm run check`.
- Test TUI changes in an interactive terminal.

## Markdown

- `README.md` is the only human guide.
- `AGENTS.md` holds agent rules.
- `prompts/*.md`, `subagents/prompts/*.md`, and `skills/*/SKILL.md` are runtime code.
- Keep one file per command, role, or skill.
- Write present facts. No roadmap. No history.
- Use short sentences and exact paths.
- Link to source and tests. Do not copy implementation detail.
