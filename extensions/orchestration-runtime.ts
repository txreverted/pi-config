import { spawn } from "node:child_process";
import { access, constants as fsConstants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Key, Text, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  RUN_UI_TICK_MS,
  activityAgeMs,
  elapsedMs,
  formatRunDuration,
  healthForRun,
  healthLabel,
  isTerminalLifecycle,
  type RunHealth,
  type RunLifecycle,
} from "./orchestration-core.ts";
import {
  cleanupPersistedRuns,
  createRunId,
  createWorkflowRunFiles,
  ensureOrchestrationRoot,
  listPersistedWorkflowRuns,
  orchestrationRoot,
  readRunById,
  readWorkflowHostConfig,
  updatePersistedWorkflowRun,
  type PersistedWorkflowRun,
  type WorkflowHostConfig,
} from "./orchestration-state.ts";
import {
  agentDefinitionForTask,
  emptyUsage,
  isProcessAlive,
  resolvePiInvocation,
  truncateText,
  type ChildRunProgress,
  type PiInvocation,
  type UsageSummary,
} from "./subagents-core.ts";
import type {
  BuiltinWorkflowName,
  WorkflowStepOutcome,
} from "./workflows-core.ts";
import { createAgentRegistry } from "../subagents/registry.ts";
import { createWorkflowRegistry } from "../subagents/workflows-registry.ts";
import { validateWorkflowDefinition } from "./workflows-core.ts";

const DEAD_HOST_GRACE_MS = 5_000;
const HOST_SPAWN_TIMEOUT_MS = 5_000;
const MAX_RECENT_FOREGROUND_RUNS = 20;
const STATE_SCAN_INTERVAL_MS = 5_000;
const CONTROL_ACTIONS = ["list", "status", "stop", "retry", "doctor"] as const;

export interface ForegroundRunRecord {
  kind: "subagent" | "workflow";
  runId: string;
  name: string;
  objectivePreview: string;
  status: RunLifecycle;
  health: RunHealth;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  lastActivityAt?: number;
  durationMs: number;
  children: ChildRunProgress[];
  usage: UsageSummary;
  error?: string;
  stop?: () => void;
}

export interface StartBackgroundWorkflowOptions {
  builtinName: BuiltinWorkflowName;
  objective: string;
  paths: string[];
  cwd: string;
  ctx: ExtensionContext;
  retryOf?: string;
  invocation?: PiInvocation;
}

export interface BackgroundWorkflowReceipt {
  runId: string;
  name: string;
  status: "starting";
  statePath: string;
}

interface RunView {
  kind: "subagent" | "workflow";
  runId: string;
  name: string;
  objectivePreview: string;
  status: RunLifecycle;
  health: RunHealth;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  lastActivityAt?: number;
  durationMs: number;
  children: Array<ChildRunProgress | WorkflowStepOutcome>;
  usage: UsageSummary;
  output: string;
  error?: string;
  pid?: number;
  hasWriter: boolean;
  persisted: boolean;
}

interface DoctorCheck {
  status: "pass" | "warn" | "fail";
  label: string;
  detail: string;
}

// ExtensionAPI wrappers may be source-specific even though they share one Pi
// runtime. The shared event bus is the stable per-runtime identity.
const runtimes = new WeakMap<object, OrchestrationRuntime>();

function modelName(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function statusIcon(status: RunLifecycle): string {
  if (status === "completed") return "✓";
  if (status === "completed_with_warnings") return "!";
  if (status === "failed" || status === "timed_out") return "✗";
  if (status === "aborted") return "■";
  if (status === "queued") return "◦";
  return "◆";
}

function aggregateChildHealth(children: readonly (ChildRunProgress | WorkflowStepOutcome)[], now = Date.now()): RunHealth {
  const order: RunHealth[] = ["healthy", "quiet", "long_running", "needs_attention", "dead"];
  return children.reduce<RunHealth>((worst, child) => {
    const status = "lifecycle" in child ? child.lifecycle : child.status;
    const health = healthForRun(status, child, now);
    return order.indexOf(health) > order.indexOf(worst) ? health : worst;
  }, "healthy");
}

function runViewFromPersisted(run: PersistedWorkflowRun, now = Date.now()): RunView {
  const active = !isTerminalLifecycle(run.status);
  const childHealth = aggregateChildHealth(run.steps, now);
  const overallHealth = healthForRun(run.status, run, now);
  const healthOrder: RunHealth[] = ["healthy", "quiet", "long_running", "needs_attention", "dead"];
  const dynamicHealth = active
    ? healthOrder[Math.max(healthOrder.indexOf(childHealth), healthOrder.indexOf(overallHealth))]!
    : run.health;
  return {
    kind: "workflow",
    runId: run.runId,
    name: run.name,
    objectivePreview: run.objectivePreview,
    status: run.status,
    health: dynamicHealth,
    queuedAt: run.queuedAt,
    ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    updatedAt: run.updatedAt,
    ...(run.lastActivityAt !== undefined ? { lastActivityAt: run.lastActivityAt } : {}),
    durationMs: isTerminalLifecycle(run.status) ? run.durationMs : Math.max(0, now - (run.startedAt ?? run.queuedAt)),
    children: run.steps,
    usage: run.usage,
    output: run.output,
    ...(run.error ? { error: run.error } : {}),
    ...(run.pid !== undefined ? { pid: run.pid } : {}),
    hasWriter: run.hasWriter,
    persisted: true,
  };
}

function runViewFromForeground(run: ForegroundRunRecord, now = Date.now()): RunView {
  return {
    kind: run.kind,
    runId: run.runId,
    name: run.name,
    objectivePreview: run.objectivePreview,
    status: run.status,
    health: isTerminalLifecycle(run.status)
      ? (run.status === "failed" || run.status === "timed_out" ? "dead" : run.health)
      : aggregateChildHealth(run.children, now),
    queuedAt: run.queuedAt,
    ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    updatedAt: run.updatedAt,
    ...(run.lastActivityAt !== undefined ? { lastActivityAt: run.lastActivityAt } : {}),
    durationMs: isTerminalLifecycle(run.status) ? run.durationMs : Math.max(0, now - (run.startedAt ?? run.queuedAt)),
    children: run.children,
    usage: run.usage,
    output: "",
    ...(run.error ? { error: run.error } : {}),
    hasWriter: run.children.some((child) => child.agent === "worker"),
    persisted: false,
  };
}

function safePreview(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function formatRunLine(run: RunView, now = Date.now()): string {
  const duration = isTerminalLifecycle(run.status) ? run.durationMs : Math.max(0, now - (run.startedAt ?? run.queuedAt));
  return `${statusIcon(run.status)} ${run.name} · ${formatRunDuration(duration)} · ${run.status}${run.health !== "healthy" ? ` · ${healthLabel(run.health)}` : ""}`;
}

function formatChildLine(child: ChildRunProgress | WorkflowStepOutcome, now = Date.now()): string {
  const status = "lifecycle" in child ? child.lifecycle : child.status;
  const timing = child;
  const duration = "durationMs" in child && isTerminalLifecycle(status) ? child.durationMs : elapsedMs(timing, now);
  const tool = child.currentTool
    ? ` · ${child.currentTool}${child.currentToolStartedAt ? ` ${formatRunDuration(now - child.currentToolStartedAt)}` : ""}`
    : "";
  const age = activityAgeMs(timing, now);
  const activity = age !== undefined && age >= 10_000 ? ` · active ${formatRunDuration(age)} ago` : "";
  const queue = child.startedAt && child.startedAt - child.queuedAt >= 1_000
    ? ` · waited ${formatRunDuration(child.startedAt - child.queuedAt)}`
    : "";
  const phase = "phase" in child && child.phase ? `${child.phase}/` : "";
  const restored = "restored" in child && child.restored ? " · restored" : "";
  return `${statusIcon(status)} ${phase}${child.id} (${child.agent}${child.thinking ? `/${child.thinking}` : ""}) · ${formatRunDuration(duration)}${queue} · ${status}${restored} · ${child.turns}t/${child.toolCalls} tools${tool}${activity}`;
}

async function executableAvailable(command: string): Promise<boolean> {
  if (isAbsolute(command)) {
    try {
      await access(command, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const path of paths) {
    try {
      await access(join(path, command), fsConstants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
}

function commandArguments(output: string): string[] | undefined {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let started = false;
  for (let index = 0; index < output.length; index++) {
    const character = output[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      started = true;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else if (character === "\\" && index + 1 < output.length && /[\s"']/.test(output[index + 1])) {
      current += output[++index];
      started = true;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) args.push(current);
  return args;
}

export function commandMatchesWorkflowHost(
  output: string,
  expectedHost: string,
  expectedConfig: string,
  caseInsensitive = process.platform === "win32",
): boolean {
  const args = commandArguments(output);
  if (!args) return false;
  const normalize = (value: string) => caseInsensitive ? value.toLowerCase() : value;
  const host = normalize(expectedHost);
  const config = normalize(expectedConfig);
  return args.some((value, index) => normalize(value) === host && normalize(args[index + 1] ?? "") === config);
}

async function isOwnedWorkflowHost(pid: number, runId: string): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  const expectedHost = fileURLToPath(new URL("./workflow-host.ts", import.meta.url));
  const expectedConfig = join(orchestrationRoot(), runId, "config.json");
  const command = process.platform === "win32" ? "powershell.exe" : "ps";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($p) { $p.CommandLine }`]
    : ["-ww", "-p", String(pid), "-o", "command="];
  return await new Promise((resolveOwnership) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (owned: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveOwnership(owned);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, 1_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < 16_000) output += chunk.toString("utf8");
    });
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0 && commandMatchesWorkflowHost(output, expectedHost, expectedConfig)));
  });
}

export class OrchestrationRuntime {
  private readonly pi: ExtensionAPI;
  private ctx: ExtensionContext | undefined;
  private persisted = new Map<string, PersistedWorkflowRun>();
  private foreground = new Map<string, ForegroundRunRecord>();
  private ticker: NodeJS.Timeout | undefined;
  private scanning = false;
  private delivering = new Set<string>();
  private notifiedHealth = new Map<string, RunHealth>();
  private hostIdentityMisses = new Map<string, number>();
  private lastScanAt = 0;
  private lastCleanupAt = 0;
  private lastScanError: string | undefined;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.install();
  }

  private install(): void {
    this.pi.on("session_start", (_event, ctx) => {
      this.bind(ctx);
      void this.scan(true);
    });
    this.pi.on("session_shutdown", () => {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = undefined;
      this.ctx = undefined;
    });

    this.pi.registerCommand("runs", {
      description: "Inspect and control active and recent subagent/workflow runs",
      handler: async (_args, ctx) => this.openInspector(ctx),
    });
    this.pi.registerCommand("orchestration-doctor", {
      description: "Check subagent and workflow runtime health without a provider request",
      handler: async (_args, ctx) => {
        this.bind(ctx);
        await this.scan(true);
        const report = await this.doctor(ctx);
        ctx.ui.notify(report, report.includes("✗") ? "error" : report.includes("!") ? "warning" : "info");
      },
    });

    const controlSchema = Type.Object({
      action: StringEnum(CONTROL_ACTIONS, { description: "Run management action" }),
      id: Type.Optional(Type.String({ minLength: 1, maxLength: 80, description: "Exact run id for status, stop, or retry" })),
    });
    this.pi.registerTool({
      name: "orchestration_control",
      label: "orchestration control",
      description: "Inspect, stop, retry, or diagnose foreground subagent and background workflow runs. Retry is restricted to terminal read-only workflows that did not complete cleanly.",
      promptSnippet: "Inspect and safely control active orchestration runs",
      promptGuidelines: [
        "Use exact run ids returned by subagent or workflow tools.",
        "Do not stop or retry a run unless the user requested it or the run is definitively unhealthy.",
        "Writer workflows cannot be retried automatically or through orchestration control.",
      ],
      parameters: controlSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        this.bind(ctx);
        const text = await this.control(params.action, params.id, ctx);
        return { content: [{ type: "text", text }], details: { action: params.action, id: params.id } };
      },
      renderCall(args, theme) {
        return new Text(`${theme.fg("toolTitle", theme.bold("orchestration"))} ${theme.fg("accent", args.action)}${args.id ? ` ${theme.fg("dim", args.id)}` : ""}`, 0, 0);
      },
    });
  }

  bind(ctx: ExtensionContext): void {
    this.ctx = ctx;
    // Run details remain available in tool cards and /runs. Keep the area below
    // the input completely empty, including after hot-reloading an older version.
    if (ctx.mode === "tui") ctx.ui.setWidget("orchestration-runs", undefined);
    this.ensureTicker();
  }

  upsertForeground(run: ForegroundRunRecord): void {
    this.foreground.delete(run.runId);
    this.foreground.set(run.runId, run);
    while (this.foreground.size > MAX_RECENT_FOREGROUND_RUNS) {
      const oldest = this.foreground.keys().next().value as string | undefined;
      if (!oldest) break;
      this.foreground.delete(oldest);
    }
    this.ensureTicker();
  }

  getForeground(runId: string): ForegroundRunRecord | undefined {
    return this.foreground.get(runId);
  }

  async startBackgroundWorkflow(options: StartBackgroundWorkflowOptions): Promise<BackgroundWorkflowReceipt> {
    if (Object.hasOwn(options, "definition")) throw new Error("Caller-supplied workflow definitions are not accepted");
    this.bind(options.ctx);
    const agents = createAgentRegistry();
    const definition = createWorkflowRegistry().get(options.builtinName);
    if (!definition) throw new Error(`Unknown built-in workflow '${options.builtinName}'`);
    validateWorkflowDefinition(definition, (agent) => agents.get(agent)?.writer === true);
    const hasWriter = definition.steps.some((step) => agents.get(step.agent)?.writer === true);
    const runId = createRunId(definition.name);
    const queuedAt = Date.now();
    const steps: WorkflowStepOutcome[] = definition.steps.map((step) => ({
      id: step.id,
      agent: step.agent,
      ...(step.phase ? { phase: step.phase } : {}),
      thinking: agentDefinitionForTask(agents.get(step.agent)!, options.ctx.model?.reasoning, step.thinking).thinking,
      status: "queued",
      health: "healthy",
      output: "",
      usage: emptyUsage(),
      durationMs: 0,
      attempt: 0,
      maxAttempts: 1,
      turns: 0,
      toolCalls: 0,
      recentEvents: [],
      queuedAt,
    }));
    const origin = { sessionId: options.ctx.sessionManager.getSessionId() };
    const initial: PersistedWorkflowRun = {
      version: 1,
      kind: "workflow",
      runId,
      name: definition.name,
      objectivePreview: safePreview(options.objective),
      cwd: options.cwd,
      origin,
      status: "queued",
      health: "healthy",
      queuedAt,
      updatedAt: queuedAt,
      lastActivityAt: queuedAt,
      durationMs: 0,
      steps,
      output: "",
      usage: emptyUsage(),
      hasWriter,
      ...(options.retryOf ? { retryOf: options.retryOf } : {}),
    };
    const resolvedInvocation = options.invocation
      ? { command: options.invocation.command, args: options.invocation.argsPrefix }
      : resolvePiInvocation([]);
    const config: Omit<WorkflowHostConfig, "runDir" | "statePath"> = {
      version: 1,
      runId,
      cwd: options.cwd,
      origin,
      objective: options.objective,
      paths: options.paths,
      builtinName: options.builtinName,
      ...(modelName(options.ctx) ? { model: modelName(options.ctx) } : {}),
      ...(options.ctx.model ? { modelReasoning: options.ctx.model.reasoning } : {}),
      invocation: { command: resolvedInvocation.command, argsPrefix: resolvedInvocation.args },
      hasWriter,
      ...(options.retryOf ? { retryOf: options.retryOf } : {}),
    };
    const files = await createWorkflowRunFiles(config, initial);
    const hostPath = fileURLToPath(new URL("./workflow-host.ts", import.meta.url));
    const child = spawn(process.execPath, ["--experimental-strip-types", hostPath, files.configPath], {
      cwd: options.cwd,
      env: { ...process.env, PI_CONFIG_WORKFLOW_HOST: "1" },
      detached: process.platform !== "win32",
      shell: false,
      stdio: "ignore",
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) rejectSpawn(error);
        else resolveSpawn();
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`Workflow host did not spawn within ${HOST_SPAWN_TIMEOUT_MS}ms`));
      }, HOST_SPAWN_TIMEOUT_MS);
      child.once("spawn", () => finish());
      child.once("error", (error) => finish(error));
    }).catch(async (error) => {
      await updatePersistedWorkflowRun(runId, (state) => ({
        ...state,
        status: "failed",
        health: "dead",
        error: `Failed to start workflow host: ${error instanceof Error ? error.message : String(error)}`,
        endedAt: Date.now(),
        updatedAt: Date.now(),
      }));
      throw error;
    });
    child.unref();
    await this.scan();
    return { runId, name: definition.name, status: "starting", statePath: files.statePath };
  }

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      void this.scan();
    }, STATE_SCAN_INTERVAL_MS);
    this.ticker.unref?.();
  }

  private async scan(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastScanAt < STATE_SCAN_INTERVAL_MS) return;
    if (this.scanning) {
      if (!force) return;
      while (this.scanning) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      return;
    }
    this.scanning = true;
    this.lastScanAt = now;
    try {
      const runs = await listPersistedWorkflowRuns();
      this.persisted = new Map(runs.map((run) => [run.runId, run]));
      for (const run of runs) {
        try {
          const missingHost = run.pid === undefined && now - run.updatedAt >= DEAD_HOST_GRACE_MS * 2;
          const hostStale = run.pid !== undefined && now - run.updatedAt >= DEAD_HOST_GRACE_MS;
          let deadHost = false;
          if (!hostStale || isTerminalLifecycle(run.status)) this.hostIdentityMisses.delete(run.runId);
          if (hostStale && run.pid !== undefined) {
            if (!isProcessAlive(run.pid)) {
              deadHost = true;
            } else if (process.platform !== "win32" && !(await isOwnedWorkflowHost(run.pid, run.runId))) {
              const misses = (this.hostIdentityMisses.get(run.runId) ?? 0) + 1;
              this.hostIdentityMisses.set(run.runId, misses);
              deadHost = misses >= 2;
            } else {
              this.hostIdentityMisses.delete(run.runId);
            }
          }
          if (!isTerminalLifecycle(run.status) && (missingHost || deadHost)) {
            const repaired = await updatePersistedWorkflowRun(run.runId, (state) => ({
              ...state,
              status: "failed",
              health: "dead",
              error: state.error ?? "Workflow host exited without recording a terminal state",
              endedAt: now,
              updatedAt: now,
              durationMs: Math.max(0, now - (state.startedAt ?? state.queuedAt)),
            }));
            this.persisted.set(run.runId, repaired);
            this.hostIdentityMisses.delete(run.runId);
            continue;
          }
          const view = runViewFromPersisted(run, now);
          const previous = this.notifiedHealth.get(run.runId);
          this.notifiedHealth.set(run.runId, view.health);
          if ((view.health === "needs_attention" || view.health === "dead") && previous !== view.health && !isTerminalLifecycle(view.status)) {
            this.ctx?.ui.notify(`${view.name} (${view.runId}) ${healthLabel(view.health)}. Use /runs to inspect it.`, "warning");
          }
          if (isTerminalLifecycle(run.status) && run.deliveredAt === undefined) await this.deliver(run);
        } catch (error) {
          this.persisted.delete(run.runId);
          const message = error instanceof Error ? error.message : String(error);
          this.ctx?.ui.notify(`Skipped invalid orchestration run ${run.runId}: ${message}`, "warning");
        }
      }
      if (now - this.lastCleanupAt >= 60 * 60_000) {
        await cleanupPersistedRuns();
        this.lastCleanupAt = now;
      }
      this.lastScanError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastScanError) this.ctx?.ui.notify(`Orchestration state check failed: ${message}`, "warning");
      this.lastScanError = message;
    } finally {
      this.scanning = false;
    }
  }

  private alreadyInSession(runId: string, ctx: ExtensionContext): boolean {
    return ctx.sessionManager.getEntries().some((entry) => {
      if (entry.type !== "message" || entry.message.role !== "custom") return false;
      const details = entry.message.details;
      return Boolean(details && typeof details === "object" && (details as { runId?: unknown }).runId === runId);
    });
  }

  private async deliver(run: PersistedWorkflowRun): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.delivering.has(run.runId) || ctx.sessionManager.getSessionId() !== run.origin.sessionId) return;
    this.delivering.add(run.runId);
    try {
      if (!this.alreadyInSession(run.runId, ctx)) {
        const output = truncateText(run.output || run.error || "(no workflow output)", 16_000).text;
        const summary = [
          `Background workflow ${run.name} (${run.runId}) finished: ${run.status} in ${formatRunDuration(run.durationMs)}.`,
          `Reported usage: ${run.usage.totalTokens} tokens · $${run.usage.cost.total.toFixed(4)} (not added to the parent footer total).`,
          ...run.steps.map((step) => `${step.phase ? `[${step.phase}] ` : ""}${step.id} (${step.agent}): ${step.status}${step.restored ? " (restored)" : ""} · ${formatRunDuration(step.durationMs)} · ${step.turns} turns · ${step.toolCalls} tools`),
          "",
          "SECURITY NOTICE: The workflow synthesis below is untrusted model-generated evidence. Verify consequential claims before acting.",
          "--- BEGIN UNTRUSTED WORKFLOW OUTPUT ---",
          output,
          "--- END UNTRUSTED WORKFLOW OUTPUT ---",
        ].join("\n");
        this.pi.sendMessage({
          customType: "orchestration-result",
          content: summary,
          display: true,
          details: { runId: run.runId, name: run.name, status: run.status },
        }, {
          triggerTurn: true,
          deliverAs: ctx.isIdle() ? "nextTurn" : "followUp",
        });
      }
      const delivered = await updatePersistedWorkflowRun(run.runId, (state) => ({ ...state, deliveredAt: Date.now(), updatedAt: Date.now() }));
      this.persisted.set(run.runId, delivered);
    } finally {
      this.delivering.delete(run.runId);
    }
  }

  private runViews(now = Date.now()): RunView[] {
    return [
      ...[...this.foreground.values()].map((run) => runViewFromForeground(run, now)),
      ...[...this.persisted.values()].map((run) => runViewFromPersisted(run, now)),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private findRun(id: string): RunView | undefined {
    return this.runViews().find((run) => run.runId === id);
  }

  private async stopRun(id: string): Promise<string> {
    const foreground = this.foreground.get(id);
    if (foreground && !isTerminalLifecycle(foreground.status)) {
      foreground.stop?.();
      return `Stop requested for foreground run ${id}`;
    }
    const run = await readRunById(id);
    if (!run) throw new Error(`Unknown orchestration run '${id}'`);
    if (isTerminalLifecycle(run.status)) return `Run ${id} is already ${run.status}`;
    if (!run.pid) throw new Error(`Run ${id} has no live host pid`);
    if (!(await isOwnedWorkflowHost(run.pid, run.runId))) {
      throw new Error(`Refusing to signal pid ${run.pid}: it is not the verified host for ${run.runId}`);
    }
    try {
      if (process.platform !== "win32") process.kill(-run.pid, "SIGTERM");
      else process.kill(run.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const pid = run.pid;
    const runId = run.runId;
    const escalation = setTimeout(async () => {
      const current = await readRunById(runId).catch(() => undefined);
      if (!current || isTerminalLifecycle(current.status) || !(await isOwnedWorkflowHost(pid, runId))) return;
      try {
        if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
        else process.kill(pid, "SIGKILL");
      } catch {
        // The verified host may have exited between the ownership check and signal.
      }
    }, 5_000);
    escalation.unref?.();
    return `Stop requested for background workflow ${id}`;
  }

  private async retryRun(id: string, ctx: ExtensionContext): Promise<string> {
    const run = await readRunById(id);
    if (!run) throw new Error(`Unknown persisted workflow run '${id}'`);
    if (!isTerminalLifecycle(run.status)) throw new Error(`Run ${id} is still ${run.status}`);
    if (run.status === "completed") throw new Error(`Run ${id} already completed cleanly`);
    if (run.hasWriter) throw new Error("Writer workflows cannot be retried automatically");
    const configPath = join(orchestrationRoot(), id, "config.json");
    const config = await readWorkflowHostConfig(configPath);
    const receipt = await this.startBackgroundWorkflow({
      builtinName: config.builtinName,
      objective: config.objective,
      paths: config.paths,
      cwd: config.cwd,
      ctx,
      retryOf: id,
      invocation: config.invocation,
    });
    return `Retried ${id} as ${receipt.runId}`;
  }

  private describeRun(run: RunView): string {
    const now = Date.now();
    return [
      `${run.kind} ${run.name} (${run.runId})`,
      `Status: ${run.status} · health: ${healthLabel(run.health)} · elapsed: ${formatRunDuration(isTerminalLifecycle(run.status) ? run.durationMs : now - (run.startedAt ?? run.queuedAt))}`,
      `Objective: ${run.objectivePreview || "(not recorded)"}`,
      `Usage: ${run.usage.totalTokens} tokens · $${run.usage.cost.total.toFixed(4)}`,
      ...run.children.flatMap((child) => [
        `  ${formatChildLine(child, now)}`,
        ...child.recentEvents.slice(-3).map((event) => `    ${new Date(event.at).toLocaleTimeString()} ${event.type}${event.label ? ` · ${event.label}` : ""}`),
      ]),
      ...(run.error ? [`Error: ${run.error}`] : []),
    ].join("\n");
  }

  private async control(action: typeof CONTROL_ACTIONS[number], id: string | undefined, ctx: ExtensionContext): Promise<string> {
    await this.scan();
    if (action === "doctor") return await this.doctor(ctx);
    if (action === "list") {
      const runs = this.runViews().slice(0, 20);
      return runs.length > 0 ? runs.map((run) => `${run.runId}: ${formatRunLine(run)}`).join("\n") : "No orchestration runs found.";
    }
    if (!id) throw new Error(`orchestration_control action '${action}' requires an exact id`);
    if (action === "status") {
      const run = this.findRun(id);
      if (!run) throw new Error(`Unknown orchestration run '${id}'`);
      return this.describeRun(run);
    }
    if (action === "stop") return await this.stopRun(id);
    return await this.retryRun(id, ctx);
  }

  private async showText(ctx: ExtensionCommandContext, title: string, body: string | (() => string)): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(typeof body === "function" ? body() : body, "info");
      return;
    }
    await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
      let offset = 0;
      let maxOffset = 0;
      const refreshTimer = typeof body === "function"
        ? setInterval(() => tui.requestRender(), RUN_UI_TICK_MS)
        : undefined;
      refreshTimer?.unref?.();
      return {
        dispose() {
          if (refreshTimer) clearInterval(refreshTimer);
        },
        invalidate() {},
        handleInput(data: string) {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data.toLowerCase() === "q") done();
          else if (matchesKey(data, Key.up) || data === "k") offset = Math.max(0, offset - 1);
          else if (matchesKey(data, Key.down) || data === "j") offset = Math.min(maxOffset, offset + 1);
          tui.requestRender();
        },
        render(width: number) {
          const available = Math.max(20, width - 2);
          const value = typeof body === "function" ? body() : body;
          const wrapped = value.split("\n").flatMap((line) => wrapTextWithAnsi(line, available));
          const pageSize = 20;
          maxOffset = Math.max(0, wrapped.length - pageSize);
          offset = Math.min(offset, maxOffset);
          const position = maxOffset > 0 ? ` · ${offset + 1}-${Math.min(wrapped.length, offset + pageSize)}/${wrapped.length}` : "";
          return [
            truncateToWidth(theme.fg("accent", theme.bold(title)), available, "…"),
            ...wrapped.slice(offset, offset + pageSize),
            theme.fg("dim", `↑↓/jk scroll · enter/esc/q close${position}`),
          ];
        },
      };
    }, { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center", margin: 1 } });
  }

  private async openInspector(ctx: ExtensionCommandContext): Promise<void> {
    this.bind(ctx);
    await this.scan();
    const runs = this.runViews().slice(0, 20);
    if (runs.length === 0) {
      ctx.ui.notify("No orchestration runs found.", "info");
      return;
    }
    const options = runs.map((run) => `${formatRunLine(run)} · ${run.runId}`);
    const selected = await ctx.ui.select("Subagent and workflow runs", options);
    if (!selected) return;
    const index = options.indexOf(selected);
    const run = runs[index];
    if (!run) return;
    const retryable = run.persisted && isTerminalLifecycle(run.status) && run.status !== "completed" && !run.hasWriter;
    const actions = ["Details", ...(run.output ? ["Output tail"] : []), ...(!isTerminalLifecycle(run.status) ? ["Stop"] : []), ...(retryable ? ["Retry"] : [])];
    const action = await ctx.ui.select(`${run.name} · ${run.runId}`, actions);
    if (action === "Details") {
      await this.showText(ctx, `${run.name} · ${run.runId}`, () => {
        const current = this.findRun(run.runId);
        return current ? this.describeRun(current) : `Run ${run.runId} is no longer available.`;
      });
    } else if (action === "Output tail") {
      await this.showText(ctx, `${run.name} output`, () => {
        const current = this.findRun(run.runId);
        return truncateText(current?.output || "(no output yet)", 8_000).text;
      });
    }
    else if (action === "Stop") {
      if (await ctx.ui.confirm("Stop run?", `Stop ${run.name} (${run.runId})?`)) ctx.ui.notify(await this.stopRun(run.runId), "warning");
    } else if (action === "Retry") {
      ctx.ui.notify(await this.retryRun(run.runId, ctx), "info");
    }
  }

  async doctor(ctx: ExtensionContext): Promise<string> {
    const checks: DoctorCheck[] = [];
    const [major, minor] = process.versions.node.split(".").map(Number);
    checks.push({
      status: major > 22 || (major === 22 && minor >= 19) ? "pass" : "fail",
      label: "Node runtime",
      detail: process.versions.node,
    });
    const invocation = resolvePiInvocation([]);
    checks.push({
      status: await executableAvailable(invocation.command) ? "pass" : "fail",
      label: "Pi executable",
      detail: invocation.command,
    });
    try {
      const root = orchestrationRoot();
      await ensureOrchestrationRoot(root);
      await cleanupPersistedRuns(root);
      checks.push({ status: "pass", label: "Private run state", detail: root });
    } catch (error) {
      checks.push({ status: "fail", label: "Private run state", detail: error instanceof Error ? error.message : String(error) });
    }
    const agents = createAgentRegistry();
    for (const agent of agents.values()) {
      try {
        for (const extension of agent.extensions ?? []) await access(extension);
        const budget = agent.writer
          ? "writer: no unsafe hard turn/tool retry budget"
          : `${agent.maxTurns} turns, ${agent.maxToolCalls} tools, $${agent.maxCostUsd?.toFixed(2)}`;
        checks.push({ status: "pass", label: `Role ${agent.name}`, detail: `${agent.tools.length} fixed tools · ${budget}` });
      } catch (error) {
        checks.push({ status: "fail", label: `Role ${agent.name}`, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    try {
      for (const workflow of createWorkflowRegistry().values()) {
        validateWorkflowDefinition(workflow, (agent) => agents.get(agent)?.writer === true);
      }
      checks.push({ status: "pass", label: "Static workflows", detail: "3 valid bounded graphs" });
    } catch (error) {
      checks.push({ status: "fail", label: "Static workflows", detail: error instanceof Error ? error.message : String(error) });
    }
    checks.push({
      status: ctx.model ? "pass" : "warn",
      label: "Selected model",
      detail: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "No model selected; launches will fail until one is selected",
    });
    const active = this.runViews().filter((run) => !isTerminalLifecycle(run.status));
    const unhealthy = active.filter((run) => run.health === "dead" || run.health === "needs_attention");
    checks.push({
      status: unhealthy.length > 0 ? "warn" : "pass",
      label: "Active runs",
      detail: `${active.length} active, ${unhealthy.length} need attention`,
    });
    const icon = (status: DoctorCheck["status"]) => status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
    return checks.map((check) => `${icon(check.status)} ${check.label}: ${check.detail}`).join("\n");
  }
}

export function getOrchestrationRuntime(pi: ExtensionAPI): OrchestrationRuntime {
  const key = pi.events as object;
  const existing = runtimes.get(key);
  if (existing) return existing;
  const runtime = new OrchestrationRuntime(pi);
  runtimes.set(key, runtime);
  return runtime;
}
