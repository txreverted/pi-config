# Internal subagents and workflows

This package provides a small, version-controlled orchestration runtime without depending on `pi-subagents` or executing model-generated JavaScript. `extensions/orchestration.ts` is the single package entrypoint so subagent, workflow, control, command, and UI registrations share one runtime. It exposes focused foreground subagents, durable background workflows, live timing and health, and a bounded declarative workflow DAG.

## Tools and commands

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
- Runs are foreground and cancellation terminates the child process group.

### Child thinking policy

Child reasoning effort never inherits the parent session's thinking level. The fixed role is the default task classifier:

| Role/task class | Thinking |
|---|---|
| `scout` code mapping | `low` |
| `researcher` source gathering | `low` |
| `reviewer` correctness review | `high` |
| `worker` bounded implementation | `high` |
| `synthesizer` evidence reconciliation | `high` |
| Trusted workflow security review | `high` |

Trusted workflow steps may make a narrower version-controlled override; `security-review` is explicitly pinned to `high`. Declarative workflows use the fixed role defaults and cannot request more reasoning. No role or workflow step requests `xhigh` or `max`. If the selected model does not support reasoning, the child is launched with `off` instead. Changing the parent's `/thinking` setting therefore does not change child effort or workflow journal identity.

### `workflow`

Runs one trusted built-in graph or a bounded declarative graph. Workflows use a detached private host by default, so Pi remains responsive and the workflow can continue across `/reload` or a Pi restart.

Built-ins:

- `review`: scout, two fresh read-only reviews, then synthesis.
- `implement-review`: scout, exactly one writer, two fresh reviews, then synthesis.
- `research`: two independent web passes, then synthesis.

```json
{
  "name": "review",
  "objective": "Review authentication for correctness and security",
  "paths": ["src/auth"],
  "background": true
}
```

`/review`, `/implement-review`, and `/research` prompt templates are loaded by the package.

### Run management

- `/runs` opens the run inspector with live status, elapsed time, tool activity, recent protocol events, output tail, stop, and safe retry actions.
- `/orchestration-doctor` checks Node/Pi availability, private state, fixed roles, workflow graphs, model selection, and active-run health without a provider request.
- `orchestration_control` provides `list`, `status`, `stop`, `retry`, and `doctor` to the parent model.

Read-only workflows that fail, abort, time out, or complete with warnings can be retried; clean completions are not offered as retries. Retry journals reuse only the longest unchanged successful prefix. Input hashes cover the engine version, role prompt/tools/routing, literal task, objective, paths, and dependency evidence; the first failed, missing, or changed step and every later step execute live. Writer workflows are never automatically retried or journal-replayed.

## Live timing and health

One UI tick updates elapsed times every second. A separate deterministic sweep checks persisted workflow hosts every five seconds. Child protocol events—not UI ticks—update activity freshness.

Each run records queued/start/end times, spawn acknowledgement, first and latest Pi JSON events, current tool and tool start, attempts, turns, tool calls, reported usage, and the last 40 metadata-only lifecycle events. Tool arguments/results and provider thinking deltas are not persisted.

Default health transitions:

| Evidence | State/action |
|---|---|
| No OS spawn acknowledgement within 5 seconds | Fail the attempt |
| No valid Pi JSON event within 20 seconds | Startup failure |
| No activity for 30 seconds | `quiet` (informational) |
| No activity for 2 minutes | `long-running` warning |
| No activity for 5 minutes | `needs attention`, notified once |
| Verified host/child exit | Fail with bounded diagnostics |
| Role deadline | Process-group termination |

Silence alone never kills a process. A read-only child may retry once only after a verified startup/transient failure. Writers never retry automatically.

## Read-only runaway budgets

In addition to elapsed deadlines, fixed read-only roles have hard turn, tool-call, reported-token, and reported-cost limits. These prevent a tool loop from consuming a full role timeout. They are checked from Pi's protocol after each event.

| Role | Turns | Tool calls | Reported tokens | Reported cost |
|---|---:|---:|---:|---:|
| `scout` | 16 | 48 | 750k | $1.00 |
| `reviewer` | 24 | 72 | 1.5M | $1.50 |
| `researcher` | 16 | 32 | 750k | $1.00 |
| `synthesizer` | 16 | 48 | 1M | $1.50 |

These are fallback safety bounds, not spend guarantees: providers report usage at different times and concurrent requests may finish before an abort is observed. `worker` deliberately has no hard turn/tool/token/cost budget because interrupting mutation based on those counters is unsafe; it remains bounded by one narrow task and its elapsed deadline.

## Agent roles

| Role | Tools | Writes files? |
|---|---|---:|
| `scout` | `read,grep,find,ls,git_status,git_diff` | No |
| `reviewer` | `read,grep,find,ls,git_status,git_diff` | No |
| `worker` | `read,bash,edit,write` | Yes |
| `researcher` | `web_search,web_fetch` | No |
| `synthesizer` | `read,grep,find,ls,git_status,git_diff` | No |

Definitions and prompts are internal package resources. Project `.pi/agents` and `.agents` directories are never discovered. Children cannot invoke `subagent`, `workflow`, or `orchestration_control` because ambient extensions are disabled.

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

Research children also use `--no-context-files` and load only `extensions/web.ts`. Coding roles retain repository context files and the fixed read-only Git extension. The delegated task is stored in a mode-`0600` temporary file rather than the process command line and is removed on exit.

This is process isolation, not an OS sandbox. In particular, `worker` has `bash` and inherits the user's operating-system permissions and environment.

## Background workflow state

Background workflows run in `extensions/workflow-host.ts`. The parent passes only a private config-file path on the host command line. Config and state live under:

```text
~/.pi/agent/orchestration-runs/<run-id>/
```

Directories use mode `0700`; JSON files use `0600` and atomic replacement. An exclusive per-run lease prevents a second host from executing the same config. State includes the objective, bounded intermediate/final outputs, usage, timing, and lifecycle metadata, so it may contain private source-derived text. Terminal runs are retained for at most 7 days and the newest 30 records, then removed.

Before signaling a persisted PID, the runtime verifies that its command belongs to the expected `workflow-host.ts` and exact private config path. A stale PID is never signaled solely because it appears in state.

Completion is delivered once to the originating Pi session and includes reported tokens/cost. Background usage cannot be attached retroactively to Pi's parent tool-result footer total, so `/runs` and the completion message are authoritative for that usage. The runtime checks both the persisted delivery marker and existing session messages to avoid duplicate delivery after reload. If Pi is closed, the detached host completes and delivery occurs when that session is opened again.

## Bounded declarative workflows

A dynamic workflow is data, not code:

```json
{
  "spec": {
    "version": 1,
    "name": "targeted-review",
    "outputStep": "synthesis",
    "steps": [
      {
        "id": "scan",
        "agent": "scout",
        "phase": "Map",
        "task": "Map the relevant code"
      },
      {
        "id": "synthesis",
        "agent": "synthesizer",
        "phase": "Synthesize",
        "task": "Produce the final report",
        "needs": ["scan"],
        "include": ["scan"]
      }
    ]
  },
  "objective": "Review the request",
  "background": true
}
```

The interpreter supports dependency-driven sequence, parallel fan-out, pipelines, and fan-in through ordinary DAG edges. References are explicit: `include` may contain only completed dependencies listed in `needs`, and their output is appended inside an untrusted-evidence boundary.

Safety rules:

- Version 1 allows 1–8 steps and fixed internal roles only.
- IDs, dependencies, output step, cycles, unknown fields, and writer count are validated before launch.
- Exactly one writer is allowed. Every writer workflow requires `allowWrite: true` and explicit user authorization; TUI runs ask for confirmation. Declarative writers are refused headlessly.
- No `eval`, `Function`, VM, imports, shell, filesystem API, network API, timestamps, randomness, nested workflows, or arbitrary expressions exist in the workflow language.
- Built-in and declarative workflows use the same scheduler, health model, evidence boundaries, and one-writer policy.

Quality panels and bounded loops can be expressed explicitly as a finite set of reviewer/synthesizer nodes. Unbounded loops and runtime-generated fan-out are intentionally unsupported.

## Failure and cancellation semantics

- Malformed or oversized JSONL fails strictly; bounded later output may be retained for diagnostics.
- Cancellation sends `SIGTERM`, then `SIGKILL` after a grace period.
- Background stop first verifies host ownership. The host aborts its active child and records terminal state; a still-verified host is escalated after five seconds.
- A `continue` step failure produces `completed_with_warnings` if the output step succeeds.
- A `stop` failure skips remaining work and cannot reuse an earlier step as final output.
- `implement-review` records Git status before and after but never resets, reverts, commits, uploads, or applies reviewer suggestions automatically.

All child and workflow output is untrusted model-generated evidence. Agent agreement is not proof; consequential claims require repository inspection and deterministic verification.

## Testing

`npm run check` runs strict TypeScript, deterministic tests, and real Pi extension/theme loading without a provider request. Tests use fake child processes and startup/timeout deadlines measured in milliseconds; they do not wait for production role timeouts.

Coverage includes protocol chunking, timing, activity metadata, thinking-delta privacy, startup retry, runaway budgets, malformed output, cancellation, symlink/CWD escape rejection, private atomic state, an independently spawned background host, exactly-once result delivery, DAG validation, writer serialization, journal replay, and workflow failure propagation.

Live smoke tests consume provider quota and are opt-in:

```bash
PI_LIVE_ORCHESTRATION=1 npm run test:live-orchestration
PI_LIVE_ORCHESTRATION=1 PI_LIVE_WORKFLOW=1 npm run test:live-orchestration
```

The single-child and minimal three-step live probes each use 20-second child deadlines plus tiny turn/tool/token/cost caps. If the configured provider cannot finish one no-tool turn inside 20 seconds, the probe accepts only a valid protocol handshake plus bounded timeout cleanup and skips the multi-child provider run. Otherwise the live workflow checks two parallel startups and one synthesis. Deterministic fake-host tests always cover the complete built-in review graph. Do not replace deterministic timeout tests with broad live reviews.
