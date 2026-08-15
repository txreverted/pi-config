import { spawn } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import {
  createFindTool,
  createGrepTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  getAgentDir,
  truncateHead,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_PROCESS_TIMEOUT_MS = 2 * 60_000;
export const DEFAULT_PROCESS_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
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
  outputDelimiter?: "newline" | "nul";
}

export type ManagedSearchTool = "fd" | "rg";

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveSearchExecutable(tool: ManagedSearchTool): Promise<string | undefined> {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const managedPath = join(getAgentDir(), "bin", `${tool}${suffix}`);
  if (await isExecutable(managedPath)) return managedPath;

  const names = tool === "fd" ? ["fd", "fdfind"] : ["rg"];
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.COM").split(";").filter((extension) => [".EXE", ".COM"].includes(extension.toUpperCase()))
    : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = join(directory, process.platform === "win32" ? `${name}${extension}` : name);
        if (await isExecutable(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/** Use Pi's maintained downloader to install fd/rg, then return the resolved executable. */
export async function ensureSearchExecutable(
  tool: ManagedSearchTool,
  signal?: AbortSignal,
): Promise<string> {
  const existing = await resolveSearchExecutable(tool);
  if (existing) return existing;

  const probeDirectory = await mkdtemp(join(tmpdir(), `pi-${tool}-install-`));
  try {
    if (tool === "rg") {
      await createGrepTool(probeDirectory).execute(
        "install-rg",
        { pattern: "__pi_config_install_probe_no_match__", path: ".", literal: true },
        signal,
      );
    } else {
      await createFindTool(probeDirectory).execute(
        "install-fd",
        { pattern: "__pi_config_install_probe_no_match__", path: ".", limit: 1 },
        signal,
      );
    }
  } finally {
    await rm(probeDirectory, { recursive: true, force: true });
  }

  const installed = await resolveSearchExecutable(tool);
  if (!installed) throw new Error(`${tool} is not installed and Pi could not install it`);
  return installed;
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

function totalRecords(totalBytes: number, delimiterCount: number, endsWithDelimiter: boolean): number {
  return delimiterCount + (totalBytes > 0 && !endsWithDelimiter ? 1 : 0);
}

function actualTruncation(
  sample: Buffer,
  totalBytes: number,
  records: number,
  delimiter: "newline" | "nul",
): TruncationResult {
  if (delimiter === "newline") {
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

  let outputBytes = 0;
  let outputLines = 0;
  for (let index = 0; index < sample.length && index < DEFAULT_MAX_BYTES; index++) {
    if (sample[index] !== 0) continue;
    outputBytes = index + 1;
    outputLines++;
    if (outputLines === DEFAULT_MAX_LINES) break;
  }
  const truncated = totalBytes > outputBytes;
  return {
    content: sample.subarray(0, outputBytes).toString("utf8"),
    truncated,
    truncatedBy: !truncated ? null : outputLines === DEFAULT_MAX_LINES ? "lines" : "bytes",
    totalBytes,
    totalLines: records,
    outputBytes,
    outputLines,
    lastLinePartial: false,
    firstLineExceedsLimit: records > 0 && outputLines === 0,
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
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

  const tempDir = await mkdtemp(join(tmpdir(), `${options.tempPrefix ?? `pi-${basename(command)}`}-`));
  const fullOutputPath = join(tempDir, "output.txt");
  const outputStream = createWriteStream(fullOutputPath, { flags: "wx", mode: 0o600 });
  const captureLimit = DEFAULT_MAX_BYTES + CAPTURE_PADDING_BYTES;
  const captured: Buffer[] = [];
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_PROCESS_MAX_OUTPUT_BYTES;
  const delimiter = options.outputDelimiter ?? "newline";
  const delimiterByte = delimiter === "nul" ? 0x00 : 0x0a;
  let capturedBytes = 0;
  let stdoutBytes = 0;
  let delimiterCount = 0;
  let endsWithDelimiter = false;
  let stderr: Buffer = Buffer.alloc(0);
  let stderrBytes = 0;
  let streamError: Error | undefined;
  let spawnError: Error | undefined;
  let stopReason: "aborted" | "timed_out" | "stream_error" | "output_limit" | undefined;
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
    if (stopReason === "output_limit") return;

    const remaining = Math.max(0, maxOutputBytes - stdoutBytes);
    const portion = chunk.subarray(0, Math.min(chunk.length, remaining));
    stdoutBytes += portion.length;
    for (const byte of portion) {
      if (byte === delimiterByte) delimiterCount++;
    }
    if (portion.length > 0) endsWithDelimiter = portion[portion.length - 1] === delimiterByte;

    if (capturedBytes < captureLimit) {
      const capturedPortion = portion.subarray(0, captureLimit - capturedBytes);
      captured.push(capturedPortion);
      capturedBytes += capturedPortion.length;
    }

    if (portion.length > 0 && !outputStream.write(portion)) {
      child.stdout.pause();
      outputStream.once("drain", () => child.stdout.resume());
    }
    if (portion.length < chunk.length) requestStop("output_limit");
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
  if (options.signal?.aborted) onAbort();
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

  const records = totalRecords(stdoutBytes, delimiterCount, endsWithDelimiter);
  const sample = Buffer.concat(captured, capturedBytes);
  const truncation = actualTruncation(sample, stdoutBytes, records, delimiter);
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
