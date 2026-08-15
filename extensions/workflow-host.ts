import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  atomicWriteJson,
  readPersistedWorkflowRun,
  readRunById,
  readWorkflowHostConfig,
  resultToPersistedState,
  type PersistedWorkflowRun,
} from "./orchestration-state.ts";
import { healthForRun, type RunHealth } from "./orchestration-core.ts";
import {
  MAX_SUBAGENT_CONCURRENCY,
  agentDefinitionForTask,
  captureGitStatus,
  runChildAgent,
} from "./subagents-core.ts";
import {
  compileDeclarativeWorkflowSpec,
  executeWorkflow,
  type WorkflowDefinition,
  type WorkflowProgressSnapshot,
} from "./workflows-core.ts";
import { createAgentRegistry } from "../subagents/registry.ts";
import { createWorkflowRegistry } from "../subagents/workflows-registry.ts";

const STATE_WRITE_THROTTLE_MS = 250;
const MAX_WORKFLOW_RUNTIME_MS = 60 * 60_000;

class ThrottledStateWriter {
  private readonly path: string;
  private current: PersistedWorkflowRun;
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private dirty = false;

  constructor(path: string, initial: PersistedWorkflowRun) {
    this.path = path;
    this.current = initial;
  }

  update(transform: (state: PersistedWorkflowRun) => PersistedWorkflowRun, immediate = false): void {
    this.current = transform(this.current);
    this.dirty = true;
    if (immediate) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.enqueue();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.enqueue();
      }, STATE_WRITE_THROTTLE_MS);
      this.timer.unref?.();
    }
  }

  private enqueue(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = structuredClone(this.current);
    this.chain = this.chain.then(() => atomicWriteJson(this.path, snapshot));
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.enqueue();
    await this.chain;
  }

  value(): PersistedWorkflowRun {
    return this.current;
  }
}

function aggregateHealth(snapshot: WorkflowProgressSnapshot): RunHealth {
  const active = snapshot.steps.filter((step) => step.status === "starting" || step.status === "running" || step.status === "retrying");
  const order: RunHealth[] = ["healthy", "quiet", "long_running", "needs_attention", "dead"];
  return active.reduce<RunHealth>((worst, step) => {
    const health = healthForRun(step.status, step);
    return order.indexOf(health) > order.indexOf(worst) ? health : worst;
  }, "healthy");
}

function progressState(current: PersistedWorkflowRun, snapshot: WorkflowProgressSnapshot): PersistedWorkflowRun {
  const lastActivityAt = Math.max(
    current.lastActivityAt ?? 0,
    ...snapshot.steps.map((step) => step.lastActivityAt ?? step.startedAt ?? 0),
  );
  return {
    ...current,
    status: "running",
    health: aggregateHealth(snapshot),
    startedAt: snapshot.startedAt,
    updatedAt: Date.now(),
    ...(lastActivityAt > 0 ? { lastActivityAt } : {}),
    durationMs: snapshot.durationMs,
    steps: snapshot.steps,
    usage: snapshot.usage,
  };
}

function resolveDefinition(config: Awaited<ReturnType<typeof readWorkflowHostConfig>>): WorkflowDefinition {
  const agents = createAgentRegistry();
  if (config.builtinName) {
    const definition = createWorkflowRegistry().get(config.builtinName);
    if (!definition) throw new Error(`Unknown built-in workflow '${config.builtinName}'`);
    return definition;
  }
  return compileDeclarativeWorkflowSpec(config.spec, (agent) => agents.get(agent)?.writer === true);
}

function failedState(current: PersistedWorkflowRun, error: unknown): PersistedWorkflowRun {
  const endedAt = Date.now();
  return {
    ...current,
    status: "failed",
    health: "dead",
    healthReason: "Workflow host failed",
    error: error instanceof Error ? error.message : String(error),
    endedAt,
    updatedAt: endedAt,
    lastActivityAt: endedAt,
    durationMs: Math.max(0, endedAt - (current.startedAt ?? current.queuedAt)),
  };
}

export async function executeWorkflowHost(configPath: string): Promise<void> {
  const config = await readWorkflowHostConfig(configPath);
  const lease = await open(join(config.runDir, "lease"), "wx", 0o600);
  try {
    await lease.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: Date.now(), runId: config.runId })}\n`, "utf8");
  } finally {
    await lease.close();
  }
  const initial = await readPersistedWorkflowRun(config.statePath);
  if (initial.runId !== config.runId) throw new Error("Workflow state and config run ids differ");
  const writer = new ThrottledStateWriter(config.statePath, initial);
  const controller = new AbortController();
  let hostTimedOut = false;
  const onSignal = () => controller.abort();
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  const hostTimeout = setTimeout(() => {
    hostTimedOut = true;
    controller.abort();
  }, MAX_WORKFLOW_RUNTIME_MS);
  hostTimeout.unref?.();

  writer.update((state) => ({
    ...state,
    status: "starting",
    health: "healthy",
    pid: process.pid,
    hostStartedAt: Date.now(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastActivityAt: Date.now(),
  }), true);
  await writer.flush();

  try {
    const definition = resolveDefinition(config);
    const agents = createAgentRegistry();
    const gitStatusBefore = config.hasWriter ? await captureGitStatus(config.cwd) : undefined;
    const inputHashSalt = createHash("sha256").update(JSON.stringify({
      model: config.model ?? null,
      modelReasoning: config.modelReasoning ?? null,
      roles: definition.steps.map((step) => {
        const role = agents.get(step.agent)!;
        return { agent: step.agent, prompt: role.prompt, tools: role.tools, thinking: step.thinking ?? role.thinking, timeoutMs: role.timeoutMs };
      }),
    })).digest("hex");
    const resumeState = config.retryOf
      ? await readRunById(config.retryOf, dirname(config.runDir))
      : undefined;
    const result = await executeWorkflow({
      definition,
      input: { name: definition.name, objective: config.objective, paths: config.paths },
      concurrency: MAX_SUBAGENT_CONCURRENCY,
      isWriter: (agent) => agents.get(agent)?.writer === true,
      runStep: async (step, task, onProgress) => {
        const agent = agents.get(step.agent);
        if (!agent) throw new Error(`Workflow references unknown agent '${step.agent}'`);
        const effectiveAgent = agentDefinitionForTask(agent, config.modelReasoning, step.thinking);
        return await runChildAgent({
          definition: effectiveAgent,
          task: { id: `${config.runId}:${step.id}`, agent: step.agent, task, cwd: config.cwd },
          model: config.model,
          signal: controller.signal,
          invocation: config.invocation,
          onUpdate: (update) => onProgress(update.progress),
        });
      },
      onUpdate: (snapshot) => writer.update((state) => progressState(state, snapshot)),
      ...(resumeState ? { resumeOutcomes: resumeState.steps } : {}),
      inputHashSalt,
    });
    const gitStatusAfter = config.hasWriter ? await captureGitStatus(config.cwd) : undefined;
    const finalResult = hostTimedOut && result.status === "aborted"
      ? { ...result, status: "failed" as const, error: `Workflow exceeded the ${MAX_WORKFLOW_RUNTIME_MS}ms host limit` }
      : result;
    writer.update((state) => resultToPersistedState(state, finalResult, { gitStatusBefore, gitStatusAfter }), true);
  } catch (error) {
    writer.update((state) => failedState(state, error), true);
  } finally {
    clearTimeout(hostTimeout);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
    await writer.flush();
  }
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Workflow host requires a private config path");
  await executeWorkflowHost(resolve(configPath));
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entry === resolve(fileURLToPath(import.meta.url))) {
  main().catch(async (error) => {
    const configPath = process.argv[2];
    if (configPath) {
      try {
        const config = await readWorkflowHostConfig(resolve(configPath));
        const state = await readPersistedWorkflowRun(config.statePath);
        const terminal = state.status === "completed" || state.status === "completed_with_warnings" || state.status === "failed" || state.status === "aborted" || state.status === "timed_out";
        const duplicateLease = (error as NodeJS.ErrnoException).code === "EEXIST";
        if (!terminal && !duplicateLease) await atomicWriteJson(config.statePath, failedState(state, error));
      } catch {
        // There is no safe state destination left; stderr is intentionally private/unused.
      }
    }
    process.exitCode = 1;
  });
}
