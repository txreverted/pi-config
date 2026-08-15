import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  PROTOCOL_ACK_TIMEOUT_MS,
  RUN_HEALTH_SWEEP_MS,
  SPAWN_ACK_TIMEOUT_MS,
  healthForRun,
  type RunHealth,
  type RunLifecycle,
  type RunTiming,
} from "./orchestration-core.ts";

export const MAX_SUBAGENT_TASKS = 6;
export const MAX_SUBAGENT_CONCURRENCY = 3;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 15 * 60_000;
export const MAX_SUBAGENT_TIMEOUT_MS = 30 * 60_000;
export const MAX_RESULT_CHARS = 16_000;
const MAX_JSON_LINE_CHARS = 2 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;
const KILL_GRACE_MS = 2_000;
const DEFAULT_READ_ONLY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const PROGRESS_THROTTLE_MS = 200;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];
export type AgentName = "scout" | "reviewer" | "worker" | "researcher" | "synthesizer";
export type ChildStatus = "completed" | "failed" | "aborted" | "timed_out";
export type ChildFailureKind =
  | "preflight"
  | "spawn"
  | "startup"
  | "protocol"
  | "process"
  | "assistant"
  | "empty"
  | "budget"
  | "aborted"
  | "timeout";

export interface UsageSummary {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface AgentDefinition {
  name: AgentName;
  description: string;
  tools: readonly string[];
  prompt: string;
  thinking: ThinkingLevel;
  timeoutMs: number;
  contextFiles: boolean;
  extensions?: readonly string[];
  writer?: boolean;
  maxTurns?: number;
  maxToolCalls?: number;
  maxReportedTokens?: number;
  maxCostUsd?: number;
}

export function agentDefinitionForTask(
  definition: AgentDefinition,
  modelReasoning: boolean | undefined,
  stepThinking?: ThinkingLevel,
): AgentDefinition {
  const thinking = modelReasoning === false ? "off" : (stepThinking ?? definition.thinking);
  return thinking === definition.thinking ? definition : { ...definition, thinking };
}

export interface ChildTask {
  id: string;
  agent: AgentName;
  task: string;
  cwd: string;
}

export interface ChildActivityEvent {
  at: number;
  type: string;
  label?: string;
}

export interface ChildRunProgress extends RunTiming {
  id: string;
  agent: AgentName;
  thinking?: ThinkingLevel;
  lifecycle: RunLifecycle;
  health: RunHealth;
  healthReason?: string;
  attempt: number;
  maxAttempts: number;
  pid?: number;
  eventType?: string;
  turns: number;
  toolCalls: number;
  recentEvents: ChildActivityEvent[];
  text: string;
  usage: UsageSummary;
}

export interface ChildRunResult extends RunTiming {
  id: string;
  agent: AgentName;
  thinking: ThinkingLevel;
  status: ChildStatus;
  task: string;
  cwd: string;
  output: string;
  error?: string;
  stderr?: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  model?: string;
  stopReason?: string;
  durationMs: number;
  usage: UsageSummary;
  truncated: boolean;
  attempts: number;
  attemptErrors?: string[];
  failureKind?: ChildFailureKind;
  turns: number;
  toolCalls: number;
  recentEvents: ChildActivityEvent[];
}

export interface PiInvocation {
  command: string;
  argsPrefix: string[];
}

export interface RunChildUpdate {
  progress: ChildRunProgress;
}

export interface RunChildOptions {
  definition: AgentDefinition;
  task: ChildTask;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  invocation?: PiInvocation;
  env?: NodeJS.ProcessEnv;
  queuedAt?: number;
  maxReadOnlyAttempts?: number;
  retryDelayMs?: number;
  spawnAckTimeoutMs?: number;
  protocolAckTimeoutMs?: number;
  healthSweepMs?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  maxReportedTokens?: number;
  maxCostUsd?: number;
  onUpdate?: (update: RunChildUpdate) => void;
}

interface AssistantMessageLike {
  role?: unknown;
  content?: unknown;
  provider?: unknown;
  model?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  usage?: unknown;
}

export interface ProtocolState {
  output: string;
  partialText?: string;
  model?: string;
  stopReason?: string;
  assistantError?: string;
  usage: UsageSummary;
  turns: number;
  toolCalls?: number;
}

export interface ProtocolEventSummary {
  type: string;
  toolName?: string;
  toolCallId?: string;
  textDelta?: string;
}

interface AttemptResult extends ChildRunResult {
  retryable: boolean;
}

export function emptyUsage(): UsageSummary {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeUsage(value: unknown): UsageSummary {
  if (!value || typeof value !== "object") return emptyUsage();
  const usage = value as Record<string, unknown>;
  const costValue = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, unknown> : {};
  const cacheWrite1h = finiteNumber(usage.cacheWrite1h);
  const reasoning = finiteNumber(usage.reasoning);
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    ...(usage.reasoning !== undefined ? { reasoning } : {}),
    totalTokens: finiteNumber(usage.totalTokens),
    cost: {
      input: finiteNumber(costValue.input),
      output: finiteNumber(costValue.output),
      cacheRead: finiteNumber(costValue.cacheRead),
      cacheWrite: finiteNumber(costValue.cacheWrite),
      total: finiteNumber(costValue.total),
    },
  };
}

export function addUsage(target: UsageSummary, value: UsageSummary): UsageSummary {
  const cacheWrite1h = (target.cacheWrite1h ?? 0) + (value.cacheWrite1h ?? 0);
  const reasoning = (target.reasoning ?? 0) + (value.reasoning ?? 0);
  return {
    input: target.input + value.input,
    output: target.output + value.output,
    cacheRead: target.cacheRead + value.cacheRead,
    cacheWrite: target.cacheWrite + value.cacheWrite,
    ...(target.cacheWrite1h !== undefined || value.cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    ...(target.reasoning !== undefined || value.reasoning !== undefined ? { reasoning } : {}),
    totalTokens: target.totalTokens + value.totalTokens,
    cost: {
      input: target.cost.input + value.cost.input,
      output: target.cost.output + value.cost.output,
      cacheRead: target.cost.cacheRead + value.cost.cacheRead,
      cacheWrite: target.cost.cacheWrite + value.cost.cacheWrite,
      total: target.cost.total + value.cost.total,
    },
  };
}

export function aggregateUsage(values: Iterable<UsageSummary>): UsageSummary {
  let total = emptyUsage();
  for (const value of values) total = addUsage(total, value);
  return total;
}

export function truncateText(value: string, maxChars = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  const notice = `\n\n[Subagent output truncated; ${value.length - maxChars} or more characters omitted.]`;
  const contentLimit = Math.max(0, maxChars - notice.length);
  return {
    text: `${value.slice(0, contentLimit).trimEnd()}${notice}`.slice(0, maxChars),
    truncated: true,
  };
}

function extractAssistantText(message: AssistantMessageLike): string {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
    })
    .join("\n")
    .trim();
}

export function consumeProtocolEvent(line: string, state: ProtocolState): ProtocolEventSummary | undefined {
  if (!line.trim()) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  if (typeof record.type !== "string" || !record.type.trim()) return undefined;
  const summary: ProtocolEventSummary = { type: record.type };

  if (record.type === "message_update") {
    const assistantEvent = record.assistantMessageEvent;
    if (assistantEvent && typeof assistantEvent === "object") {
      const assistantRecord = assistantEvent as Record<string, unknown>;
      const delta = assistantRecord.delta;
      // Persist only user-visible text deltas. Thinking/reasoning deltas may be
      // provider-private and must never enter orchestration state or widgets.
      if (assistantRecord.type === "text_delta" && typeof delta === "string" && delta) {
        state.partialText = `${state.partialText ?? ""}${delta}`.slice(-MAX_RESULT_CHARS);
        summary.textDelta = delta;
      }
    }
  }

  if (record.type === "tool_execution_start" || record.type === "tool_execution_update" || record.type === "tool_execution_end") {
    if (typeof record.toolName === "string") summary.toolName = record.toolName;
    if (typeof record.toolCallId === "string") summary.toolCallId = record.toolCallId;
  }

  const messageValue = record.type === "message_end" ? record.message : undefined;
  if (!messageValue || typeof messageValue !== "object") return summary;

  const message = messageValue as AssistantMessageLike;
  if (message.role !== "assistant") return summary;
  state.turns++;
  state.usage = addUsage(state.usage, normalizeUsage(message.usage));
  const text = extractAssistantText(message);
  if (text) state.output = text;
  state.partialText = undefined;
  if (typeof message.provider === "string" && typeof message.model === "string") {
    state.model = `${message.provider}/${message.model}`;
  } else if (typeof message.model === "string") {
    state.model = message.model;
  }
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    state.assistantError = message.errorMessage.trim();
  }
  return summary;
}

export function consumeProtocolLine(line: string, state: ProtocolState): boolean {
  return consumeProtocolEvent(line, state) !== undefined;
}

export function buildPiArgs(input: {
  definition: AgentDefinition;
  promptPath: string;
  taskPath: string;
  model?: string;
  thinking?: ThinkingLevel;
}): string[] {
  const args = [
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-approve",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
  ];
  if (!input.definition.contextFiles) args.push("--no-context-files");
  for (const extension of input.definition.extensions ?? []) args.push("--extension", extension);
  args.push("--tools", input.definition.tools.join(","));
  if (input.model) args.push("--model", input.model);
  if (input.thinking) args.push("--thinking", input.thinking);
  args.push("--append-system-prompt", input.promptPath);
  args.push(`@${input.taskPath}`, "Complete the task described in the attached task file.");
  return args;
}

export function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const scriptName = currentScript ? basename(currentScript).toLowerCase() : "";
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  const isPiEntrypoint = scriptName === "pi" || scriptName === "pi.js" ||
    ((scriptName === "cli.js" || scriptName === "cli.ts") && currentScript?.includes("pi-coding-agent"));
  if (currentScript && !isBunVirtualScript && isAbsolute(currentScript) && isPiEntrypoint) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const executable = basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, args };
  return { command: "pi", args };
}

function isPathInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

export async function resolveWorkspaceCwd(workspace: string, requested?: string): Promise<string> {
  const root = await realpath(resolve(workspace));
  const candidate = await realpath(resolve(root, requested ?? "."));
  const candidateStat = await stat(candidate);
  if (!candidateStat.isDirectory()) throw new Error(`Subagent cwd is not a directory: ${candidate}`);
  if (!isPathInside(root, candidate)) throw new Error("Subagent cwd must remain inside the current workspace");
  return candidate;
}

export async function validateAgentPreflight(definition: AgentDefinition, task: ChildTask): Promise<void> {
  if (!definition.prompt.trim()) throw new Error(`Subagent role '${definition.name}' has an empty prompt`);
  if (definition.tools.length === 0 || definition.tools.some((tool) => !tool.trim())) {
    throw new Error(`Subagent role '${definition.name}' has an invalid tool allowlist`);
  }
  for (const [label, value] of [
    ["turn", definition.maxTurns],
    ["tool-call", definition.maxToolCalls],
    ["reported-token", definition.maxReportedTokens],
    ["cost", definition.maxCostUsd],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`Subagent role '${definition.name}' has an invalid ${label} budget`);
    }
  }
  const cwdStat = await stat(task.cwd);
  if (!cwdStat.isDirectory()) throw new Error(`Subagent cwd is not a directory: ${task.cwd}`);
  await Promise.all((definition.extensions ?? []).map(async (extension) => {
    await access(extension);
    const extensionStat = await stat(extension);
    if (!extensionStat.isFile()) throw new Error(`Subagent extension is not a file: ${extension}`);
  }));
}

async function createRunFiles(definition: AgentDefinition, task: ChildTask): Promise<{ dir: string; promptPath: string; taskPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-config-subagent-"));
  await chmod(dir, 0o700);
  const promptPath = join(dir, "role.md");
  const taskPath = join(dir, "task.md");
  await Promise.all([
    writeFile(promptPath, definition.prompt, { encoding: "utf8", mode: 0o600 }),
    writeFile(taskPath, `# Delegated task\n\n${task.task.trim()}\n`, { encoding: "utf8", mode: 0o600 }),
  ]);
  return { dir, promptPath, taskPath };
}

function terminateProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    // The process may already have exited.
  }
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function appendTail(current: string, chunk: string, limit: number): string {
  const next = current + chunk;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function safeUpdate(options: RunChildOptions, progress: ChildRunProgress): void {
  try {
    options.onUpdate?.({
      progress: {
        ...progress,
        recentEvents: progress.recentEvents.map((event) => ({ ...event })),
        usage: { ...progress.usage, cost: { ...progress.usage.cost } },
      },
    });
  } catch {
    // Rendering and persistence updates are best-effort and cannot own process lifecycle.
  }
}

function terminalLifecycle(status: ChildStatus): RunLifecycle {
  return status;
}

function abortedBeforeLaunch(options: RunChildOptions, queuedAt: number, startedAt: number, attempts: number): ChildRunResult {
  const endedAt = Date.now();
  return {
    id: options.task.id,
    agent: options.definition.name,
    thinking: options.definition.thinking,
    status: "aborted",
    task: options.task.task,
    cwd: options.task.cwd,
    output: "",
    error: "Subagent was aborted before launch",
    exitCode: null,
    model: options.model,
    durationMs: Math.max(0, endedAt - startedAt),
    usage: emptyUsage(),
    truncated: false,
    attempts,
    failureKind: "aborted",
    turns: 0,
    toolCalls: 0,
    recentEvents: [],
    queuedAt,
    startedAt,
    endedAt,
  };
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return await new Promise((resolveWait) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveWait(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolveWait(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runChildAttempt(
  options: RunChildOptions,
  progress: ChildRunProgress,
  timeoutMs: number,
): Promise<AttemptResult> {
  const attemptStartedMono = performance.now();
  let runFiles: Awaited<ReturnType<typeof createRunFiles>> | undefined;
  try {
    await validateAgentPreflight(options.definition, options.task);
    runFiles = await createRunFiles(options.definition, options.task);
  } catch (error) {
    const endedAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: options.task.id,
      agent: options.definition.name,
      thinking: options.definition.thinking,
      status: "failed",
      task: options.task.task,
      cwd: options.task.cwd,
      output: "",
      error: `Subagent preflight failed: ${message}`,
      exitCode: null,
      model: options.model,
      durationMs: performance.now() - attemptStartedMono,
      usage: emptyUsage(),
      truncated: false,
      attempts: progress.attempt,
      failureKind: "preflight",
      turns: 0,
      toolCalls: 0,
      recentEvents: [],
      retryable: false,
      queuedAt: progress.queuedAt,
      startedAt: progress.startedAt,
      endedAt,
    };
  }

  const piArgs = buildPiArgs({
    definition: options.definition,
    promptPath: runFiles.promptPath,
    taskPath: runFiles.taskPath,
    model: options.model,
    thinking: options.definition.thinking,
  });
  const invocation = options.invocation
    ? { command: options.invocation.command, args: [...options.invocation.argsPrefix, ...piArgs] }
    : resolvePiInvocation(piArgs);

  const state: ProtocolState = { output: "", usage: emptyUsage(), turns: 0, toolCalls: 0 };
  let stderr = "";
  let protocolBuffer = "";
  let protocolError: string | undefined;
  let spawnError: string | undefined;
  let requestedStop: "aborted" | "timed_out" | "protocol" | "spawn_timeout" | "startup_timeout" | "process_lost" | "budget" | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let spawnTimer: NodeJS.Timeout | undefined;
  let protocolTimer: NodeJS.Timeout | undefined;
  let healthTimer: NodeJS.Timeout | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let childPid: number | undefined;
  let lastUpdateAt = 0;
  let activeToolCallId: string | undefined;
  let budgetError: string | undefined;
  const maxTurns = options.definition.writer ? undefined : options.maxTurns ?? options.definition.maxTurns;
  const maxToolCalls = options.definition.writer ? undefined : options.maxToolCalls ?? options.definition.maxToolCalls;
  const maxReportedTokens = options.definition.writer ? undefined : options.maxReportedTokens ?? options.definition.maxReportedTokens;
  const maxCostUsd = options.definition.writer ? undefined : options.maxCostUsd ?? options.definition.maxCostUsd;
  const recordActivity = (type: string, label?: string) => {
    const at = Date.now();
    const previous = progress.recentEvents.at(-1);
    if (type === "message_update" && previous?.type === type && at - previous.at < 5_000) return;
    progress.recentEvents.push({ at, type, ...(label ? { label } : {}) });
    if (progress.recentEvents.length > 40) progress.recentEvents.splice(0, progress.recentEvents.length - 40);
  };

  recordActivity("thinking_selected", options.definition.thinking);

  const emit = (force = false) => {
    const now = Date.now();
    progress.health = healthForRun(progress.lifecycle, progress, now);
    progress.text = state.output || state.partialText || progress.text;
    progress.usage = state.usage;
    progress.turns = state.turns;
    progress.toolCalls = state.toolCalls ?? 0;
    if (force || now - lastUpdateAt >= PROGRESS_THROTTLE_MS) {
      lastUpdateAt = now;
      safeUpdate(options, progress);
    }
  };

  try {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.task.cwd,
      env: { ...process.env, ...options.env, PI_CONFIG_SUBAGENT_CHILD: "1" },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    childPid = child.pid;
    progress.pid = child.pid;
    const decoder = new StringDecoder("utf8");

    const requestStop = (reason: typeof requestedStop) => {
      if (requestedStop) return;
      requestedStop = reason;
      terminateProcess(child.pid, "SIGTERM");
      killTimer = setTimeout(() => terminateProcess(child.pid, "SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
      emit(true);
    };

    spawnTimer = setTimeout(() => requestStop("spawn_timeout"), options.spawnAckTimeoutMs ?? SPAWN_ACK_TIMEOUT_MS);
    spawnTimer.unref?.();
    child.once("spawn", () => {
      if (spawnTimer) clearTimeout(spawnTimer);
      progress.spawnedAt = Date.now();
      progress.lastActivityAt = progress.spawnedAt;
      recordActivity("process_spawn");
      protocolTimer = setTimeout(() => requestStop("startup_timeout"), options.protocolAckTimeoutMs ?? PROTOCOL_ACK_TIMEOUT_MS);
      protocolTimer.unref?.();
      emit(true);
    });

    const processLine = (line: string) => {
      if (line.length > MAX_JSON_LINE_CHARS) {
        protocolError = `Child JSON event exceeded ${MAX_JSON_LINE_CHARS} characters`;
        requestStop("protocol");
        return;
      }
      const summary = consumeProtocolEvent(line, state);
      if (!summary) {
        if (line.trim() && !protocolError) protocolError = "Child emitted malformed JSON output";
        // Keep consuming bounded output so a final authoritative message can be
        // retained for diagnostics. Any malformed line still fails the run.
        return;
      }
      const now = Date.now();
      if (progress.firstProtocolAt === undefined) {
        progress.firstProtocolAt = now;
        if (protocolTimer) clearTimeout(protocolTimer);
      }
      progress.lastActivityAt = now;
      progress.eventType = summary.type;
      progress.lifecycle = "running";
      if (summary.type !== "tool_execution_update") recordActivity(summary.type, summary.toolName);
      if (summary.type === "tool_execution_start") {
        state.toolCalls = (state.toolCalls ?? 0) + 1;
        activeToolCallId = summary.toolCallId;
        progress.currentTool = summary.toolName ?? "tool";
        progress.currentToolStartedAt = now;
      } else if (summary.type === "tool_execution_end" && (!activeToolCallId || summary.toolCallId === activeToolCallId)) {
        activeToolCallId = undefined;
        progress.currentTool = undefined;
        progress.currentToolStartedAt = undefined;
      }
      if (maxTurns !== undefined && state.turns > maxTurns) budgetError = `Subagent exceeded its ${maxTurns}-turn read-only budget`;
      else if (maxToolCalls !== undefined && (state.toolCalls ?? 0) > maxToolCalls) budgetError = `Subagent exceeded its ${maxToolCalls}-tool-call read-only budget`;
      else if (maxReportedTokens !== undefined && state.usage.totalTokens > maxReportedTokens) budgetError = `Subagent exceeded its ${maxReportedTokens}-reported-token read-only budget`;
      else if (maxCostUsd !== undefined && state.usage.cost.total > maxCostUsd) budgetError = `Subagent exceeded its $${maxCostUsd.toFixed(2)} read-only cost budget`;
      if (budgetError) requestStop("budget");
      emit(summary.type === "tool_execution_start" || summary.type === "tool_execution_end" || summary.type === "message_end");
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      protocolBuffer += decoder.write(chunk);
      if (protocolBuffer.length > MAX_JSON_LINE_CHARS && !protocolBuffer.includes("\n")) {
        protocolError = `Child JSON event exceeded ${MAX_JSON_LINE_CHARS} characters`;
        requestStop("protocol");
        return;
      }
      const lines = protocolBuffer.split("\n");
      protocolBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendTail(stderr, chunk.toString("utf8"), MAX_STDERR_CHARS);
    });
    child.once("error", (error) => {
      spawnError = error.message;
      if (spawnTimer) clearTimeout(spawnTimer);
      emit(true);
    });

    const onAbort = () => requestStop("aborted");
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => requestStop("timed_out"), timeoutMs);
    timeout.unref?.();
    healthTimer = setInterval(() => {
      progress.health = healthForRun(progress.lifecycle, progress);
      if (child.pid && progress.spawnedAt !== undefined && !isProcessAlive(child.pid)) requestStop("process_lost");
      else emit(true);
    }, options.healthSweepMs ?? RUN_HEALTH_SWEEP_MS);
    healthTimer.unref?.();

    await new Promise<void>((resolveClose) => {
      child.once("close", (code, signal) => {
        exitCode = code;
        exitSignal = signal ?? undefined;
        resolveClose();
      });
    });

    options.signal?.removeEventListener("abort", onAbort);
    protocolBuffer += decoder.end();
    if (protocolBuffer.trim() && !requestedStop) processLine(protocolBuffer);
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
  } finally {
    for (const timer of [killTimer, spawnTimer, protocolTimer, healthTimer, timeout]) {
      if (timer) clearTimeout(timer);
    }
    await rm(runFiles.dir, { recursive: true, force: true }).catch(() => {});
  }

  const bounded = truncateText(state.output);
  let status: ChildStatus = "completed";
  let error: string | undefined;
  let failureKind: ChildFailureKind | undefined;
  let retryable = false;
  if (requestedStop === "aborted") {
    status = "aborted";
    error = "Subagent was aborted";
    failureKind = "aborted";
  } else if (requestedStop === "timed_out") {
    status = "timed_out";
    error = `Subagent timed out after ${timeoutMs}ms`;
    failureKind = "timeout";
  } else if (requestedStop === "spawn_timeout") {
    status = "failed";
    error = `Subagent process did not acknowledge spawn within ${options.spawnAckTimeoutMs ?? SPAWN_ACK_TIMEOUT_MS}ms`;
    failureKind = "spawn";
    retryable = true;
  } else if (requestedStop === "startup_timeout") {
    status = "failed";
    error = `Subagent emitted no Pi protocol event within ${options.protocolAckTimeoutMs ?? PROTOCOL_ACK_TIMEOUT_MS}ms`;
    failureKind = "startup";
    retryable = true;
  } else if (requestedStop === "process_lost") {
    status = "failed";
    error = "Subagent process disappeared without a close event";
    failureKind = "process";
    retryable = progress.firstProtocolAt === undefined;
  } else if (requestedStop === "protocol") {
    status = "failed";
    error = protocolError ?? "Subagent protocol failed";
    failureKind = "protocol";
  } else if (requestedStop === "budget") {
    status = "failed";
    error = budgetError ?? "Subagent exceeded a read-only execution budget";
    failureKind = "budget";
  } else if (spawnError) {
    status = "failed";
    error = `Failed to start subagent: ${spawnError}`;
    failureKind = "spawn";
    retryable = true;
  } else if (protocolError) {
    status = "failed";
    error = protocolError;
    failureKind = "protocol";
  } else if (exitCode !== 0) {
    status = "failed";
    error = `Subagent exited with code ${exitCode ?? "unknown"}`;
    failureKind = progress.firstProtocolAt === undefined ? "startup" : "process";
    retryable = progress.firstProtocolAt === undefined;
  } else if (state.assistantError || state.stopReason === "error" || state.stopReason === "aborted") {
    status = "failed";
    error = state.assistantError ?? `Subagent stopped with reason ${state.stopReason}`;
    failureKind = "assistant";
  } else if (state.stopReason === "length") {
    status = "failed";
    error = "Subagent reached its output limit before completing";
    failureKind = "assistant";
  } else if (!state.output.trim()) {
    status = "failed";
    error = "Subagent produced no final text response";
    failureKind = "empty";
    retryable = true;
  }

  const endedAt = Date.now();
  recordActivity(status === "completed" ? "run_completed" : `run_${status}`, failureKind);
  progress.lifecycle = terminalLifecycle(status);
  progress.endedAt = endedAt;
  progress.pid = childPid;
  progress.health = healthForRun(progress.lifecycle, progress, endedAt);
  progress.text = bounded.text;
  progress.usage = state.usage;
  emit(true);

  return {
    id: options.task.id,
    agent: options.definition.name,
    thinking: options.definition.thinking,
    status,
    task: options.task.task,
    cwd: options.task.cwd,
    output: bounded.text,
    ...(error ? { error } : {}),
    ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
    exitCode,
    ...(exitSignal ? { signal: exitSignal } : {}),
    model: state.model ?? options.model,
    ...(state.stopReason ? { stopReason: state.stopReason } : {}),
    durationMs: performance.now() - attemptStartedMono,
    usage: state.usage,
    truncated: bounded.truncated,
    attempts: progress.attempt,
    ...(failureKind ? { failureKind } : {}),
    turns: state.turns,
    toolCalls: state.toolCalls ?? 0,
    recentEvents: [...progress.recentEvents],
    retryable,
    queuedAt: progress.queuedAt,
    startedAt: progress.startedAt,
    endedAt,
    ...(progress.spawnedAt !== undefined ? { spawnedAt: progress.spawnedAt } : {}),
    ...(progress.firstProtocolAt !== undefined ? { firstProtocolAt: progress.firstProtocolAt } : {}),
    ...(progress.lastActivityAt !== undefined ? { lastActivityAt: progress.lastActivityAt } : {}),
  };
}

export async function runChildAgent(options: RunChildOptions): Promise<ChildRunResult> {
  const queuedAt = options.queuedAt ?? Date.now();
  const startedAt = Date.now();
  const startedMono = performance.now();
  const maxAttempts = options.definition.writer
    ? 1
    : Math.min(2, Math.max(1, options.maxReadOnlyAttempts ?? DEFAULT_READ_ONLY_ATTEMPTS));
  if (options.signal?.aborted) return abortedBeforeLaunch(options, queuedAt, startedAt, 0);

  const timeoutMs = Math.min(
    Math.max(1, options.timeoutMs ?? options.definition.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS),
    MAX_SUBAGENT_TIMEOUT_MS,
  );
  const progress: ChildRunProgress = {
    id: options.task.id,
    agent: options.definition.name,
    thinking: options.definition.thinking,
    lifecycle: "starting",
    health: "healthy",
    queuedAt,
    startedAt,
    lastActivityAt: startedAt,
    attempt: 1,
    maxAttempts,
    turns: 0,
    toolCalls: 0,
    recentEvents: [],
    text: "",
    usage: emptyUsage(),
  };
  safeUpdate(options, progress);

  let totalUsage = emptyUsage();
  let totalTurns = 0;
  let totalToolCalls = 0;
  let stderr = "";
  const attemptErrors: string[] = [];
  let finalResult: AttemptResult | undefined;

  const finishAborted = (attempts: number): ChildRunResult => {
    const aborted = abortedBeforeLaunch(options, queuedAt, startedAt, attempts);
    aborted.usage = totalUsage;
    aborted.turns = totalTurns;
    aborted.toolCalls = totalToolCalls;
    aborted.recentEvents = [...progress.recentEvents];
    aborted.attemptErrors = attemptErrors.length > 0 ? attemptErrors : undefined;
    return aborted;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) return finishAborted(attempt - 1);
    progress.attempt = attempt;
    progress.lifecycle = attempt === 1 ? "starting" : "retrying";
    progress.health = "healthy";
    progress.spawnedAt = undefined;
    progress.firstProtocolAt = undefined;
    progress.lastActivityAt = Date.now();
    progress.currentTool = undefined;
    progress.currentToolStartedAt = undefined;
    progress.eventType = undefined;
    progress.healthReason = undefined;
    progress.pid = undefined;
    progress.turns = 0;
    progress.toolCalls = 0;
    progress.text = attempt === 1 ? "" : `Retrying after startup failure (${attempt}/${maxAttempts})`;
    safeUpdate(options, progress);

    const elapsed = performance.now() - startedMono;
    const remainingTimeout = Math.max(1, timeoutMs - elapsed);
    finalResult = await runChildAttempt(options, progress, remainingTimeout);
    totalUsage = addUsage(totalUsage, finalResult.usage);
    totalTurns += finalResult.turns;
    totalToolCalls += finalResult.toolCalls;
    stderr = appendTail(stderr, finalResult.stderr ?? "", MAX_STDERR_CHARS);
    if (finalResult.status === "completed" || !finalResult.retryable || attempt >= maxAttempts || options.signal?.aborted) break;
    if (finalResult.error) attemptErrors.push(finalResult.error);
    progress.lifecycle = "retrying";
    progress.healthReason = finalResult.error;
    progress.usage = totalUsage;
    progress.text = `Retrying read-only child after verified startup/transient failure (${attempt + 1}/${maxAttempts})`;
    safeUpdate(options, progress);
    const waited = await waitForRetry(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, options.signal);
    if (!waited) return finishAborted(attempt);
  }

  if (!finalResult) return finishAborted(0);
  const endedAt = Date.now();
  return {
    ...finalResult,
    durationMs: performance.now() - startedMono,
    usage: totalUsage,
    ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
    attempts: progress.attempt,
    turns: totalTurns,
    toolCalls: totalToolCalls,
    recentEvents: [...progress.recentEvents],
    ...(attemptErrors.length > 0 ? { attemptErrors } : {}),
    queuedAt,
    startedAt,
    endedAt,
  };
}

export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  run: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await run(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function captureGitStatus(cwd: string): Promise<string | undefined> {
  return await new Promise((resolveStatus) => {
    const child = spawn("git", ["status", "--short"], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 3_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < MAX_STDERR_CHARS) output += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timeout);
      resolveStatus(undefined);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolveStatus(code === 0 ? output.trim() : undefined);
    });
  });
}
