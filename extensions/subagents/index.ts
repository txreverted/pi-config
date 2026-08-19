import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CONCISE_RESPONSE_POLICY } from "../concise.ts";
import { CONFIG_EVENTS, restoreCoordinatedTodoSnapshot, type SubagentProgressEvent } from "../coordination-core.ts";
import { PONYTAIL_INSTRUCTIONS } from "../ponytail.ts";
import {
  claimTodoDelegations,
  copyTodoSnapshot,
  emptyTodoSnapshot,
  updateTodoDelegation,
  validateTodoSnapshot,
} from "../todo-core.ts";
import { escapeUnsafeDisplayText, normalizeDisplayText, safeDisplayText } from "../text-safety.ts";
import {
  aggregateUsage,
  buildContextPacket,
  emptyUsage,
  mapConcurrent,
  normalizeAgentWave,
  SUBAGENT_LIMITS,
  type AgentProgress,
  type AgentRunResult,
  type AgentTask,
  type AgentWaveInput,
  type ParallelAgentsDetails,
} from "./core.ts";
import { ROLE_DEFINITIONS, type ThinkingLevel } from "./roles.ts";
import { runChildAgent } from "./runner.ts";
import { formatAgentResults, renderAgents } from "./ui.ts";
import {
  applyWorkerPatch,
  createWorkerWorkspace,
  discardWorkerWorkspace,
  inspectWorkerPatch,
  listWorkerWorkspaces,
  recoverWorkerWorkspace,
  type WorkerWorkspace,
} from "./worktree.ts";

const TASK_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$";
const THINKING_LEVELS = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const AgentTaskSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80, pattern: TASK_ID_PATTERN }),
  role: StringEnum(["explorer", "worker", "reviewer"] as const),
  title: Type.String({ minLength: 1, maxLength: 80 }),
  objective: Type.String({ minLength: 1, maxLength: SUBAGENT_LIMITS.taskChars }),
  todoId: Type.Optional(Type.Integer({ minimum: 1 })),
  context: Type.Optional(Type.String({ maxLength: SUBAGENT_LIMITS.contextChars })),
  contextFiles: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { maxItems: SUBAGENT_LIMITS.contextFiles })),
  acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: SUBAGENT_LIMITS.criterionChars }), { minItems: 1, maxItems: SUBAGENT_LIMITS.criteria }),
  writeScope: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { maxItems: SUBAGENT_LIMITS.scopes })),
  model: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  thinking: Type.Optional(StringEnum(THINKING_LEVELS)),
}, { additionalProperties: false });

const ParallelAgentsSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  tasks: Type.Array(AgentTaskSchema, { minItems: 2, maxItems: SUBAGENT_LIMITS.tasks }),
  maxConcurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: SUBAGENT_LIMITS.concurrency })),
}, { additionalProperties: false });

const AgentPatchSchema = Type.Object({
  action: StringEnum(["inspect", "apply", "discard"] as const),
  runId: Type.String({ minLength: 1, maxLength: 80, pattern: TASK_ID_PATTERN }),
  taskId: Type.String({ minLength: 1, maxLength: 80, pattern: TASK_ID_PATTERN }),
  expectedHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: DEFAULT_MAX_BYTES - 1_000 })),
}, { additionalProperties: false });

function resolveModel(ctx: ExtensionContext, task: AgentTask) {
  if (!ctx.model) throw new Error("parallel_agents requires a selected parent model");
  if (!task.model) return ctx.model;
  const available = ctx.modelRegistry.getAvailable();
  const exact = available.filter((model) => `${model.provider}/${model.id}` === task.model);
  const byId = available.filter((model) => model.id === task.model);
  const candidates = exact.length ? exact : byId;
  if (candidates.length !== 1) throw new Error(`Task '${task.id}' model '${task.model}' is unavailable or ambiguous`);
  const model = candidates[0]!;
  if (ctx.scopedModels.length && !ctx.scopedModels.some((entry) => entry.model.provider === model.provider && entry.model.id === model.id)) {
    throw new Error(`Task '${task.id}' model is outside the current scoped models`);
  }
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`Task '${task.id}' model has no configured authentication`);
  return model;
}

function resolveThinking(ctx: ExtensionContext, task: AgentTask, reasoning: boolean): ThinkingLevel {
  if (!reasoning) return "off";
  if (task.thinking === "inherit") return ctx.thinkingLevel ?? ROLE_DEFINITIONS[task.role].thinking;
  return task.thinking ?? ROLE_DEFINITIONS[task.role].thinking;
}

function copyProgress(progress: readonly AgentProgress[]): AgentProgress[] {
  return progress.map((task) => ({ ...task, usage: { ...task.usage, cost: { ...task.usage.cost } } }));
}

function patchKey(runId: string, taskId: string): string {
  return `${runId}\0${taskId}`;
}

function isUtf8Continuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

export function formatPatchPage(patch: string, requestedOffset: number, requestedLimit: number): {
  text: string;
  offset: number;
  nextOffset?: number;
} {
  const bytes = Buffer.from(patch, "utf8");
  if (requestedOffset > bytes.length) throw new Error(`Patch offset exceeds ${bytes.length} bytes`);
  let offset = requestedOffset;
  while (offset > 0 && isUtf8Continuation(bytes[offset])) offset--;
  let end = Math.min(bytes.length, Math.max(offset, requestedOffset + requestedLimit));
  while (end < bytes.length && isUtf8Continuation(bytes[end])) end++;

  const render = (pageEnd: number) => {
    const page = bytes.subarray(offset, pageEnd).toString("utf8");
    const alignment = offset === requestedOffset ? "" : ` Requested offset ${requestedOffset} aligned to UTF-8 byte ${offset}.`;
    return `SECURITY NOTICE: Worker patches are untrusted. Showing bytes ${offset}-${pageEnd} of ${bytes.length}.${alignment}\n\n${escapeUnsafeDisplayText(page)}`;
  };
  let text = render(end);
  while (end > offset && (Buffer.byteLength(text, "utf8") > DEFAULT_MAX_BYTES || text.split("\n").length > DEFAULT_MAX_LINES)) {
    end = offset + Math.floor((end - offset) / 2);
    while (end > offset && isUtf8Continuation(bytes[end])) end--;
    text = render(end);
  }
  if (end === offset && offset < bytes.length) {
    end++;
    while (end < bytes.length && isUtf8Continuation(bytes[end])) end++;
    text = render(end);
  }
  return {
    text,
    offset,
    ...(end < bytes.length ? { nextOffset: end } : {}),
  };
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  if (process.env.PI_CONFIG_SUBAGENT_CHILD === "1") return;
  let todoSnapshot = emptyTodoSnapshot();
  const retained = new Map<string, WorkerWorkspace>();
  const shutdown = new AbortController();

  pi.events.on(CONFIG_EVENTS.todoSnapshot, (value) => {
    try { todoSnapshot = validateTodoSnapshot(value); } catch {}
  });

  pi.registerTool({
    name: "parallel_agents",
    label: "Agents",
    description: "Run 2-6 substantial independent explorer, worker, or reviewer tasks as one bounded foreground parallel wave. Workers use isolated Git worktrees, require non-overlapping write scopes, and return patches for parent inspection. Use only when parallelism reduces wall time.",
    promptSnippet: "Run independent explorer, worker, or reviewer tasks concurrently in isolated contexts",
    promptGuidelines: [
      "Use parallel_agents only when at least two substantial tasks are ready and independent; keep singleton or dependent work in the parent.",
      "Use parallel_agents workers only with narrow non-overlapping writeScope values and without sibling mutation tools; the parent must inspect patches, integrate them, and run final checks.",
      "The parent remains responsible for clarification, todo completion, final verification, and the user-facing answer.",
    ],
    parameters: ParallelAgentsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const current = restoreCoordinatedTodoSnapshot(ctx.sessionManager.getBranch());
      if (current.tasks.length || !todoSnapshot.tasks.length) todoSnapshot = current;
      const runId = randomUUID();
      const wave = normalizeAgentWave(params as AgentWaveInput, todoSnapshot);
      const workspaceRoot = await realpath(ctx.cwd);
      const resolved = wave.tasks.map((task) => {
        const model = resolveModel(ctx, task);
        return {
          task,
          model: `${model.provider}/${model.id}`,
          thinking: resolveThinking(ctx, task, model.reasoning),
        };
      });
      if (wave.tasks.some((task) => task.role === "worker") && !ctx.isProjectTrusted()) {
        throw new Error("Workers require a trusted Git project");
      }

      const workspaces = new Map<string, WorkerWorkspace>();
      try {
        for (const task of wave.tasks) {
          if (task.role !== "worker") continue;
          const workspace = await createWorkerWorkspace(workspaceRoot, runId, task.id, task.writeScope);
          workspaces.set(task.id, workspace);
        }
      } catch (error) {
        await Promise.allSettled([...workspaces.values()].map(discardWorkerWorkspace));
        throw error;
      }

      const claims = wave.tasks.flatMap((task) => task.todoId === undefined ? [] : [{ todoId: task.todoId, runId, taskId: task.id, role: task.role }]);
      try {
        todoSnapshot = claimTodoDelegations(todoSnapshot, claims);
      } catch (error) {
        await Promise.allSettled([...workspaces.values()].map(discardWorkerWorkspace));
        throw error;
      }
      pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));

      const progress: AgentProgress[] = resolved.map(({ task, model, thinking }) => ({
        id: task.id,
        role: task.role,
        title: task.title,
        ...(task.todoId === undefined ? {} : { todoId: task.todoId }),
        status: "queued",
        toolCalls: 0,
        turns: 0,
        usage: emptyUsage(),
        model,
        thinking,
      }));
      const results = new Array<AgentRunResult | undefined>(wave.tasks.length);
      const details = (): ParallelAgentsDetails => ({
        runId,
        title: wave.title,
        progress: copyProgress(progress),
        results: results.flatMap((result) => result ? [result] : []),
        usage: aggregateUsage(progress.map((task) => task.usage)),
        todoSnapshot: copyTodoSnapshot(todoSnapshot),
      });
      const publish = () => {
        const value = details();
        onUpdate?.({ content: [{ type: "text", text: `Agents: ${value.progress.filter((task) => ["succeeded", "failed", "blocked", "cancelled"].includes(task.status)).length}/${value.progress.length} completed` }], details: value });
        const event: SubagentProgressEvent = { runId, tasks: value.progress.map((task) => ({
          runId,
          taskId: task.id,
          ...(task.todoId === undefined ? {} : { todoId: task.todoId }),
          role: task.role,
          status: task.status,
          ...(task.activity ? { activity: task.activity } : {}),
        })) };
        pi.events.emit(CONFIG_EVENTS.subagentProgress, event);
      };
      publish();

      const abortSignal = signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal;
      const completed = await mapConcurrent(resolved, wave.maxConcurrency, async ({ task, model, thinking }, index) => {
        const workspace = workspaces.get(task.id);
        let delegationRunning = false;
        const failed = (message: string): AgentRunResult => ({
          ...progress[index]!,
          status: abortSignal.aborted ? "cancelled" : "failed",
          activity: abortSignal.aborted ? "cancelled" : "failed",
          startedAt: progress[index]!.startedAt ?? Date.now(),
          endedAt: Date.now(),
          objective: task.objective,
          error: safeDisplayText(message).slice(0, SUBAGENT_LIMITS.resultBytes),
          changedFiles: [],
        });
        let result: AgentRunResult;
        try {
          if (abortSignal.aborted) {
            result = failed("Subagent was cancelled before launch");
          } else if (aggregateUsage(progress.map((entry) => entry.usage)).totalTokens >= SUBAGENT_LIMITS.runTokens) {
            result = failed(`Agent wave reached its ${SUBAGENT_LIMITS.runTokens}-token limit before this task launched`);
          } else {
            result = await runChildAgent({
              task,
              workspace: workspace?.worktree ?? workspaceRoot,
              model,
              thinking,
              prompt: buildContextPacket({
                overallGoal: wave.title,
                task,
                todo: task.todoId === undefined ? undefined : todoSnapshot.tasks.find((todo) => todo.id === task.todoId),
              }),
              systemPrompt: [
                ROLE_DEFINITIONS[task.role].prompt,
                CONCISE_RESPONSE_POLICY,
                PONYTAIL_INSTRUCTIONS,
              ].join("\n\n"),
              trusted: ctx.isProjectTrusted(),
              signal: abortSignal,
              onUpdate(update) {
                progress[index] = update;
                if (task.todoId !== undefined && !delegationRunning && (update.status === "starting" || update.status === "running")) {
                  delegationRunning = true;
                  try {
                    todoSnapshot = updateTodoDelegation(todoSnapshot, { todoId: task.todoId, runId, taskId: task.id }, "running");
                    pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
                  } catch {
                    // Final reconciliation below remains authoritative.
                  }
                }
                publish();
              },
            });
          }

          if (workspace && result.status === "succeeded") {
            const patch = await inspectWorkerPatch(workspace);
            if (!patch.changedFiles.length) {
              result = { ...result, patchState: "none", changedFiles: [] };
              await discardWorkerWorkspace(workspace);
            } else if (!patch.scopeValid) {
              result = {
                ...result,
                status: "failed",
                error: `Worker changed files outside writeScope: ${patch.outsideScope.join(", ")}`,
                patchState: "scope_violation",
                changedFiles: patch.changedFiles,
              };
              await discardWorkerWorkspace(workspace);
            } else {
              result = {
                ...result,
                patchState: "ready",
                patchHash: patch.hash,
                patchBytes: patch.bytes,
                changedFiles: patch.changedFiles,
              };
              retained.set(patchKey(runId, task.id), workspace);
            }
          } else if (workspace) {
            await discardWorkerWorkspace(workspace);
          }
        } catch (error) {
          result = failed(error instanceof Error ? error.message : String(error));
          if (workspace && !retained.has(patchKey(runId, task.id))) {
            await discardWorkerWorkspace(workspace).catch(() => undefined);
          }
        }

        if (task.todoId !== undefined) {
          const phase = result.status === "succeeded"
            ? result.role === "worker" && result.patchState === "ready" ? "awaiting_integration" : "awaiting_verification"
            : "release";
          try {
            todoSnapshot = updateTodoDelegation(todoSnapshot, { todoId: task.todoId, runId, taskId: task.id }, phase);
            pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
          } catch {
            result = { ...result, status: "failed", error: `${result.error ? `${result.error}; ` : ""}Todo delegation reconciliation failed` };
          }
        }
        progress[index] = result;
        results[index] = result;
        publish();
        return result;
      });

      const finalDetails: ParallelAgentsDetails = {
        runId,
        title: wave.title,
        progress: copyProgress(completed),
        results: completed,
        usage: aggregateUsage(completed.map((result) => result.usage)),
        todoSnapshot: copyTodoSnapshot(todoSnapshot),
      };
      pi.events.emit(CONFIG_EVENTS.subagentProgress, { runId, tasks: [] } satisfies SubagentProgressEvent);
      const formatted = formatAgentResults(completed);
      const bounded = truncateHead(formatted, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      return {
        content: [{ type: "text", text: bounded.content }],
        details: finalDetails,
        usage: finalDetails.usage,
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("Agents")), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as ParallelAgentsDetails | undefined;
      const textItem = Array.isArray(result.content) ? result.content.find((item) => item?.type === "text") : undefined;
      const text = textItem?.type === "text" ? textItem.text : "No agent output.";
      if (details && Array.isArray(details.progress) && Array.isArray(details.results) && typeof details.usage?.totalTokens === "number") {
        return renderAgents(details, theme, expanded, text);
      }
      return new Text(normalizeDisplayText(text), 0, 0);
    },
  });

  pi.registerTool({
    name: "agent_patch",
    label: "Agent Patch",
    description: "Inspect, apply, or discard a completed worker patch. Inspect supports byte offset/limit paging. Apply requires the exact inspected SHA-256 hash.",
    promptSnippet: "Inspect and resolve completed worker patches",
    promptGuidelines: ["Use agent_patch inspect before apply, verify the patch against the task, then apply with the exact returned hash or discard it."],
    parameters: AgentPatchSchema,
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.isProjectTrusted()) throw new Error("Worker patch operations require a trusted project");
      const key = patchKey(params.runId, params.taskId);
      const workspace = retained.get(key) ?? await recoverWorkerWorkspace(ctx.cwd, params.runId, params.taskId);
      const inspected = await inspectWorkerPatch(workspace);
      if (params.action !== "inspect" && (params.offset !== undefined || params.limit !== undefined)) throw new Error(`${params.action} does not accept offset or limit`);
      if (params.action === "inspect") {
        const page = inspected.patch
          ? formatPatchPage(inspected.patch, params.offset ?? 0, params.limit ?? DEFAULT_MAX_BYTES - 1_000)
          : { text: "No worker changes.", offset: 0, nextOffset: undefined };
        return {
          content: [{ type: "text", text: page.text }],
          details: {
            runId: params.runId,
            taskId: params.taskId,
            patchState: inspected.patch ? "ready" : "none",
            hash: inspected.hash,
            bytes: inspected.bytes,
            changedFiles: inspected.changedFiles,
            scopeValid: inspected.scopeValid,
            outsideScope: inspected.outsideScope,
            offset: page.offset,
            nextOffset: page.nextOffset,
            todoSnapshot: copyTodoSnapshot(todoSnapshot),
          },
        };
      }
      if (params.action === "apply") {
        if (!params.expectedHash) throw new Error("agent_patch apply requires expectedHash from inspect");
        await applyWorkerPatch(workspace, params.expectedHash);
        let cleanupWarning: string | undefined;
        try {
          await discardWorkerWorkspace(workspace);
        } catch (error) {
          cleanupWarning = safeDisplayText(error instanceof Error ? error.message : String(error)).slice(0, 500);
        }
        retained.delete(key);
        let todoWarning: string | undefined;
        try {
          const todo = todoSnapshot.tasks.find((task) => task.delegation?.runId === params.runId && task.delegation.taskId === params.taskId);
          if (todo?.delegation) {
            todoSnapshot = updateTodoDelegation(
              todoSnapshot,
              { todoId: todo.id, runId: params.runId, taskId: params.taskId },
              "awaiting_verification",
            );
          }
          pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
        } catch (error) {
          todoWarning = safeDisplayText(error instanceof Error ? error.message : String(error)).slice(0, 500);
        }
        const warnings = [
          cleanupWarning && `Workspace cleanup warning: ${cleanupWarning}`,
          todoWarning && `Todo reconciliation warning: ${todoWarning}`,
        ].filter((warning): warning is string => Boolean(warning));
        return {
          content: [{
            type: "text",
            text: `Applied worker patch ${params.runId}/${params.taskId}. Parent verification is still required.` +
              (warnings.length ? ` ${warnings.join(" ")}` : ""),
          }],
          details: {
            runId: params.runId,
            taskId: params.taskId,
            patchState: "applied",
            hash: inspected.hash,
            ...(cleanupWarning ? { cleanupWarning } : {}),
            ...(todoWarning ? { todoWarning } : {}),
            todoSnapshot: copyTodoSnapshot(todoSnapshot),
          },
        };
      }
      await discardWorkerWorkspace(workspace);
      retained.delete(key);
      const todo = todoSnapshot.tasks.find((task) => task.delegation?.runId === params.runId && task.delegation.taskId === params.taskId);
      if (todo?.delegation) todoSnapshot = updateTodoDelegation(todoSnapshot, { todoId: todo.id, runId: params.runId, taskId: params.taskId }, "release");
      pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
      return {
        content: [{ type: "text", text: `Discarded worker patch ${params.runId}/${params.taskId}.` }],
        details: { runId: params.runId, taskId: params.taskId, patchState: "discarded", todoSnapshot: copyTodoSnapshot(todoSnapshot) },
      };
    },
  });

  pi.registerCommand("agents", {
    description: "List retained worker patches for the current repository",
    handler: async (_args, ctx) => {
      let workspaces: WorkerWorkspace[];
      try { workspaces = await listWorkerWorkspaces(ctx.cwd); } catch (error) {
        ctx.ui.notify(normalizeDisplayText(error instanceof Error ? error.message : String(error)), "error");
        return;
      }
      const text = workspaces.length
        ? workspaces.map((workspace) => `${workspace.runId}/${workspace.taskId} │ ${workspace.writeScope.join(", ")}`).join("\n")
        : "No retained worker patches.";
      ctx.ui.notify(normalizeDisplayText(safeDisplayText(text).slice(0, 4_000)), "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    todoSnapshot = restoreCoordinatedTodoSnapshot(ctx.sessionManager.getBranch());
    pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
    if (ctx.mode !== "tui") return;
    const workspaces = await listWorkerWorkspaces(ctx.cwd).catch(() => []);
    if (workspaces.length) ctx.ui.notify(`${workspaces.length} retained worker patch${workspaces.length === 1 ? "" : "es"}; use /agents.`, "warning");
  });
  pi.on("session_tree", (_event, ctx) => {
    todoSnapshot = restoreCoordinatedTodoSnapshot(ctx.sessionManager.getBranch());
    pi.events.emit(CONFIG_EVENTS.todoSnapshot, copyTodoSnapshot(todoSnapshot));
  });
  pi.on("session_shutdown", () => shutdown.abort());
}
