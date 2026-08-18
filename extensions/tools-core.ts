import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_PROCESS_TIMEOUT_MS = 2 * 60_000;
export const DEFAULT_PROCESS_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PROCESS_MAX_MEMORY_BYTES = 256 * 1024 * 1024;
// ponytail: RSS polling is not a kernel hard cap; upgrade when a maintained cross-platform limiter can constrain native jq.
const DEFAULT_MEMORY_POLL_MS = 250;
const STDERR_MAX_BYTES = 16 * 1024;
const CAPTURE_PADDING_BYTES = 4;
const KILL_GRACE_MS = 2_000;

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  outputLimitReached?: number;
}

export interface BoundedProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  input?: string;
  timeoutMs?: number;
  tempPrefix?: string;
  maxOutputBytes?: number;
  maxMemoryBytes?: number;
  memoryPollMs?: number;
  memoryUsage?: (pid: number) => Promise<number | undefined>;
  env?: NodeJS.ProcessEnv;
}

export async function removeBoundedOutput(fullOutputPath: string): Promise<void> {
  await rm(dirname(fullOutputPath), { recursive: true, force: true });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function processMemoryBytes(pid: number): Promise<number | undefined> {
  const command = process.platform === "win32" ? "powershell.exe" : "ps";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`]
    : ["-o", "rss=", "-p", String(pid)];
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const measured = Number(String(stdout).trim());
      resolve(Number.isFinite(measured) && measured >= 0
        ? process.platform === "win32" ? measured : measured * 1024
        : undefined);
    });
  });
}

function terminateProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch {
    // The process may already have exited.
  }
}

function appendTail(current: Buffer, chunk: Buffer, maxBytes: number): Buffer {
  if (chunk.length >= maxBytes) return chunk.subarray(chunk.length - maxBytes);
  if (current.length + chunk.length <= maxBytes) return Buffer.concat([current, chunk]);
  const keep = maxBytes - chunk.length;
  return Buffer.concat([current.subarray(current.length - keep), chunk]);
}

function totalRecords(totalBytes: number, delimiterCount: number, endsWithDelimiter: boolean): number {
  return delimiterCount + (totalBytes > 0 && !endsWithDelimiter ? 1 : 0);
}

function actualTruncation(
  sample: Buffer,
  totalBytes: number,
  records: number,
): TruncationResult {
  const base = truncateHead(sample.toString("utf8"), {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  const truncated = totalBytes > DEFAULT_MAX_BYTES || records > DEFAULT_MAX_LINES;
  return {
    ...base,
    truncated,
    truncatedBy: base.truncatedBy ??
      (records > DEFAULT_MAX_LINES ? "lines" : totalBytes > DEFAULT_MAX_BYTES ? "bytes" : null),
    totalBytes,
    totalLines: records,
  };
}

export async function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  if (options.signal?.aborted) throw new Error("Operation aborted");
  if ([command, options.cwd, ...args].some((value) => value.includes("\0"))) {
    throw new Error(`Failed to start ${command}: command paths and arguments cannot contain NUL bytes`);
  }

  const maxOutputBytes = positiveInteger(options.maxOutputBytes ?? DEFAULT_PROCESS_MAX_OUTPUT_BYTES, "maxOutputBytes");
  const maxMemoryBytes = positiveInteger(options.maxMemoryBytes ?? DEFAULT_PROCESS_MAX_MEMORY_BYTES, "maxMemoryBytes");
  const memoryPollMs = positiveInteger(options.memoryPollMs ?? DEFAULT_MEMORY_POLL_MS, "memoryPollMs");
  const memoryUsage = options.memoryUsage ?? processMemoryBytes;
  const tempDir = await mkdtemp(join(tmpdir(), `${options.tempPrefix ?? `pi-${basename(command)}`}-`));
  const fullOutputPath = join(tempDir, "output.txt");
  const outputStream = createWriteStream(fullOutputPath, { flags: "wx", mode: 0o600 });
  const captureLimit = DEFAULT_MAX_BYTES + CAPTURE_PADDING_BYTES;
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  let stdoutBytes = 0;
  let outputBytes = 0;
  let delimiterCount = 0;
  let endsWithDelimiter = false;
  let stderr: Buffer = Buffer.alloc(0);
  let stderrBytes = 0;
  let streamError: Error | undefined;
  let spawnError: Error | undefined;
  let stopReason: "aborted" | "timed_out" | "stream_error" | "output_limit" | "memory_limit" | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let memoryTimer: NodeJS.Timeout | undefined;
  let checkingMemory = false;
  let childClosed = false;

  const child = spawn(command, [...args], {
    cwd: options.cwd,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    env: options.env,
  });

  const requestStop = (reason: typeof stopReason) => {
    if (stopReason) return;
    stopReason = reason;
    terminateProcess(child.pid, "SIGTERM");
    killTimer = setTimeout(() => terminateProcess(child.pid, "SIGKILL"), KILL_GRACE_MS);
    killTimer.unref?.();
  };

  outputStream.once("error", (error) => {
    streamError = error;
    requestStop("stream_error");
  });

  child.stdout.on("data", (chunk: Buffer) => {
    if (stopReason === "output_limit") return;

    const remaining = Math.max(0, maxOutputBytes - outputBytes);
    const portion = chunk.subarray(0, Math.min(chunk.length, remaining));
    stdoutBytes += portion.length;
    outputBytes += portion.length;
    for (const byte of portion) {
      if (byte === 0x0a) delimiterCount++;
    }
    if (portion.length > 0) endsWithDelimiter = portion[portion.length - 1] === 0x0a;

    if (capturedBytes < captureLimit) {
      const capturedPortion = portion.subarray(0, captureLimit - capturedBytes);
      captured.push(capturedPortion);
      capturedBytes += capturedPortion.length;
    }

    if (portion.length > 0 && !outputStream.write(portion)) {
      child.stdout.pause();
      outputStream.once("drain", () => child.stdout.resume());
    }
    if (outputBytes >= maxOutputBytes || portion.length < chunk.length) requestStop("output_limit");
  });

  child.stderr.on("data", (chunk: Buffer) => {
    if (stopReason === "output_limit") return;
    const remaining = Math.max(0, maxOutputBytes - outputBytes);
    const portion = chunk.subarray(0, Math.min(chunk.length, remaining));
    outputBytes += portion.length;
    stderrBytes += portion.length;
    stderr = appendTail(stderr, portion, STDERR_MAX_BYTES);
    if (outputBytes >= maxOutputBytes || portion.length < chunk.length) requestStop("output_limit");
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  const onAbort = () => requestStop("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS, "timeoutMs");
  const timeout = setTimeout(() => requestStop("timed_out"), timeoutMs);
  timeout.unref?.();
  const checkMemory = async () => {
    if (checkingMemory || stopReason || !child.pid) return;
    checkingMemory = true;
    try {
      const used = await memoryUsage(child.pid);
      if (!childClosed && used !== undefined && used > maxMemoryBytes) requestStop("memory_limit");
    } finally {
      checkingMemory = false;
    }
  };
  memoryTimer = setInterval(() => void checkMemory(), memoryPollMs);
  memoryTimer.unref?.();
  void checkMemory();

  child.stdin.on("error", () => {
    // The process may close stdin after producing its own useful diagnostic.
  });
  child.stdin.end(options.input);

  let code: number | null = null;
  await new Promise<void>((resolveClose) => {
    child.once("close", (exitCode) => {
      childClosed = true;
      code = exitCode;
      resolveClose();
    });
  });

  clearTimeout(timeout);
  if (memoryTimer) clearInterval(memoryTimer);
  if (killTimer) clearTimeout(killTimer);
  options.signal?.removeEventListener("abort", onAbort);
  outputStream.end();
  await finished(outputStream).catch((error: Error) => {
    streamError ??= error;
  });

  const removeOutput = async () => rm(tempDir, { recursive: true, force: true }).catch(() => {});
  if (stopReason === "aborted") {
    await removeOutput();
    throw new Error("Operation aborted");
  }
  if (stopReason === "timed_out") {
    await removeOutput();
    throw new Error(`${command} timed out after ${timeoutMs}ms`);
  }
  if (stopReason === "memory_limit") {
    await removeOutput();
    throw new Error(`${command} exceeded the ${maxMemoryBytes}-byte memory limit`);
  }
  if (spawnError) {
    await removeOutput();
    throw new Error(`Failed to start ${command}: ${spawnError.message}`);
  }
  if (streamError) {
    await removeOutput();
    throw new Error(`Failed to capture ${command} output: ${streamError.message}`);
  }

  const records = totalRecords(stdoutBytes, delimiterCount, endsWithDelimiter);
  const sample = Buffer.concat(captured, capturedBytes);
  const truncation = actualTruncation(sample, stdoutBytes, records);
  const stderrText = stderr.toString("utf8");
  const stderrNotice = stderrBytes > stderr.length
    ? `[stderr truncated: showing last ${stderr.length} of ${stderrBytes} bytes]\n${stderrText}`
    : stderrText;

  if (!truncation.truncated) await removeOutput();

  return {
    stdout: truncation.content,
    stderr: stderrNotice,
    code: code ?? 1,
    ...(truncation.truncated ? { truncation, fullOutputPath } : {}),
    ...(stopReason === "output_limit" ? { outputLimitReached: maxOutputBytes } : {}),
  };
}
