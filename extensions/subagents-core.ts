import { spawn } from "node:child_process";
import type { Usage } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { access, chmod, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";

export const MAX_SUBAGENT_TASKS = 3;
export const MAX_SUBAGENT_CONCURRENCY = 3;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 15 * 60_000;
export const MAX_SUBAGENT_TIMEOUT_MS = 30 * 60_000;
export const MAX_RESULT_BYTES = 16_000;
const TRUNCATION_NOTICE_BYTES = 160;
const STARTUP_TIMEOUT_MS = 20_000;
const SUBAGENT_PROGRESS_INTERVAL_MS = 1_000;
const MAX_JSON_LINE_CHARS = 8 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;
const KILL_GRACE_MS = 2_000;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];
export const AGENT_NAMES = ["reviewer", "researcher", "worker"] as const;
export type AgentName = typeof AGENT_NAMES[number];
export type ChildStatus = "queued" | "starting" | "running" | "completed" | "failed" | "aborted" | "timed_out";

export type UsageSummary = Usage;

export interface AgentDefinition {
  name: AgentName;
  tools: readonly string[];
  prompt: string;
  thinking: ThinkingLevel;
  timeoutMs: number;
  contextFiles: boolean;
  extensions?: readonly string[];
  mutatesWorkspace: boolean;
  maxTurns: number;
  maxToolCalls: number;
  maxReportedTokens: number;
  maxCostUsd: number;
}

export interface ChildTask {
  id: string;
  agent: AgentName;
  task: string;
  cwd: string;
}

export interface ChildRunProgress {
  id: string;
  agent: AgentName;
  thinking: ThinkingLevel;
  status: ChildStatus;
  startedAt: number;
  currentTool?: string;
  activity?: string;
  turns: number;
  toolCalls: number;
  text: string;
  usage: UsageSummary;
}

export interface ChildRunResult extends ChildRunProgress {
  task: string;
  cwd: string;
  output: string;
  error?: string;
  stderr?: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  model?: string;
  stopReason?: string;
  endedAt: number;
  durationMs: number;
  truncated: boolean;
}

export interface PiInvocation {
  command: string;
  argsPrefix: string[];
}

export interface RunChildOptions {
  definition: AgentDefinition;
  task: ChildTask;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  invocation?: PiInvocation;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  onUpdate?: (progress: ChildRunProgress) => void;
}

interface ProtocolState {
  output: string;
  partialText?: string;
  model?: string;
  stopReason?: string;
  assistantError?: string;
  usage: UsageSummary;
  streamingUsage?: UsageSummary;
  turns: number;
  toolCalls: number;
}

interface ProtocolEventSummary {
  type: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
}

export function agentDefinitionForTask(definition: AgentDefinition, modelReasoning: boolean | undefined): AgentDefinition {
  return modelReasoning === false && definition.thinking !== "off" ? { ...definition, thinking: "off" } : definition;
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
  const cost = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, unknown> : {};
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: finiteNumber(usage.cacheWrite1h) } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: finiteNumber(usage.reasoning) } : {}),
    totalTokens: finiteNumber(usage.totalTokens),
    cost: {
      input: finiteNumber(cost.input),
      output: finiteNumber(cost.output),
      cacheRead: finiteNumber(cost.cacheRead),
      cacheWrite: finiteNumber(cost.cacheWrite),
      total: finiteNumber(cost.total),
    },
  };
}

function addUsage(target: UsageSummary, value: UsageSummary): UsageSummary {
  return {
    input: target.input + value.input,
    output: target.output + value.output,
    cacheRead: target.cacheRead + value.cacheRead,
    cacheWrite: target.cacheWrite + value.cacheWrite,
    ...(target.cacheWrite1h !== undefined || value.cacheWrite1h !== undefined
      ? { cacheWrite1h: (target.cacheWrite1h ?? 0) + (value.cacheWrite1h ?? 0) }
      : {}),
    ...(target.reasoning !== undefined || value.reasoning !== undefined
      ? { reasoning: (target.reasoning ?? 0) + (value.reasoning ?? 0) }
      : {}),
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

function reportedUsage(state: ProtocolState): UsageSummary {
  return state.streamingUsage ? addUsage(state.usage, state.streamingUsage) : state.usage;
}

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

export function truncateText(value: string, maxBytes = MAX_RESULT_BYTES): { text: string; truncated: boolean } {
  const contentLimit = Math.max(1, maxBytes - TRUNCATION_NOTICE_BYTES);
  const bounded = truncateHead(value, { maxBytes: contentLimit, maxLines: DEFAULT_MAX_LINES });
  if (!bounded.truncated) return { text: value, truncated: false };

  const content = bounded.firstLineExceedsLimit ? utf8Prefix(value, contentLimit) : bounded.content;
  const omittedBytes = Math.max(0, bounded.totalBytes - Buffer.byteLength(content, "utf8"));
  const notice = `\n\n[Subagent output truncated; ${omittedBytes} or more bytes omitted.]`;
  return {
    text: utf8Prefix(`${content.trimEnd()}${notice}`, maxBytes),
    truncated: true,
  };
}

function assistantText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const value = part as { type?: unknown; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n").trim();
}

export function consumeProtocolEvent(line: string, state: ProtocolState): ProtocolEventSummary | undefined {
  if (!line.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string" || !event.type) return undefined;
  const summary: ProtocolEventSummary = { type: event.type };

  if (event.type === "message_update") {
    if (event.usage !== undefined) state.streamingUsage = normalizeUsage(event.usage);
    if (event.assistantMessageEvent && typeof event.assistantMessageEvent === "object") {
      const update = event.assistantMessageEvent as Record<string, unknown>;
      if (update.type === "text_delta" && typeof update.delta === "string") {
        state.partialText = `${state.partialText ?? ""}${update.delta}`.slice(-MAX_RESULT_BYTES);
      }
    }
  }
  if (event.type.startsWith("tool_execution_")) {
    if (typeof event.toolName === "string") summary.toolName = event.toolName;
    if (typeof event.toolCallId === "string") summary.toolCallId = event.toolCallId;
    if (event.args && typeof event.args === "object" && !Array.isArray(event.args)) {
      summary.args = event.args as Record<string, unknown>;
    }
  }
  if (event.type !== "message_end" || !event.message || typeof event.message !== "object") return summary;

  const message = event.message as Record<string, unknown>;
  if (message.role !== "assistant") return summary;
  state.turns++;
  state.usage = addUsage(state.usage, normalizeUsage(message.usage));
  state.streamingUsage = undefined;
  const text = assistantText(message);
  if (text) state.output = text;
  state.partialText = undefined;
  if (typeof message.provider === "string" && typeof message.model === "string") state.model = `${message.provider}/${message.model}`;
  else if (typeof message.model === "string") state.model = message.model;
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) state.assistantError = message.errorMessage.trim();
  return summary;
}

export function buildPiArgs(input: {
  definition: AgentDefinition;
  promptPath: string;
  taskPath: string;
  model?: string;
}): string[] {
  const args = [
    "--mode", "json", "--print", "--no-session", "--no-approve", "--no-extensions",
    "--no-skills", "--no-prompt-templates", "--no-themes",
  ];
  if (!input.definition.contextFiles) args.push("--no-context-files");
  for (const extension of input.definition.extensions ?? []) args.push("--extension", extension);
  args.push("--tools", input.definition.tools.join(","));
  if (input.model) args.push("--model", input.model);
  args.push("--thinking", input.definition.thinking);
  args.push("--append-system-prompt", input.promptPath);
  args.push(`@${input.taskPath}`, "Complete the task described in the attached task file.");
  return args;
}

export function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const scriptName = currentScript ? basename(currentScript).toLowerCase() : "";
  const isPiEntrypoint = scriptName === "pi" || scriptName === "pi.js" ||
    ((scriptName === "cli.js" || scriptName === "cli.ts") && currentScript?.includes("pi-coding-agent"));
  if (currentScript && !currentScript.startsWith("/$bunfs/root/") && isAbsolute(currentScript) && isPiEntrypoint) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const executable = basename(process.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(executable)
    ? { command: "pi", args }
    : { command: process.execPath, args };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function resolveWorkspaceCwd(workspace: string, requested?: string): Promise<string> {
  const root = await realpath(resolve(workspace));
  const candidate = await realpath(resolve(root, requested ?? "."));
  if (!(await stat(candidate)).isDirectory()) throw new Error(`Subagent cwd is not a directory: ${candidate}`);
  if (!inside(root, candidate)) throw new Error("Subagent cwd must remain inside the current workspace");
  return candidate;
}

async function validatePreflight(definition: AgentDefinition, task: ChildTask): Promise<void> {
  if (!definition.prompt.trim() || definition.tools.length === 0 || definition.tools.some((tool) => !tool.trim())) {
    throw new Error(`Subagent role '${definition.name}' is invalid`);
  }
  if (!(await stat(task.cwd)).isDirectory()) throw new Error(`Subagent cwd is not a directory: ${task.cwd}`);
  await Promise.all((definition.extensions ?? []).map(async (extension) => {
    await access(extension);
    if (!(await stat(extension)).isFile()) throw new Error(`Subagent extension is not a file: ${extension}`);
  }));
}

async function createRunFiles(definition: AgentDefinition, task: ChildTask) {
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

function terminate(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => {});
      killer.unref();
    } catch {
      // The process may already have exited.
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The process may already have exited.
  }
}

function appendTail(current: string, chunk: string, limit: number): string {
  const next = current + chunk;
  return next.length <= limit ? next : next.slice(-limit);
}

interface ActiveTool {
  name: string;
  args?: Record<string, unknown>;
}

function editedPath(args: Record<string, unknown> | undefined): string | undefined {
  const value = args?.path ?? args?.file_path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeActivity(activeTools: Iterable<ActiveTool>, editedFiles: ReadonlySet<string>): string | undefined {
  const tools = [...activeTools];
  if (tools.length === 0) return undefined;
  const names = tools.map((tool) => tool.name.toLowerCase());
  if (names.some((name) => name === "edit" || name === "write")) {
    return editedFiles.size > 0 ? `editing ${editedFiles.size} ${editedFiles.size === 1 ? "file" : "files"}` : "editing files";
  }
  if (tools.some((tool) => tool.name.toLowerCase() === "bash" &&
    typeof tool.args?.command === "string" && /\b(?:test|check|typecheck|lint|build)\b/i.test(tool.args.command))) {
    return "running checks";
  }
  if (names.some((name) => name === "web_search" || name === "find" || name === "grep" || name === "rg")) return "searching";
  if (names.includes("web_fetch")) return "reading source";
  if (names.includes("read")) return "reading files";
  if (names.some((name) => name === "git_status" || name === "git_diff")) return "inspecting changes";
  if (names.includes("bash")) return "running command";
  if (names.includes("jq")) return "analyzing data";
  return tools.at(-1)?.name;
}

export async function runChildAgent(options: RunChildOptions): Promise<ChildRunResult> {
  const startedAt = Date.now();
  const definition = options.definition;
  const base = {
    id: options.task.id,
    agent: definition.name,
    thinking: definition.thinking,
    startedAt,
    turns: 0,
    toolCalls: 0,
    text: "",
    usage: emptyUsage(),
  };
  const finishEarly = (status: ChildStatus, error: string): ChildRunResult => {
    const endedAt = Date.now();
    return {
      ...base, status, task: options.task.task, cwd: options.task.cwd, output: "", error,
      exitCode: null, endedAt, durationMs: endedAt - startedAt, truncated: false,
    };
  };
  if (options.signal?.aborted) return finishEarly("aborted", "Subagent was aborted before launch");

  let files: Awaited<ReturnType<typeof createRunFiles>>;
  try {
    await validatePreflight(definition, options.task);
    files = await createRunFiles(definition, options.task);
  } catch (error) {
    return finishEarly("failed", `Subagent preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const args = buildPiArgs({ definition, promptPath: files.promptPath, taskPath: files.taskPath, model: options.model });
  const invocation = options.invocation
    ? { command: options.invocation.command, args: [...options.invocation.argsPrefix, ...args] }
    : resolvePiInvocation(args);
  const state: ProtocolState = { output: "", usage: emptyUsage(), turns: 0, toolCalls: 0 };
  let progress: ChildRunProgress = { ...base, status: "starting" };
  let stderr = "";
  let protocolBuffer = "";
  let protocolSeen = false;
  let protocolError: string | undefined;
  let spawnError: string | undefined;
  let stop: "aborted" | "timed_out" | "startup" | "protocol" | "budget" | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | undefined;
  const activeTools = new Map<string, ActiveTool>();
  const editedFiles = new Set<string>();
  let killTimer: NodeJS.Timeout | undefined;
  let startupTimer: NodeJS.Timeout | undefined;
  let progressTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;

  const emit = () => {
    progress = {
      ...progress,
      status: progress.status === "starting" && protocolSeen ? "running" : progress.status,
      turns: state.turns,
      toolCalls: state.toolCalls,
      text: truncateText(state.output || state.partialText || progress.text).text,
      usage: reportedUsage(state),
    };
    try {
      options.onUpdate?.({ ...progress, usage: { ...progress.usage, cost: { ...progress.usage.cost } } });
    } catch {
      // UI updates do not own the child process.
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
    const decoder = new StringDecoder("utf8");
    const requestStop = (reason: typeof stop) => {
      if (stop) return;
      stop = reason;
      terminate(child.pid, "SIGTERM");
      killTimer = setTimeout(() => terminate(child.pid, "SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    };
    child.once("spawn", () => {
      startupTimer = setTimeout(() => requestStop("startup"), options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
      startupTimer.unref?.();
      emit();
      if (options.onUpdate) {
        progressTimer = setInterval(emit, SUBAGENT_PROGRESS_INTERVAL_MS);
        progressTimer.unref?.();
      }
    });
    child.once("error", (error) => {
      spawnError = error.message;
    });

    const processLine = (line: string) => {
      if (line.length > MAX_JSON_LINE_CHARS) {
        protocolError = `Child JSON event exceeded ${MAX_JSON_LINE_CHARS} characters`;
        requestStop("protocol");
        return;
      }
      const summary = consumeProtocolEvent(line, state);
      if (!summary) {
        if (line.trim()) {
          protocolError = "Child emitted malformed JSON output";
          requestStop("protocol");
        }
        return;
      }
      if (!protocolSeen) {
        protocolSeen = true;
        if (startupTimer) clearTimeout(startupTimer);
      }
      progress.status = "running";
      if (summary.type === "tool_execution_start") {
        state.toolCalls++;
        const id = summary.toolCallId ?? `tool-${state.toolCalls}`;
        const name = summary.toolName ?? "tool";
        activeTools.set(id, { name, args: summary.args });
        if (name === "edit" || name === "write") {
          const path = editedPath(summary.args);
          if (path) editedFiles.add(path);
        }
      } else if (summary.type === "tool_execution_end") {
        if (summary.toolCallId) activeTools.delete(summary.toolCallId);
        else activeTools.clear();
      }
      progress.currentTool = [...activeTools.values()].at(-1)?.name;
      progress.activity = summarizeActivity(activeTools.values(), editedFiles);
      const budgetError = state.turns > definition.maxTurns
        ? `Subagent exceeded its ${definition.maxTurns}-turn budget`
        : state.toolCalls > definition.maxToolCalls
          ? `Subagent exceeded its ${definition.maxToolCalls}-tool-call budget`
          : reportedUsage(state).totalTokens > definition.maxReportedTokens
            ? `Subagent exceeded its ${definition.maxReportedTokens}-reported-token budget`
            : reportedUsage(state).cost.total > definition.maxCostUsd
              ? `Subagent exceeded its $${definition.maxCostUsd.toFixed(2)} cost budget`
              : undefined;
      if (budgetError) {
        protocolError = budgetError;
        requestStop("budget");
      }
      emit();
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
    const onAbort = () => requestStop("aborted");
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = Math.min(Math.max(1, options.timeoutMs ?? definition.timeoutMs), MAX_SUBAGENT_TIMEOUT_MS);
    timeoutTimer = setTimeout(() => requestStop("timed_out"), timeoutMs);
    timeoutTimer.unref?.();

    await new Promise<void>((resolveClose) => child.once("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal ?? undefined;
      resolveClose();
    }));
    if (stop) terminate(child.pid, "SIGKILL");
    options.signal?.removeEventListener("abort", onAbort);
    protocolBuffer += decoder.end();
    if (protocolBuffer.trim() && !stop) processLine(protocolBuffer);
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
  } finally {
    for (const timer of [killTimer, startupTimer, timeoutTimer]) if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    await rm(files.dir, { recursive: true, force: true }).catch(() => {});
  }

  const bounded = truncateText(state.output || state.partialText || "");
  let status: ChildStatus = "completed";
  let error: string | undefined;
  if (stop === "aborted") {
    status = "aborted";
    error = "Subagent was aborted";
  } else if (stop === "timed_out") {
    status = "timed_out";
    error = "Subagent timed out";
  } else if (stop === "startup") {
    status = "failed";
    error = "Subagent emitted no Pi protocol event before the startup deadline";
  } else if (stop === "protocol" || stop === "budget" || protocolError) {
    status = "failed";
    error = protocolError ?? "Subagent protocol failed";
  } else if (spawnError) {
    status = "failed";
    error = `Failed to start subagent: ${spawnError}`;
  } else if (exitCode !== 0) {
    status = "failed";
    error = `Subagent exited with code ${exitCode ?? "unknown"}`;
  } else if (state.assistantError || state.stopReason === "error" || state.stopReason === "aborted" || state.stopReason === "length") {
    status = "failed";
    error = state.assistantError ?? `Subagent stopped with reason ${state.stopReason}`;
  } else if (!state.output.trim()) {
    status = "failed";
    error = "Subagent produced no final text response";
  }

  const endedAt = Date.now();
  progress = { ...progress, status, text: bounded.text, turns: state.turns, toolCalls: state.toolCalls, usage: reportedUsage(state) };
  emit();
  return {
    ...progress,
    task: options.task.task,
    cwd: options.task.cwd,
    output: bounded.text,
    ...(error ? { error } : {}),
    ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
    exitCode,
    ...(exitSignal ? { signal: exitSignal } : {}),
    model: state.model ?? options.model,
    ...(state.stopReason ? { stopReason: state.stopReason } : {}),
    endedAt,
    durationMs: endedAt - startedAt,
    truncated: bounded.truncated,
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
