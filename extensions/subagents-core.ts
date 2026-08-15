import { spawn } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";

export const MAX_SUBAGENT_TASKS = 6;
export const MAX_SUBAGENT_CONCURRENCY = 3;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 15 * 60_000;
export const MAX_SUBAGENT_TIMEOUT_MS = 30 * 60_000;
export const MAX_RESULT_CHARS = 16_000;
const MAX_JSON_LINE_CHARS = 2 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;
const KILL_GRACE_MS = 2_000;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AgentName = "scout" | "reviewer" | "worker" | "researcher" | "synthesizer";
export type ChildStatus = "completed" | "failed" | "aborted" | "timed_out";

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
  thinking: ThinkingLevel | "inherit";
  timeoutMs: number;
  contextFiles: boolean;
  extensions?: readonly string[];
  writer?: boolean;
}

export interface ChildTask {
  id: string;
  agent: AgentName;
  task: string;
  cwd: string;
}

export interface ChildRunResult {
  id: string;
  agent: AgentName;
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
}

export interface PiInvocation {
  command: string;
  argsPrefix: string[];
}

export interface RunChildOptions {
  definition: AgentDefinition;
  task: ChildTask;
  model?: string;
  thinking?: ThinkingLevel;
  signal?: AbortSignal;
  timeoutMs?: number;
  invocation?: PiInvocation;
  env?: NodeJS.ProcessEnv;
  onUpdate?: (update: { id: string; agent: AgentName; text: string; usage: UsageSummary }) => void;
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

interface ProtocolState {
  output: string;
  model?: string;
  stopReason?: string;
  assistantError?: string;
  usage: UsageSummary;
  turns: number;
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

export function consumeProtocolLine(line: string, state: ProtocolState): boolean {
  if (!line.trim()) return false;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }
  if (!event || typeof event !== "object") return false;
  const record = event as { type?: unknown; message?: unknown; error?: unknown };
  const messageValue = record.type === "message_end" ? record.message : undefined;
  if (!messageValue || typeof messageValue !== "object") return true;

  const message = messageValue as AssistantMessageLike;
  if (message.role !== "assistant") return true;
  state.turns++;
  state.usage = addUsage(state.usage, normalizeUsage(message.usage));
  const text = extractAssistantText(message);
  if (text) state.output = text;
  if (typeof message.provider === "string" && typeof message.model === "string") {
    state.model = `${message.provider}/${message.model}`;
  } else if (typeof message.model === "string") {
    state.model = message.model;
  }
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    state.assistantError = message.errorMessage.trim();
  }
  return true;
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
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && isAbsolute(currentScript)) {
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

function appendTail(current: string, chunk: string, limit: number): string {
  const next = current + chunk;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

export async function runChildAgent(options: RunChildOptions): Promise<ChildRunResult> {
  const startedAt = Date.now();
  if (options.signal?.aborted) {
    return {
      id: options.task.id,
      agent: options.definition.name,
      status: "aborted",
      task: options.task.task,
      cwd: options.task.cwd,
      output: "",
      error: "Subagent was aborted before launch",
      exitCode: null,
      model: options.model,
      durationMs: 0,
      usage: emptyUsage(),
      truncated: false,
    };
  }
  const runFiles = await createRunFiles(options.definition, options.task);
  const timeoutMs = Math.min(
    Math.max(1, options.timeoutMs ?? options.definition.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS),
    MAX_SUBAGENT_TIMEOUT_MS,
  );
  const thinking = options.definition.thinking === "inherit" ? options.thinking : options.definition.thinking;
  const piArgs = buildPiArgs({
    definition: options.definition,
    promptPath: runFiles.promptPath,
    taskPath: runFiles.taskPath,
    model: options.model,
    thinking,
  });
  const invocation = options.invocation
    ? { command: options.invocation.command, args: [...options.invocation.argsPrefix, ...piArgs] }
    : resolvePiInvocation(piArgs);

  const state: ProtocolState = { output: "", usage: emptyUsage(), turns: 0 };
  let stderr = "";
  let protocolBuffer = "";
  let protocolError: string | undefined;
  let spawnError: string | undefined;
  let requestedStop: "aborted" | "timed_out" | "protocol" | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | undefined;
  let killTimer: NodeJS.Timeout | undefined;

  try {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.task.cwd,
      env: { ...process.env, ...options.env, PI_CONFIG_SUBAGENT_CHILD: "1" },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");

    const requestStop = (reason: typeof requestedStop) => {
      if (requestedStop) return;
      requestedStop = reason;
      terminateProcess(child.pid, "SIGTERM");
      killTimer = setTimeout(() => terminateProcess(child.pid, "SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    };

    const processLine = (line: string) => {
      const previousOutput = state.output;
      const consumed = consumeProtocolLine(line, state);
      if (!consumed && line.trim() && !protocolError) protocolError = "Child emitted malformed JSON output";
      if (state.output && state.output !== previousOutput) {
        try {
          options.onUpdate?.({ id: options.task.id, agent: options.definition.name, text: state.output, usage: state.usage });
        } catch {
          // Rendering progress is best-effort and must not destabilize the child process lifecycle.
        }
      }
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
    });

    const onAbort = () => requestStop("aborted");
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => requestStop("timed_out"), timeoutMs);
    timeout.unref?.();

    await new Promise<void>((resolveClose) => {
      child.once("close", (code, signal) => {
        exitCode = code;
        exitSignal = signal ?? undefined;
        resolveClose();
      });
    });

    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", onAbort);
    protocolBuffer += decoder.end();
    if (protocolBuffer.trim()) processLine(protocolBuffer);
  } finally {
    await rm(runFiles.dir, { recursive: true, force: true }).catch(() => {});
  }

  const bounded = truncateText(state.output);
  let status: ChildStatus = "completed";
  let error: string | undefined;
  if (requestedStop === "aborted") {
    status = "aborted";
    error = "Subagent was aborted";
  } else if (requestedStop === "timed_out") {
    status = "timed_out";
    error = `Subagent timed out after ${timeoutMs}ms`;
  } else if (requestedStop === "protocol") {
    status = "failed";
    error = protocolError ?? "Subagent protocol failed";
  } else if (spawnError) {
    status = "failed";
    error = `Failed to start subagent: ${spawnError}`;
  } else if (exitCode !== 0) {
    status = "failed";
    error = `Subagent exited with code ${exitCode ?? "unknown"}`;
  } else if (state.assistantError || state.stopReason === "error" || state.stopReason === "aborted") {
    status = "failed";
    error = state.assistantError ?? `Subagent stopped with reason ${state.stopReason}`;
  } else if (state.stopReason === "length") {
    status = "failed";
    error = "Subagent reached its output limit before completing";
  } else if (!state.output.trim()) {
    status = "failed";
    error = protocolError ?? "Subagent produced no final text response";
  }

  return {
    id: options.task.id,
    agent: options.definition.name,
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
    durationMs: Date.now() - startedAt,
    usage: state.usage,
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
