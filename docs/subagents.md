# Internal subagents and dormant workflows

This package provides a small, version-controlled subagent runtime without depending on `pi-subagents`. The static workflow prototype is retained in source for repair but is not registered or loaded by the package because live multi-child runs are not yet reliable.

## Tools

### `subagent`

Runs one fixed-role child Pi process or a bounded batch of independent read-only children.

```json
{
  "tasks": [
    { "id": "map", "agent": "scout", "task": "Map the authentication implementation" },
    { "id": "review", "agent": "reviewer", "task": "Review authentication error handling" }
  ],
  "concurrency": 2
}
```

Limits:

- At most 6 tasks per call.
- At most 3 children run concurrently.
- A `worker` must be the only task in its batch.
- Child working directories must resolve inside the current workspace.
- Runs are foreground and ephemeral.

### Dormant `workflow` prototype

`extensions/workflows.ts`, `extensions/workflows-core.ts`, the static graphs in `subagents/workflows-registry.ts`, and the three prompt templates remain version-controlled for future repair. They are intentionally absent from the package manifest, so Pi does not expose a `workflow` tool or `/review`, `/implement-review`, and `/research` templates.

For development only, the adapter can be loaded explicitly with `pi -e ./extensions/workflows.ts`. Do not treat that as a supported workflow until an opt-in live smoke test passes against the installed Pi version.

## Agent roles

| Role | Tools | Writes files? |
|---|---|---:|
| `scout` | `read,grep,find,ls,git_status,git_diff` | No |
| `reviewer` | `read,grep,find,ls,git_status,git_diff` | No |
| `worker` | `read,bash,edit,write` | Yes |
| `researcher` | `web_search,web_fetch` | No |
| `synthesizer` | `read,grep,find,ls,git_status,git_diff` | No |

Definitions and prompts are internal package resources. Project `.pi/agents` and `.agents` directories are never discovered.

The researcher explicitly loads only this package's `extensions/web.ts` and has no local read tool. Read-only coding roles explicitly load `extensions/subagent-tools.ts`, which supplies non-mutating `git_status` and `git_diff` tools. All other ambient extensions are disabled in children.

## Child isolation

Each child starts the current Pi executable with approximately:

```text
--mode json
--print
--no-session
--no-approve
--no-extensions
--no-skills
--no-prompt-templates
--no-themes
--extension <fixed role extension, when required>
--tools <role allowlist>
--model <parent model>
--append-system-prompt <0600 temporary role prompt>
```

Research children also use `--no-context-files` and explicitly load only `extensions/web.ts`. Coding roles retain normal `AGENTS.md`/`CLAUDE.md` context and the fixed read-only Git extension, but project settings, extensions, skills, prompts, and themes remain disabled.

The delegated task is stored in a mode-`0600` temporary file and attached with `@file`, keeping task text out of the process command line. Temporary files are removed after the child exits.

Children cannot invoke the local `subagent` or `workflow` tools because the orchestration extension is not loaded in child processes.

## Reliability behavior

- Pi JSONL is parsed incrementally across arbitrary stream chunks.
- Individual JSON events, stderr, final output, and workflow evidence are bounded.
- Cancellation sends `SIGTERM` to the child process group on macOS/Linux, then `SIGKILL` after a grace period.
- Every role has a timeout, capped globally at 30 minutes.
- Dormant workflow graphs are unit-tested for duplicate IDs, missing dependencies, cycles, step count, multiple writers, and failure propagation.
- Writer failures are never retried automatically because edits may already exist.
- Child usage is aggregated onto the tool result, allowing `extensions/ui.ts` to include it in session cost.

The dormant `implement-review` adapter records Git status before and after execution but never resets, reverts, commits, uploads, or automatically applies reviewer suggestions.

## Security and privacy

Subagent and workflow output is explicitly marked as untrusted model-generated evidence. Agent agreement is not proof; consequential claims require repository inspection and deterministic verification.

The runtime deliberately does not support:

- Session sharing or uploads.
- Background or scheduled jobs.
- Persistent child sessions.
- Project-defined agents or workflows.
- Arbitrary extensions or MCP imports.
- External CLI runners.
- Model-generated JavaScript workflows.
- Nested delegation.
- Automatic patch application or worktree deletion.

This is process isolation, not an OS sandbox. The `worker` has `bash` and therefore runs with the user's filesystem, environment, process, and network permissions. Use a container, VM, or other OS-level sandbox for untrusted repositories or unattended work.

Project context files are loaded by coding roles because they contain repository conventions, but Pi itself documents these files as an expected prompt-injection surface. Run the entire parent Pi session in a sandbox when repository content is untrusted.

## Source inspiration

The implementation was written locally and uses architectural patterns from:

- Pi's official subagent extension example: current-executable invocation and JSONL streaming.
- `nicobailon/pi-subagents` (MIT): child-process isolation, bounded concurrency, usage aggregation, and one-writer policy.
- `QuintinShaw/pi-dynamic-workflows` (MIT): deterministic fan-out/fan-in and keeping intermediate reports outside parent context.

No third-party package is vendored or installed, and no substantial source module was copied.

## Testing

Automated tests cover:

- Hermetic child arguments and static capability boundaries.
- JSONL parsing and usage aggregation.
- CWD and symlink escape rejection.
- Concurrency, timeout, and malformed-output handling.
- Static registry safety.
- Dormant workflow graph validation, failure propagation, writer serialization, and evidence bounds.
- Stable extension loading through the real Pi CLI without making a provider request.

Run:

```bash
npm run check
```

Before committing UI-related changes, also start Pi in an interactive TTY and verify collapsed/expanded rendering, cancellation, narrow terminals, and the compact status line. Live child smoke tests consume provider quota and should be run intentionally in a temporary repository.
