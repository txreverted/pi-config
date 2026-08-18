import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addUsage,
  emptyUsage,
  normalizeUsage,
  SUBAGENT_LIMITS,
  validateAgentResultPayload,
  type AgentProgress,
  type AgentResultPayload,
  type AgentRunResult,
  type AgentTask,
} from "./core.ts";
import { safeDisplayLine, safeDisplayText } from "../text-safety.ts";
import { ROLE_DEFINITIONS, type ThinkingLevel } from "./roles.ts";

export interface ChildRunOptions {
  task: AgentTask;
  workspace: string;
  model: string;
  thinking: ThinkingLevel;
  prompt: string;
  systemPrompt: string;
  trusted: boolean;
  signal?: AbortSignal;
  runtimeMs?: number;
  startupMs?: number;
  invocation?: { command: string; argsPrefix: string[] };
  onUpdate?: (progress: AgentProgress) => void;
}

function utf8Prefix(value: string, maximum: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximum) return value;
  let end = maximum;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

function appendTail(current: string, chunk: string, maximum: number): string {
  const combined = current + chunk;
  const bytes = Buffer.from(combined, "utf8");
  if (bytes.length <= maximum) return combined;
  return bytes.subarray(bytes.length - maximum).toString("utf8");
}

function piInvocation(): { command: string; argsPrefix: string[] } {
  const currentScript = process.argv[1];
  const name = currentScript ? basename(currentScript).toLowerCase() : "";
  const isPi = name === "pi" || name === "pi.js" || ((name === "cli.js" || name === "cli.ts") && currentScript?.includes("pi-coding-agent"));
  if (currentScript && !currentScript.startsWith("/$bunfs/root/") && isAbsolute(currentScript) && isPi) {
    return { command: process.execPath, argsPrefix: [currentScript] };
  }
  const executable = basename(process.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(executable)
    ? { command: process.platform === "win32" ? "pi.cmd" : "pi", argsPrefix: [] }
    : { command: process.execPath, argsPrefix: [] };
}

function terminate(child: ChildProcess, force = false): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeout: 2_000 }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {}
  }
}

function activity(tool: string, args: Record<string, unknown> | undefined): string {
  const rawPath = typeof args?.path === "string" ? args.path : typeof args?.file_path === "string" ? args.file_path : undefined;
  const path = rawPath === undefined ? undefined : safeDisplayLine(rawPath, 500);
  if (tool === "edit" || tool === "write") return path ? `editing ${path}` : "editing files";
  if (tool === "read") return path ? `reading ${path}` : "reading files";
  if (tool === "grep" || tool === "find" || tool === "ls") return "searching";
  if (tool === "git_diff") return "inspecting changes";
  if (tool === "agent_result") return "finishing";
  return `using ${tool}`;
}

export async function runChildAgent(options: ChildRunOptions): Promise<AgentRunResult> {
  const startedAt = Date.now();
  let progress: AgentProgress = {
    id: options.task.id,
    role: options.task.role,
    title: options.task.title,
    ...(options.task.todoId === undefined ? {} : { todoId: options.task.todoId }),
    status: "starting",
    toolCalls: 0,
    turns: 0,
    startedAt,
    usage: emptyUsage(),
    model: options.model,
    thinking: options.thinking,
  };
  const publish = () => {
    try { options.onUpdate?.({ ...progress, usage: { ...progress.usage, cost: { ...progress.usage.cost } } }); } catch {}
  };
  publish();
  if (options.signal?.aborted) {
    return {
      ...progress,
      status: "cancelled",
      activity: "cancelled",
      endedAt: Date.now(),
      objective: options.task.objective,
      error: "Subagent was cancelled before launch",
      changedFiles: [],
    };
  }

  const runDir = await mkdtemp(join(tmpdir(), "pi-config-agent-"));
  await chmod(runDir, 0o700);
  const promptPath = join(runDir, "system.md");
  await writeFile(promptPath, options.systemPrompt, { mode: 0o600 });
  const childExtension = fileURLToPath(new URL("./child.ts", import.meta.url));
  const role = ROLE_DEFINITIONS[options.task.role];
  const args = [
    "--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    options.trusted ? "--approve" : "--no-approve",
    "--extension", childExtension,
    "--tools", role.tools.join(","),
    "--model", options.model,
    "--thinking", options.thinking,
    "--append-system-prompt", promptPath,
    options.prompt,
  ];
  const invocation = options.invocation ?? piInvocation();
  const child = spawn(invocation.command, [...invocation.argsPrefix, ...args], {
    cwd: options.workspace,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_CONFIG_SUBAGENT_CHILD: "1",
      PI_CONFIG_AGENT_ROLE: options.task.role,
      PI_CONFIG_AGENT_WORKSPACE: options.workspace,
      PI_CONFIG_AGENT_CWD: options.workspace,
      PI_CONFIG_AGENT_WRITABLE: role.mutatesWorkspace ? "1" : "0",
    },
  });

  let buffer = "";
  let stderr = "";
  let outputBytes = 0;
  let started = false;
  let payload: AgentResultPayload | undefined;
  let error: string | undefined;
  let stop: "cancelled" | "runtime" | "startup" | "output" | "tokens" | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const activeTools = new Map<string, string>();

  const requestStop = (reason: NonNullable<typeof stop>) => {
    if (stop || child.exitCode !== null) return;
    stop = reason;
    terminate(child);
    killTimer = setTimeout(() => terminate(child, true), 2_000);
    killTimer.unref?.();
  };
  const startupTimer = setTimeout(() => requestStop("startup"), options.startupMs ?? SUBAGENT_LIMITS.startupMs);
  startupTimer.unref?.();
  const runtimeTimer = setTimeout(() => requestStop("runtime"), options.runtimeMs ?? SUBAGENT_LIMITS.runtimeMs);
  runtimeTimer.unref?.();
  const progressTimer = setInterval(publish, 1_000);
  progressTimer.unref?.();
  const onAbort = () => requestStop("cancelled");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  const processEvent = (line: string) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== "object") return;
    const event = value as Record<string, unknown>;
    if (typeof event.type !== "string") return;
    if (!started) {
      started = true;
      clearTimeout(startupTimer);
      progress = { ...progress, status: "running" };
    }
    if (event.type === "tool_execution_start") {
      progress.toolCalls++;
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      const id = typeof event.toolCallId === "string" ? event.toolCallId : `${progress.toolCalls}`;
      activeTools.set(id, name);
      progress.currentTool = name;
      progress.activity = activity(name, event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : undefined);
    } else if (event.type === "tool_execution_end") {
      if (typeof event.toolCallId === "string") activeTools.delete(event.toolCallId);
      else activeTools.clear();
      progress.currentTool = [...activeTools.values()].at(-1);
      if (!progress.currentTool) progress.activity = "thinking";
    } else if (event.type === "message_end" && event.message && typeof event.message === "object") {
      const message = event.message as Record<string, unknown>;
      if (message.role === "assistant") {
        progress.turns++;
        progress.usage = addUsage(progress.usage, normalizeUsage(message.usage));
        if (progress.usage.totalTokens > SUBAGENT_LIMITS.agentTokens) requestStop("tokens");
        if (typeof message.provider === "string" && typeof message.model === "string") progress.model = `${message.provider}/${message.model}`;
        else if (typeof message.model === "string") progress.model = message.model;
        if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "length") {
          error = typeof message.errorMessage === "string" ? message.errorMessage : `Child stopped with reason ${message.stopReason}`;
        }
      }
      if (message.role === "toolResult" && message.toolName === "agent_result") {
        const details = message.details;
        if (details && typeof details === "object" && (details as Record<string, unknown>).agentResult) {
          try {
            payload = validateAgentResultPayload((details as Record<string, unknown>).agentResult);
          } catch (cause) {
            payload = undefined;
            error = `Invalid child agentResult: ${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }
      }
    }
    publish();
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > SUBAGENT_LIMITS.processOutputBytes) {
      requestStop("output");
      return;
    }
    buffer += chunk.toString("utf8");
    if (Buffer.byteLength(buffer, "utf8") > 1024 * 1024 && !buffer.includes("\n")) {
      requestStop("output");
      return;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) processEvent(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.length;
    stderr = appendTail(stderr, chunk.toString("utf8"), SUBAGENT_LIMITS.stderrBytes);
    if (outputBytes > SUBAGENT_LIMITS.processOutputBytes) requestStop("output");
  });

  const exitCode = await new Promise<number | null>((resolvePromise) => {
    child.once("error", (cause) => {
      error = `Failed to start child Pi: ${cause.message}`;
      resolvePromise(null);
    });
    child.once("close", (code) => resolvePromise(code));
  });
  if (buffer.trim()) processEvent(buffer);
  clearTimeout(startupTimer);
  clearTimeout(runtimeTimer);
  clearInterval(progressTimer);
  if (killTimer) clearTimeout(killTimer);
  options.signal?.removeEventListener("abort", onAbort);
  await rm(runDir, { recursive: true, force: true }).catch((cause: Error) => {
    error = `${error ? `${error}; ` : ""}Failed to remove child prompt directory: ${cause.message}`;
  });

  let status: AgentRunResult["status"];
  if (stop === "cancelled") status = "cancelled";
  else if (payload?.status === "blocked") status = "blocked";
  else if (!stop && exitCode === 0 && payload?.status === "succeeded" && !error) status = "succeeded";
  else status = "failed";
  if (!error) {
    if (stop === "runtime") error = "Subagent exceeded its wall-clock limit";
    else if (stop === "startup") error = "Subagent emitted no event before the startup deadline";
    else if (stop === "output") error = "Subagent exceeded its process output limit";
    else if (stop === "tokens") error = `Subagent exceeded its ${SUBAGENT_LIMITS.agentTokens}-token limit`;
    else if (stop === "cancelled") error = "Subagent was cancelled";
    else if (exitCode !== 0) error = `Subagent exited with code ${exitCode ?? "unknown"}`;
    else if (!payload) error = "Subagent did not call agent_result";
  }
  const endedAt = Date.now();
  return {
    ...progress,
    status,
    endedAt,
    activity: status,
    objective: options.task.objective,
    ...(payload ? { result: payload } : {}),
    ...(error ? { error: utf8Prefix(safeDisplayText(error), SUBAGENT_LIMITS.resultBytes) } : {}),
    ...(stderr.trim() ? { stderr: utf8Prefix(safeDisplayText(stderr.trim()), SUBAGENT_LIMITS.stderrBytes) } : {}),
    changedFiles: [],
  };
}
