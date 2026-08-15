import { spawn } from "node:child_process";
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
const STDERR_MAX_BYTES = 16 * 1024;
const CAPTURE_PADDING_BYTES = 4;
const KILL_GRACE_MS = 2_000;

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export interface BoundedProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  input?: string;
  timeoutMs?: number;
  tempPrefix?: string;
}

export async function removeBoundedOutput(fullOutputPath: string): Promise<void> {
  await rm(dirname(fullOutputPath), { recursive: true, force: true });
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

function totalLines(totalBytes: number, newlineCount: number, endsWithNewline: boolean): number {
  return newlineCount + (totalBytes > 0 && !endsWithNewline ? 1 : 0);
}

function actualTruncation(
  sample: string,
  totalBytes: number,
  lines: number,
): TruncationResult {
  const base = truncateHead(sample, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  const truncated = totalBytes > DEFAULT_MAX_BYTES || lines > DEFAULT_MAX_LINES;
  const truncatedBy = base.truncatedBy ??
    (lines > DEFAULT_MAX_LINES ? "lines" : totalBytes > DEFAULT_MAX_BYTES ? "bytes" : null);

  return {
    ...base,
    truncated,
    truncatedBy,
    totalBytes,
    totalLines: lines,
  };
}

export async function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  if (options.signal?.aborted) throw new Error("Operation aborted");

  const tempDir = await mkdtemp(join(tmpdir(), `${options.tempPrefix ?? `pi-${basename(command)}`}-`));
  const fullOutputPath = join(tempDir, "output.txt");
  const outputStream = createWriteStream(fullOutputPath, { flags: "wx", mode: 0o600 });
  const captureLimit = DEFAULT_MAX_BYTES + CAPTURE_PADDING_BYTES;
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  let stdoutBytes = 0;
  let newlineCount = 0;
  let endsWithNewline = false;
  let stderr: Buffer = Buffer.alloc(0);
  let stderrBytes = 0;
  let streamError: Error | undefined;
  let spawnError: Error | undefined;
  let stopReason: "aborted" | "timed_out" | "stream_error" | undefined;
  let killTimer: NodeJS.Timeout | undefined;

  const child = spawn(command, [...args], {
    cwd: options.cwd,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
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
    stdoutBytes += chunk.length;
    for (const byte of chunk) {
      if (byte === 0x0a) newlineCount++;
    }
    if (chunk.length > 0) endsWithNewline = chunk[chunk.length - 1] === 0x0a;

    if (capturedBytes < captureLimit) {
      const portion = chunk.subarray(0, captureLimit - capturedBytes);
      captured.push(portion);
      capturedBytes += portion.length;
    }

    if (!outputStream.write(chunk)) {
      child.stdout.pause();
      outputStream.once("drain", () => child.stdout.resume());
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    stderr = appendTail(stderr, chunk, STDERR_MAX_BYTES);
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  const onAbort = () => requestStop("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS);
  const timeout = setTimeout(() => requestStop("timed_out"), timeoutMs);
  timeout.unref?.();

  child.stdin.on("error", () => {
    // The process may close stdin after producing its own useful diagnostic.
  });
  child.stdin.end(options.input);

  let code: number | null = null;
  await new Promise<void>((resolveClose) => {
    child.once("close", (exitCode) => {
      code = exitCode;
      resolveClose();
    });
  });

  clearTimeout(timeout);
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
  if (spawnError) {
    await removeOutput();
    throw new Error(`Failed to start ${command}: ${spawnError.message}`);
  }
  if (streamError) {
    await removeOutput();
    throw new Error(`Failed to capture ${command} output: ${streamError.message}`);
  }

  const lines = totalLines(stdoutBytes, newlineCount, endsWithNewline);
  const sample = Buffer.concat(captured, capturedBytes).toString("utf8");
  const truncation = actualTruncation(sample, stdoutBytes, lines);
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
  };
}
