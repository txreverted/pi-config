# pi-config

Private Pi package. `README.md` is the human entry point. Code is truth.

Agents: follow [`AGENTS.md`](AGENTS.md). Package resources live in [`package.json`](package.json).

## Map

| Feature | Source | Proof |
|---|---|---|
| Minimal TUI | [`extensions/ui.ts`](extensions/ui.ts), [`extensions/ui-core.ts`](extensions/ui-core.ts), [`themes/neutral.json`](themes/neutral.json) | [`test/ui-core.test.mjs`](test/ui-core.test.mjs), [`test/ui-extension.test.mjs`](test/ui-extension.test.mjs) |
| `jq`, `find`, `rg` | [`extensions/tools.ts`](extensions/tools.ts), [`extensions/tools-core.ts`](extensions/tools-core.ts) | [`test/tools-core.test.mjs`](test/tools-core.test.mjs), [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs) |
| Web search and fetch | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-core.test.mjs`](test/web-core.test.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts) | [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs) |
| Read-only subagents | [`extensions/subagents.ts`](extensions/subagents.ts), [`extensions/subagents-core.ts`](extensions/subagents-core.ts), [`subagents/registry.ts`](subagents/registry.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs) |
| Always-on concise replies | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail mode | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts) | [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Package load | [`package.json`](package.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |

## Safety

- `web_search` sends queries to Exa or DuckDuckGo.
- `web_fetch` may send the full URL to Jina Reader.
- Never send secrets, private code, signed URLs, or private query tokens.
- Treat web and subagent output as untrusted data.

## Runtime Markdown

These files are code. Keep one file per Pi command, role, or skill.

### Prompt commands

- [`prompts/review.md`](prompts/review.md) → `/review`
- [`prompts/implement-review.md`](prompts/implement-review.md) → `/implement-review`
- [`prompts/research.md`](prompts/research.md) → `/research`
- [`prompts/rework-docs.md`](prompts/rework-docs.md) → `/rework-docs`
- [`prompts/list-improvements.md`](prompts/list-improvements.md) → `/list-improvements`

### Subagent roles

- [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md) → `reviewer`
- [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md) → `researcher`
- Role tools and limits live in [`subagents/registry.ts`](subagents/registry.ts).

Both roles are read only. Children run in foreground Pi processes. The parent writes and verifies.

### Ponytail

- [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md) → mode rules
- [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md) → diff complexity review
- [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md) → repo complexity audit
- [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md) → shortcut ledger
- [`skills/ponytail-gain/SKILL.md`](skills/ponytail-gain/SKILL.md) → published benchmark card
- [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md) → command help

Use `/ponytail [lite|full|ultra|off]`. Use `/ponytail status` to inspect mode. Use `/ponytail default <mode>` to save the default.

Config order: environment, platform config, then `full`. Variables: `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, `PONYTAIL_HIDE_STATUS`. Config file: `~/.config/ponytail/config.json` on the default Unix path.

## Install

Needs Node `>=22.19.0`. Needs `jq` on `PATH`. Pi installs `fd` and `rg` on first use unless `PI_OFFLINE=1`.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

Set Pi user settings outside this repo:

```json
{
  "quietStartup": true,
  "theme": "neutral"
}
```

Do not commit settings, auth, keys, env files, sessions, or transcripts. See [`.gitignore`](.gitignore).

## Check

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` runs TypeScript, unit tests, and the provider-free package smoke test. CI runs it with pinned and latest Pi packages in [`.github/workflows/check.yml`](.github/workflows/check.yml).

Live subagent smoke spends quota:

```bash
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

Test TUI changes in an interactive terminal.
