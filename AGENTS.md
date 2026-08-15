# Pi Config — Agent Rules

Read [`README.md`](README.md) first. Then inspect code and tests. Code wins.

## Work

- Keep change small. Keep extension focused.
- Preserve dirty user changes. Never reset or overwrite them.
- Read installed Pi docs and examples before changing extensions, prompts, themes, or TUI.
- Do not touch `node_modules/`.
- Never commit auth, keys, env files, settings, sessions, or transcripts.
- Run `npm run check` after code or prompt changes.
- Test UI changes in an interactive TTY.

## Docs

- `README.md` is the one human guide.
- Do not add another guide unless one file becomes unsafe or hard to use.
- Write present facts only. No roadmap. No planned behavior. No stale history.
- Link to source and tests. Do not copy large code details.
- `prompts/*.md` and `subagents/prompts/*.md` are runtime code. Keep one file per command or role. Change manifest, registry, and tests together when needed.
