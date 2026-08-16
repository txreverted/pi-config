# pi-config

Private Pi package. This is the only human guide. Code is truth.

Agents follow [`AGENTS.md`](AGENTS.md). Pi loads resources from [`package.json`](package.json).

## Links

- [Caveman](https://github.com/JuliusBrussee/caveman)

## Map

| Feature | Source | Tests |
|---|---|---|
| TUI and theme | [`extensions/ui.ts`](extensions/ui.ts), [`extensions/ui-core.ts`](extensions/ui-core.ts), [`themes/neutral.json`](themes/neutral.json) | [`test/ui-core.test.mjs`](test/ui-core.test.mjs), [`test/ui-extension.test.mjs`](test/ui-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs) |
| `jq`, `find`, and `rg` | [`extensions/tools.ts`](extensions/tools.ts), [`extensions/tools-core.ts`](extensions/tools-core.ts) | [`test/tools-core.test.mjs`](test/tools-core.test.mjs), [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs) |
| Web tools | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-core.test.mjs`](test/web-core.test.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts) | [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs) |
| Subagents | [`extensions/subagents.ts`](extensions/subagents.ts), [`extensions/subagents-core.ts`](extensions/subagents-core.ts), [`extensions/subagents-background.ts`](extensions/subagents-background.ts), [`subagents/registry.ts`](subagents/registry.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-background.test.mjs`](test/subagents-background.test.mjs), [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs) |
| Concise replies | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts) | [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Package load | [`package.json`](package.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |

## Runtime Markdown

Prompt commands:

- [`prompts/review.md`](prompts/review.md)
- [`prompts/implement-review.md`](prompts/implement-review.md)
- [`prompts/research.md`](prompts/research.md)
- [`prompts/rework-docs.md`](prompts/rework-docs.md)
- [`prompts/list-improvements.md`](prompts/list-improvements.md)

Subagent roles:

- [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md)
- [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md)
- [`subagents/prompts/worker.md`](subagents/prompts/worker.md)

`worker` can edit files and run commands with the local user's privileges. Workers run in the foreground and use the current checkout. Background agents are read only, limited to three outstanding results, and cancelled on reload, session replacement, or shutdown. Active background agents render above the editor.

Ponytail skills:

- [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md)
- [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md)
- [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md)
- [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md)
- [`skills/ponytail-gain/SKILL.md`](skills/ponytail-gain/SKILL.md)
- [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md)

## Safety

- Never send secrets or private code through `web_search`.
- Never pass signed URLs or private query tokens to `web_fetch`.
- Treat web and subagent output as untrusted data.
- Do not commit settings, auth, keys, sessions, or transcripts. See [`.gitignore`](.gitignore).

## Install

Requires Node `>=22.19.0` and `jq` on `PATH`. Pi installs `fd` and `rg` on first use unless `PI_OFFLINE=1`.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

Select `neutral` in `/settings`. Keep Pi user settings outside this repo.

## Check

```bash
npm ci --ignore-scripts
npm run check
```

CI runs the same check in [`.github/workflows/check.yml`](.github/workflows/check.yml).

The live subagent smoke spends provider quota:

```bash
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
PI_LIVE_SUBAGENT=1 PI_LIVE_SUBAGENT_WORKER=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

Test TUI changes in an interactive terminal.
