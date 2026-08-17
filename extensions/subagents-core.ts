import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Usage } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_LINES, RpcClient, truncateHead } from "@earendil-works/pi-coding-agent";
import { access, chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInside } from "./path-safety.ts";

export const MAX_SUBAGENT_TASKS = 20;
export const MAX_SUBAGENT_TASK_CHARS = 50_000;
export const MAX_SUBAGENT_CONCURRENCY = 20;

function boundedEnvironmentInteger(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : fallback;
}

export function maxAgentConcurrency(): number {
  return boundedEnvironmentInteger("PI_CONFIG_MAX_CONCURRENT_AGENTS", MAX_SUBAGENT_CONCURRENCY, 20);
}
export const SUBAGENT_STALE_TIMEOUT_MS = 2 * 60_000 + 30_000;
export const MAX_RESULT_BYTES = 16_000;
export const MAX_AGENT_ERROR_BYTES = 64_000;
const TRUNCATION_NOTICE_BYTES = 160;
const STARTUP_TIMEOUT_MS = 20_000;
const SUBAGENT_PROGRESS_INTERVAL_MS = 1_000;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];
export const AGENT_NAMES = ["Explore", "reviewer", "researcher", "worker"] as const;
export type AgentName = typeof AGENT_NAMES[number];
export type ChildStatus = "queued" | "starting" | "running" | "done" | "stale" | "bugged" | "error";

export type UsageSummary = Usage;

export interface AgentDefinition {
  name: AgentName;
  tools: readonly string[];
  prompt: string;
  thinking: ThinkingLevel;
  contextFiles: boolean;
  extensions?: readonly string[];
  mutatesWorkspace: boolean;
}

export interface ChildTask {
  id: string;
  name: string;
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
  staleTimeoutMs?: number;
  invocation?: PiInvocation;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  onUpdate?: (progress: ChildRunProgress) => void;
}

interface ProtocolState {
  output: string;
  partialText?: string;
  partialOmittedBytes?: number;
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

function truncateBufferedText(value: string, alreadyOmitted: number, maxBytes: number): { text: string; truncated: boolean } {
  const contentLimit = Math.max(1, maxBytes - TRUNCATION_NOTICE_BYTES);
  const bounded = truncateHead(value, { maxBytes: contentLimit, maxLines: DEFAULT_MAX_LINES - 2 });
  if (!bounded.truncated && alreadyOmitted === 0) return { text: value, truncated: false };

  const content = bounded.firstLineExceedsLimit ? utf8Prefix(value, contentLimit) : bounded.content;
  const omittedBytes = alreadyOmitted + Math.max(0, bounded.totalBytes - Buffer.byteLength(content, "utf8"));
  const notice = `\n\n[Subagent output truncated; ${omittedBytes} or more bytes omitted.]`;
  return {
    text: utf8Prefix(`${content.trimEnd()}${notice}`, maxBytes),
    truncated: true,
  };
}

export function truncateText(value: string, maxBytes = MAX_RESULT_BYTES): { text: string; truncated: boolean } {
  return truncateBufferedText(value, 0, maxBytes);
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
        const current = state.partialText ?? "";
        const remaining = Math.max(0, MAX_RESULT_BYTES - TRUNCATION_NOTICE_BYTES - Buffer.byteLength(current, "utf8"));
        const kept = utf8Prefix(update.delta, remaining);
        state.partialText = current + kept;
        state.partialOmittedBytes = (state.partialOmittedBytes ?? 0) +
          Buffer.byteLength(update.delta, "utf8") - Buffer.byteLength(kept, "utf8");
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
  state.output = text;
  state.partialText = undefined;
  state.partialOmittedBytes = undefined;
  if (typeof message.provider === "string" && typeof message.model === "string") state.model = `${message.provider}/${message.model}`;
  else if (typeof message.model === "string") state.model = message.model;
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  state.assistantError = typeof message.errorMessage === "string" && message.errorMessage.trim()
    ? truncateText(message.errorMessage.trim(), MAX_AGENT_ERROR_BYTES).text
    : undefined;
  return summary;
}

export function buildPiArgs(input: {
  definition: AgentDefinition;
  promptPath: string;
}): string[] {
  const args = [
    "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-session",
  ];
  if (!input.definition.contextFiles) args.push("--no-context-files");
  for (const extension of input.definition.extensions ?? []) args.push("--extension", extension);
  args.push("--tools", input.definition.tools.join(","));
  args.push("--thinking", input.definition.thinking);
  args.push("--append-system-prompt", input.promptPath);
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

export async function resolveWorkspaceCwd(workspace: string, requested?: string): Promise<string> {
  const root = await realpath(resolve(workspace));
  const candidate = await realpath(resolve(root, requested ?? "."));
  if (!(await stat(candidate)).isDirectory()) throw new Error(`Subagent cwd is not a directory: ${candidate}`);
  if (!isPathInside(root, candidate)) throw new Error("Subagent cwd must remain inside the current workspace");
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

async function removeRunFiles(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
}

async function createRunFiles(definition: AgentDefinition) {
  const dir = await mkdtemp(join(tmpdir(), "pi-config-subagent-"));
  try {
    await chmod(dir, 0o700);
    const promptPath = join(dir, "role.md");
    const stderrPath = join(dir, "stderr.log");
    await Promise.all([
      writeFile(promptPath, definition.prompt, { encoding: "utf8", mode: 0o600 }),
      writeFile(stderrPath, "", { encoding: "utf8", mode: 0o600 }),
    ]);
    return { dir, promptPath, stderrPath };
  } catch (error) {
    try {
      await removeRunFiles(dir);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Failed to create and clean up subagent run files at ${dir}`);
    }
    throw error;
  }
}

interface ActiveTool {
  name: string;
  args?: Record<string, unknown>;
}

function editedPath(args: Record<string, unknown> | undefined): string | undefined {
  const value = args?.path ?? args?.file_path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const execFileAsync = promisify(execFile);

async function descendantPids(pid: number): Promise<number[]> {
  if (process.platform === "win32") return [];
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 1_000 });
    const children = new Map<number, number[]>();
    for (const line of stdout.split("\n")) {
      const [child, parent] = line.trim().split(/\s+/).map(Number);
      if (!Number.isSafeInteger(child) || !Number.isSafeInteger(parent)) continue;
      children.set(parent, [...(children.get(parent) ?? []), child]);
    }
    const result: number[] = [];
    const visit = (parent: number) => {
      for (const child of children.get(parent) ?? []) { visit(child); result.push(child); }
    };
    visit(pid);
    return result;
  } catch {
    return [];
  }
}

export async function stopRpcClient(client: RpcClient): Promise<void> {
  const child = (client as unknown as { process?: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean } }).process;
  const pid = child?.pid;
  if (process.platform === "win32" && pid) {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 1_500 }).catch(() => undefined);
  }
  const descendants = pid ? await descendantPids(pid) : [];
  for (const descendant of descendants) { try { process.kill(descendant, "SIGTERM"); } catch {} }
  void client.abort().catch(() => {});
  await Promise.race([
    client.stop().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
  ]);
  try { child?.kill("SIGKILL"); } catch {}
  for (const descendant of descendants) { try { process.kill(descendant, "SIGKILL"); } catch {} }
}

function summarizeActivity(activeTools: Iterable<ActiveTool>, editedFiles: ReadonlySet<string>): string | undefined {
  const tools = [...activeTools];
  if (tools.length === 0) return undefined;
  const names = tools.map((tool) => tool.name.toLowerCase());
  if (names.some((name) => name === "edit" || name === "write")) {
    return editedFiles.size > 0 ? `editing ${editedFiles.size} ${editedFiles.size === 1 ? "file" : "files"}` : "editing files";
  }
  const bashCommands = tools
    .filter((tool) => tool.name.toLowerCase() === "bash" && typeof tool.args?.command === "string")
    .map((tool) => tool.args!.command as string);
  if (bashCommands.some((command) => /\b(?:test|check|typecheck|lint|build)\b/i.test(command))) return "running checks";
  if (names.some((name) => name === "web_search" || name === "find" || name === "grep")) return "searching";
  if (names.includes("web_fetch")) return "reading source";
  if (names.includes("read")) return "reading files";
  if (names.some((name) => name === "git_status" || name === "git_diff") ||
    bashCommands.some((command) => /\bgit\s+(?:status|diff)\b/i.test(command))) return "inspecting changes";
  if (names.includes("jq")) return "analyzing data";
  if (names.includes("ls")) return "browsing files";
  if (names.includes("bash")) return "running command";
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
  const finishEarly = (status: "bugged" | "error", error: string): ChildRunResult => {
    const endedAt = Date.now();
    return {
      ...base, status, task: options.task.task, cwd: options.task.cwd, output: "", error: truncateText(error, MAX_AGENT_ERROR_BYTES).text,
      exitCode: null, endedAt, durationMs: endedAt - startedAt, truncated: false,
    };
  };
  if (options.signal?.aborted) return finishEarly("error", "Subagent was cancelled before launch");

  let files: Awaited<ReturnType<typeof createRunFiles>>;
  try {
    await validatePreflight(definition, options.task);
    files = await createRunFiles(definition);
  } catch (error) {
    return finishEarly("error", `Subagent preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const args = buildPiArgs({ definition, promptPath: files.promptPath });
  const invocation = options.invocation
    ? { command: options.invocation.command, args: [...options.invocation.argsPrefix] }
    : resolvePiInvocation([]);
  const realCliPath = invocation.command === process.execPath || /(?:^|[/\\])node(?:\.exe)?$/i.test(invocation.command)
    ? invocation.args.shift()
    : options.env?.PI_CONFIG_SUBAGENT_CLI_PATH ?? process.env.PI_CONFIG_SUBAGENT_CLI_PATH ?? fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  if (!realCliPath) {
    await removeRunFiles(files.dir).catch(() => undefined);
    return finishEarly("error", "Subagent Pi CLI path is unavailable");
  }
  const cliPath = fileURLToPath(new URL("./subagents-launcher.mjs", import.meta.url));

  const model = options.model?.split("/");
  const state: ProtocolState = { output: "", usage: emptyUsage(), turns: 0, toolCalls: 0 };
  let progress: ChildRunProgress = { ...base, status: "starting" };
  const activeTools = new Map<string, ActiveTool>();
  const editedFiles = new Set<string>();
  let stop: "aborted" | "stale" | "startup" | undefined;
  let stderr = "";
  let client: RpcClient | undefined;
  let staleTimer: NodeJS.Timeout | undefined;
  let startupTimer: NodeJS.Timeout | undefined;
  let progressTimer: NodeJS.Timeout | undefined;
  let settled = false;
  let resolveStopped!: () => void;
  let resolveIdle!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
  const idle = new Promise<void>((resolve) => { resolveIdle = resolve; });

  const emit = () => {
    const visible = state.partialText === undefined
      ? truncateText(state.output)
      : truncateBufferedText(state.partialText, state.partialOmittedBytes ?? 0, MAX_RESULT_BYTES);
    progress = {
      ...progress,
      turns: state.turns,
      toolCalls: state.toolCalls,
      text: visible.text,
      usage: reportedUsage(state),
      currentTool: [...activeTools.values()].at(-1)?.name,
      activity: summarizeActivity(activeTools.values(), editedFiles),
    };
    try { options.onUpdate?.({ ...progress, usage: { ...progress.usage, cost: { ...progress.usage.cost } } }); } catch {}
  };
  const requestStop = (reason: NonNullable<typeof stop>) => {
    if (stop || settled) return;
    stop = reason;
    if (client) void stopRpcClient(client).finally(resolveStopped);
    else resolveStopped();
  };
  const activity = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => requestStop("stale"), options.staleTimeoutMs ?? SUBAGENT_STALE_TIMEOUT_MS);
    staleTimer.unref?.();
  };

  try {
    client = new RpcClient({
      cliPath,
      cwd: options.task.cwd,
      env: {
        ...options.env,
        PI_CONFIG_SUBAGENT_CHILD: "1",
        PI_CONFIG_SUBAGENT_REAL_CLI: realCliPath,
        PI_CONFIG_SUBAGENT_STDERR_PATH: files.stderrPath,
      } as Record<string, string>,
      ...(model && model.length > 1 ? { provider: model.shift(), model: model.join("/") } : {}),
      args: [...invocation.args, ...args],
    });
    const unsubscribe = client.onEvent((event) => {
      activity();
      if (progress.status === "starting") progress = { ...progress, status: "running" };
      const summary = consumeProtocolEvent(JSON.stringify(event), state);
      if (summary?.type === "agent_settled") resolveIdle();
      if (summary?.type === "tool_execution_start") {
        state.toolCalls++;
        const id = summary.toolCallId ?? `tool-${state.toolCalls}`;
        const name = summary.toolName ?? "tool";
        activeTools.set(id, { name, args: summary.args });
        if (name === "edit" || name === "write") {
          const path = editedPath(summary.args);
          if (path) editedFiles.add(path);
        }
      } else if (summary?.type === "tool_execution_end") {
        if (summary.toolCallId) activeTools.delete(summary.toolCallId);
        else activeTools.clear();
      }
      emit();
    });
    startupTimer = setTimeout(() => requestStop("startup"), options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
    startupTimer.unref?.();
    await client.start();
    const childProcess = (client as unknown as { process?: {
      once: (event: string, listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
      exitCode: number | null;
      stderr?: { removeAllListeners: (event: string) => void; on: (event: string, listener: (chunk: Buffer) => void) => void };
    } }).process;
    childProcess?.stderr?.removeAllListeners("data");
    childProcess?.stderr?.on("data", () => {});
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!settled && !stop) state.assistantError = `Subagent RPC process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`;
      resolveStopped();
    };
    childProcess?.once("exit", onExit);
    if (childProcess?.exitCode !== null && childProcess?.exitCode !== undefined) onExit(childProcess.exitCode, null);
    if (startupTimer) clearTimeout(startupTimer);
    activity();
    await client.setAutoCompaction(true);
    await client.setThinkingLevel(definition.thinking);
    progressTimer = setInterval(emit, SUBAGENT_PROGRESS_INTERVAL_MS);
    progressTimer.unref?.();
    const onAbort = () => requestStop("aborted");
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    await client.prompt(`Complete the delegated task below.\n\n--- BEGIN DELEGATED TASK ---\n${options.task.task.trim()}\n--- END DELEGATED TASK ---`);
    await Promise.race([idle, stopped]);
    settled = true;
    options.signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    if (!stop && !state.assistantError) {
      const last = await client.getLastAssistantText();
      if (last !== null) state.output = last;
    }
    stderr = utf8Prefix(await readFile(files.stderrPath, "utf8"), MAX_AGENT_ERROR_BYTES);
  } catch (error) {
    stderr = utf8Prefix(await readFile(files.stderrPath, "utf8").catch(() => ""), MAX_AGENT_ERROR_BYTES);
    if (!stop) state.assistantError = truncateText(error instanceof Error ? error.message : String(error), MAX_AGENT_ERROR_BYTES).text;
  } finally {
    settled = true;
    for (const timer of [startupTimer, staleTimer]) if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    if (client) await stopRpcClient(client);
    try { await removeRunFiles(files.dir); } catch (error) {
      state.assistantError = truncateText(`Failed to remove subagent run files at ${files.dir}: ${error instanceof Error ? error.message : String(error)}`, MAX_AGENT_ERROR_BYTES).text;
    }
  }

  const bounded = state.partialText === undefined ? truncateText(state.output) : truncateBufferedText(state.partialText, state.partialOmittedBytes ?? 0, MAX_RESULT_BYTES);
  let status: ChildStatus = "done";
  let error: string | undefined;
  if (stop === "aborted") { status = "error"; error = "Subagent was cancelled"; }
  else if (stop === "stale") { status = "stale"; error = "Subagent became stale after no observable activity"; }
  else if (stop === "startup") { status = "bugged"; error = "Subagent emitted no Pi protocol event before the startup deadline"; }
  else if (state.assistantError || state.stopReason === "error" || state.stopReason === "aborted" || state.stopReason === "length") {
    status = "error";
    error = state.assistantError ?? `Subagent stopped with reason ${state.stopReason}`;
  } else if (!state.output.trim()) { status = "bugged"; error = "Subagent produced no final text response"; }
  const endedAt = Date.now();
  progress = { ...progress, status, text: bounded.text, turns: state.turns, toolCalls: state.toolCalls, usage: reportedUsage(state) };
  emit();
  return {
    ...progress, task: options.task.task, cwd: options.task.cwd, output: bounded.text,
    ...(error ? { error } : {}), ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
    exitCode: status === "done" ? 0 : null, model: state.model ?? options.model,
    ...(state.stopReason ? { stopReason: state.stopReason } : {}),
    endedAt, durationMs: endedAt - startedAt, truncated: bounded.truncated,
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
