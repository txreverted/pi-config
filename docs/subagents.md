# Internal subagents and workflows

This package provides a small, version-controlled subagent runtime without depending on `pi-subagents` or a dynamic workflow package.

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

### `workflow`

Runs one trusted workflow selected by name:

- `review`: scout, two independent read-only reviewers, synthesis.
- `implement-review`: scout, exactly one writer, two fresh read-only reviewers, synthesis.
- `research`: two independent public-web researchers, synthesis.

```json
{
  "name": "review",
  "objective": "Review the current working tree for correctness and security",
  "paths": ["src", "test"]
}
```

Workflow graphs live in `subagents/registry.ts`. The caller cannot provide code, graph definitions, arbitrary system prompts, tools, extensions, or external commands.

Native prompt templates are available as `/review`, `/implement-review`, and `/research`.

## Agent roles

| Role | Tools | Writes files? |
|---|---|---:|
| `scout` | `read,grep,find,ls` | No |
| `reviewer` | `read,grep,find,ls` | No |
| `worker` | `read,bash,edit,write` | Yes |
| `researcher` | `read,web_search,web_fetch` | No |
| `synthesizer` | `read,grep,find,ls` | No |

Definitions and prompts are internal package resources. Project `.pi/agents` and `.agents` directories are never discovered.

The researcher explicitly loads this package's `extensions/web.ts`; all other ambient extensions are disabled in children.

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
--tools <role allowlist>
--model <parent model>
--append-system-prompt <0600 temporary role prompt>
```

Research children also use `--no-context-files` and explicitly load only `extensions/web.ts`. Coding roles retain normal `AGENTS.md`/`CLAUDE.md` context, but project settings, extensions, skills, prompts, and themes remain disabled.

The delegated task is stored in a mode-`0600` temporary file and attached with `@file`, keeping task text out of the process command line. Temporary files are removed after the child exits.

Children cannot invoke the local `subagent` or `workflow` tools because the orchestration extension is not loaded in child processes.

## Reliability behavior

- Pi JSONL is parsed incrementally across arbitrary stream chunks.
- Individual JSON events, stderr, final output, and workflow evidence are bounded.
- Cancellation sends `SIGTERM` to the child process group on macOS/Linux, then `SIGKILL` after a grace period.
- Every role has a timeout, capped globally at 30 minutes.
- Workflow graphs are validated for duplicate IDs, missing dependencies, cycles, step count, and multiple writers.
- A stopping step failure skips pending work; designated independent review/research failures may continue to synthesis.
- Writer failures are never retried automatically because edits may already exist.
- Child usage is aggregated onto the tool result, allowing `extensions/ui.ts` to include it in session cost.

`implement-review` records Git status before and after execution but never resets, reverts, commits, uploads, or automatically applies reviewer suggestions.

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
- Workflow graph validation, failure propagation, writer serialization, and evidence bounds.

Run:

```bash
npm test
```

Before committing UI-related changes, also start Pi in an interactive TTY and verify collapsed/expanded rendering, cancellation, narrow terminals, and the compact status line. Live child smoke tests consume provider quota and should be run intentionally in a temporary repository.
