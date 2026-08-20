import { execFile, fork, type ChildProcess } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextContent } from "@earendil-works/pi-ai";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getAgentDir,
  truncateHead,
  truncateLine,
  type ExtensionAPI,
  type FindToolDetails,
  type FindToolInput,
  type GrepToolDetails,
  type GrepToolInput,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { escapeUnsafeDisplayText, safeDisplayLine, safeDisplayText } from "./text-safety.ts";
import { processWorkingSetBytes } from "./tools-core.ts";

const INDEX_STATUS_KEY = "indexed-search";
const REQUEST_TIMEOUT_MS = 3_000;
const RESCAN_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 1_000;
const MAX_PENDING_REQUESTS = 8;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_WORKER_MEMORY_BYTES = 768 * 1024 * 1024;
const MEMORY_POLL_MS = 5_000;
const GREP_PATTERN_MAX_BYTES = 1_024;
const FIND_PATTERN_MAX_BYTES = 1_024;
const PATH_MAX_BYTES = 4_096;
const GREP_LIMIT_MAX = 100;
const GREP_CONTEXT_MAX = 10;
const FIND_LIMIT_MAX = 1_000;
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\]/;
const EXTGLOB_SYNTAX = /[@+!?*]\(/;
const WORKER_PATH = fileURLToPath(new URL("./indexed-search-worker.mjs", import.meta.url));

interface WorkerEvent {
  event: "progress" | "ready" | "updated" | "failed" | "invalid";
  scannedFiles?: number;
  totalFiles?: number;
  files?: number;
  sourceBytes?: number;
  error?: string;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  value?: unknown;
  fallback?: boolean;
  error?: string;
}

interface FindIndexResult {
  available: true;
  items: string[];
  hasMore: boolean;
}

interface GrepIndexItem {
  path: string;
  lineNumber: number;
  line: string;
  before: string[];
  after: string[];
}

interface GrepIndexResult {
  available: true;
  items: GrepIndexItem[];
  hasMore: boolean;
}

interface SearchScope {
  searchRelative: string;
  searchType: "directory" | "file";
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class IndexUnavailableError extends Error {}

function searchEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH", "HOME", "USERPROFILE", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TMP", "TEMP",
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "XDG_CONFIG_HOME",
  ]);
  const result = Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && allowed.has(process.platform === "win32" ? name.toUpperCase() : name),
  ));
  for (const key of Object.keys(result)) if (key.toUpperCase() === "PATH") delete result[key];
  return {
    ...result,
    PATH: [join(getAgentDir(), "bin"), environment.PATH].filter(Boolean).join(delimiter),
    NODE_NO_WARNINGS: "1",
  };
}

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process group may already be gone.
  }
}

function appendDiagnostic(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= MAX_DIAGNOSTIC_BYTES) return chunk.subarray(chunk.length - MAX_DIAGNOSTIC_BYTES);
  if (current.length + chunk.length <= MAX_DIAGNOSTIC_BYTES) return Buffer.concat([current, chunk]);
  return Buffer.concat([current.subarray(current.length + chunk.length - MAX_DIAGNOSTIC_BYTES), chunk]);
}

function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (!value || typeof value !== "object") return false;
  const event = (value as { event?: unknown }).event;
  return event === "progress" || event === "ready" || event === "updated" || event === "failed" || event === "invalid";
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as { id?: unknown; ok?: unknown };
  return Number.isSafeInteger(response.id) && typeof response.ok === "boolean";
}

class IndexedSearchWorker {
  readonly root: string;
  ready = false;
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly onEvent: (event: WorkerEvent) => void;
  private nextId = 1;
  private stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private stderrBytes = 0;
  private stopped = false;
  private checkingMemory = false;
  private readonly memoryTimer: NodeJS.Timeout;

  constructor(root: string, onEvent: (event: WorkerEvent) => void) {
    this.root = root;
    this.onEvent = onEvent;
    this.child = fork(WORKER_PATH, [root], {
      detached: process.platform !== "win32",
      env: searchEnvironment(),
      execArgv: ["--no-warnings", "--max-old-space-size=512"],
      serialization: "json",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      this.stderr = appendDiagnostic(this.stderr, chunk);
      if (this.stderrBytes > 64 * 1024) this.fail(new Error("Indexed search worker produced excessive diagnostics"));
    });
    this.child.on("message", (message) => this.handleMessage(message));
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.stopped) return;
      const diagnostic = safeDisplayLine(this.stderr.toString("utf8"), 1_000);
      const suffix = diagnostic ? `: ${diagnostic}` : "";
      this.fail(new Error(`Indexed search worker exited (${signal ?? code ?? "unknown"})${suffix}`));
    });
    this.memoryTimer = setInterval(() => void this.checkMemory(), MEMORY_POLL_MS);
    this.memoryTimer.unref?.();
    void this.checkMemory();
  }

  private async checkMemory(): Promise<void> {
    if (this.checkingMemory || this.stopped || !this.child.pid) return;
    this.checkingMemory = true;
    try {
      const bytes = await processWorkingSetBytes(this.child.pid);
      if (!this.stopped && bytes !== undefined && bytes > MAX_WORKER_MEMORY_BYTES) {
        this.fail(new Error(`Indexed search worker exceeded the ${formatSize(MAX_WORKER_MEMORY_BYTES)} memory limit`));
      }
    } catch {
      // Working-set monitoring is best-effort.
    } finally {
      this.checkingMemory = false;
    }
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.onEvent({ event: "failed", error: error.message });
    void this.stop(error);
  }

  private handleMessage(message: unknown): void {
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
    } catch {
      void this.stop(new Error("Indexed search worker returned an invalid message"));
      return;
    }
    if (bytes > MAX_RESPONSE_BYTES) {
      void this.stop(new Error("Indexed search worker exceeded its response limit"));
      return;
    }
    if (isWorkerEvent(message)) {
      if (message.event === "ready" || message.event === "updated") this.ready = true;
      if (message.event === "failed" || message.event === "invalid") this.ready = false;
      this.onEvent(message);
      return;
    }
    if (!isWorkerResponse(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.finishRequest(message.id, pending);
    if (!message.ok || message.fallback) {
      pending.reject(new IndexUnavailableError(safeDisplayLine(message.error || "Indexed search is unavailable", 1_000)));
      return;
    }
    pending.resolve(message.value);
  }

  private finishRequest(id: number, pending: PendingRequest): void {
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
  }

  async request(
    method: "find" | "grep" | "status" | "rescan",
    params: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = REQUEST_TIMEOUT_MS,
    requireReady = true,
  ): Promise<unknown> {
    if (signal?.aborted) throw new Error("Operation aborted");
    if (this.stopped || !this.child.connected || (requireReady && !this.ready)) throw new IndexUnavailableError("Indexed search is unavailable");
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new IndexUnavailableError("Indexed search is busy");
    const id = this.nextId++;
    const message = { id, method, params };
    if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_REQUEST_BYTES) {
      throw new IndexUnavailableError("Indexed search request exceeded its byte limit");
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.finishRequest(id, pending);
        pending.reject(new IndexUnavailableError(`Indexed search timed out after ${timeoutMs}ms`));
        this.fail(new Error("Indexed search request timed out"));
      }, timeoutMs);
      timeout.unref?.();
      const pending: PendingRequest = { resolve: resolvePromise, reject: rejectPromise, timeout, signal };
      if (signal) {
        pending.onAbort = () => {
          const active = this.pending.get(id);
          if (!active) return;
          this.finishRequest(id, active);
          try {
            if (this.child.connected) this.child.send({ method: "cancel", target: id });
          } catch {
            // The worker may have exited with the request.
          }
          active.reject(new Error("Operation aborted"));
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(id, pending);
      try {
        this.child.send(message, (error) => {
          if (!error) return;
          const active = this.pending.get(id);
          if (!active) return;
          this.finishRequest(id, active);
          active.reject(new IndexUnavailableError(error.message));
        });
      } catch (error) {
        this.finishRequest(id, pending);
        rejectPromise(new IndexUnavailableError(error instanceof Error ? error.message : String(error)));
      }
    });
  }

  async stop(reason = new IndexUnavailableError("Indexed search worker stopped")): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    clearInterval(this.memoryTimer);
    for (const [id, pending] of this.pending) {
      this.finishRequest(id, pending);
      pending.reject(reason);
    }
    const exited = this.child.exitCode !== null || this.child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolveExit) => this.child.once("exit", () => resolveExit()));
    terminateProcessTree(this.child, "SIGTERM");
    const forced = new Promise<void>((resolveForce) => {
      const timer = setTimeout(resolveForce, STOP_GRACE_MS);
      timer.unref?.();
    });
    await Promise.race([exited, forced]);
    terminateProcessTree(this.child, "SIGKILL");
  }
}

function withinRoot(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function resolveSearchScope(root: string, cwd: string, input: string | undefined): Promise<SearchScope | undefined> {
  const actualCwd = await realpath(cwd).catch(() => undefined);
  if (!actualCwd || !samePath(actualCwd, root)) return undefined;
  const lexical = resolve(actualCwd, input || ".");
  const canonical = await realpath(lexical).catch(() => undefined);
  if (!canonical || !withinRoot(root, canonical) || !samePath(lexical, canonical)) return undefined;
  const information = await stat(canonical).catch(() => undefined);
  if (!information?.isDirectory() && !information?.isFile()) return undefined;
  return {
    searchRelative: relative(root, canonical).split(sep).join("/"),
    searchType: information.isFile() ? "file" : "directory",
  };
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number | undefined {
  const effective = value ?? fallback;
  return Number.isSafeInteger(effective) && effective >= 1 && effective <= maximum ? effective : undefined;
}

function safePath(value: string): string {
  return safeDisplayLine(escapeUnsafeDisplayText(value).replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n"), PATH_MAX_BYTES);
}

function boundedOutput(body: string, notices: string[]): { output: string; truncation?: TruncationResult } {
  const initialFooter = notices.length ? `\n\n[${notices.join(". ")}]` : "";
  const complete = `${body}${initialFooter}`;
  if (Buffer.byteLength(complete, "utf8") <= DEFAULT_MAX_BYTES && complete.split("\n").length <= DEFAULT_MAX_LINES) {
    return { output: complete };
  }
  const footerNotices = [...notices, `Output truncated to ${formatSize(DEFAULT_MAX_BYTES)}`];
  const footer = `\n\n[${footerNotices.join(". ")}]`;
  const truncation = truncateHead(body, {
    maxBytes: Math.max(1, DEFAULT_MAX_BYTES - Buffer.byteLength(footer, "utf8")),
    maxLines: Math.max(1, DEFAULT_MAX_LINES - footer.split("\n").length),
  });
  return { output: `${truncation.content}${footer}`, truncation };
}

function validateFindResult(value: unknown): FindIndexResult {
  if (!value || typeof value !== "object") throw new IndexUnavailableError("Indexed find returned invalid data");
  const result = value as { available?: unknown; items?: unknown; hasMore?: unknown };
  if (result.available !== true || !Array.isArray(result.items) || typeof result.hasMore !== "boolean" ||
      result.items.length > FIND_LIMIT_MAX || result.items.some((item) => typeof item !== "string" || Buffer.byteLength(item, "utf8") > PATH_MAX_BYTES)) {
    throw new IndexUnavailableError("Indexed find returned invalid data");
  }
  return result as FindIndexResult;
}

function validateGrepResult(value: unknown, context: number): GrepIndexResult {
  if (!value || typeof value !== "object") throw new IndexUnavailableError("Indexed grep returned invalid data");
  const result = value as { available?: unknown; items?: unknown; hasMore?: unknown };
  if (result.available !== true || !Array.isArray(result.items) || typeof result.hasMore !== "boolean" || result.items.length > GREP_LIMIT_MAX) {
    throw new IndexUnavailableError("Indexed grep returned invalid data");
  }
  for (const item of result.items) {
    if (!item || typeof item !== "object") throw new IndexUnavailableError("Indexed grep returned invalid data");
    const match = item as Partial<GrepIndexItem>;
    if (typeof match.path !== "string" || Buffer.byteLength(match.path, "utf8") > PATH_MAX_BYTES ||
        !Number.isSafeInteger(match.lineNumber) || match.lineNumber! < 1 || typeof match.line !== "string" ||
        !Array.isArray(match.before) || !Array.isArray(match.after) || match.before.length > context || match.after.length > context ||
        [...match.before, ...match.after].some((line) => typeof line !== "string")) {
      throw new IndexUnavailableError("Indexed grep returned invalid data");
    }
  }
  return result as GrepIndexResult;
}

export function formatIndexedFindResult(result: FindIndexResult, limit: number): { content: TextContent[]; details: FindToolDetails | undefined } {
  const body = result.items.length ? result.items.map(safePath).join("\n") : "No files found matching pattern";
  const notices = result.hasMore ? [`${limit} results limit reached. Use limit=${limit * 2} or refine pattern`] : [];
  const bounded = boundedOutput(body, notices);
  const details: FindToolDetails = {
    ...(result.hasMore ? { resultLimitReached: limit } : {}),
    ...(bounded.truncation ? { truncation: bounded.truncation } : {}),
  };
  return {
    content: [{ type: "text", text: bounded.output }],
    details: Object.keys(details).length ? details : undefined,
  };
}

export function formatIndexedGrepResult(result: GrepIndexResult, limit: number): { content: TextContent[]; details: GrepToolDetails | undefined } {
  if (!result.items.length) return { content: [{ type: "text", text: "No matches found" }], details: undefined };
  const lines: string[] = [];
  let linesTruncated = false;
  const addLine = (path: string, lineNumber: number, separator: ":" | "-", content: string) => {
    const safeContent = safeDisplayText(content).replace(/[\r\n]/g, "");
    const truncated = truncateLine(safeContent);
    if (truncated.wasTruncated) linesTruncated = true;
    lines.push(`${safePath(path)}${separator}${lineNumber}${separator} ${truncated.text}`);
  };
  for (const match of result.items) {
    match.before.forEach((line, index) => addLine(match.path, match.lineNumber - match.before.length + index, "-", line));
    addLine(match.path, match.lineNumber, ":", match.line);
    match.after.forEach((line, index) => addLine(match.path, match.lineNumber + index + 1, "-", line));
  }
  const notices: string[] = [];
  if (result.hasMore) notices.push(`${limit} matches limit reached. Use limit=${limit * 2} or refine pattern`);
  if (linesTruncated) notices.push("Some lines truncated. Use read to see full lines");
  const bounded = boundedOutput(lines.join("\n"), notices);
  const details: GrepToolDetails = {
    ...(result.hasMore ? { matchLimitReached: limit } : {}),
    ...(bounded.truncation ? { truncation: bounded.truncation } : {}),
    ...(linesTruncated ? { linesTruncated: true } : {}),
  };
  return {
    content: [{ type: "text", text: bounded.output }],
    details: Object.keys(details).length ? details : undefined,
  };
}

function canIndexGlob(pattern: string): boolean {
  return !isAbsolute(pattern) && Buffer.byteLength(pattern, "utf8") <= FIND_PATTERN_MAX_BYTES && !EXTGLOB_SYNTAX.test(pattern);
}

function canIndexGrep(params: GrepToolInput): boolean {
  return Array.from(params.pattern).length >= 3 && !params.pattern.includes("\n") && !params.pattern.includes("\r") &&
    Buffer.byteLength(params.pattern, "utf8") <= GREP_PATTERN_MAX_BYTES &&
    (params.literal === true || !REGEX_SYNTAX.test(params.pattern)) &&
    (params.ignoreCase !== true || /^[\x00-\x7f]+$/.test(params.pattern)) &&
    (params.glob === undefined || canIndexGlob(params.glob)) &&
    Number.isSafeInteger(params.context ?? 0) && (params.context ?? 0) >= 0 && (params.context ?? 0) <= GREP_CONTEXT_MAX;
}

export default function indexedSearchExtension(pi: ExtensionAPI): void {
  let worker: IndexedSearchWorker | undefined;
  let generation = 0;
  let registeredGeneration = -1;
  let latestContext: { ui: { setStatus: (key: string, text: string | undefined) => void; notify: (message: string, type?: "info" | "warning" | "error") => void } } | undefined;

  const ownsBuiltInSearch = () => {
    const configured = pi.getAllTools().filter((tool) => tool.name === "grep" || tool.name === "find");
    return configured.length === 2 && configured.every((tool) => tool.sourceInfo.source === "builtin");
  };

  const stopWorker = async () => {
    generation++;
    const active = worker;
    worker = undefined;
    latestContext?.ui.setStatus(INDEX_STATUS_KEY, undefined);
    if (active) await active.stop();
  };

  const registerOverrides = (active: IndexedSearchWorker, currentGeneration: number) => {
    if (registeredGeneration === currentGeneration || worker !== active || generation !== currentGeneration || !ownsBuiltInSearch()) return;
    registeredGeneration = currentGeneration;
    const nativeFind = createFindToolDefinition(active.root);
    const nativeGrep = createGrepToolDefinition(active.root);

    pi.registerTool({
      ...nativeFind,
      async execute(toolCallId, params: FindToolInput, signal, onUpdate, ctx) {
        const fallback = () => createFindToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        const limit = boundedInteger(params.limit, 1_000, FIND_LIMIT_MAX);
        if (!limit || !canIndexGlob(params.pattern)) return fallback();
        const scope = await resolveSearchScope(active.root, ctx.cwd, params.path);
        if (!scope || signal?.aborted) return signal?.aborted ? Promise.reject(new Error("Operation aborted")) : fallback();
        try {
          const result = validateFindResult(await active.request("find", { ...scope, pattern: params.pattern, limit }, signal));
          return formatIndexedFindResult(result, limit);
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.message === "Operation aborted")) throw new Error("Operation aborted");
          return fallback();
        }
      },
    });

    pi.registerTool({
      ...nativeGrep,
      async execute(toolCallId, params: GrepToolInput, signal, onUpdate, ctx) {
        const fallback = () => createGrepToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        const limit = boundedInteger(params.limit, 100, GREP_LIMIT_MAX);
        if (!limit || !canIndexGrep(params)) return fallback();
        const scope = await resolveSearchScope(active.root, ctx.cwd, params.path);
        if (!scope || signal?.aborted) return signal?.aborted ? Promise.reject(new Error("Operation aborted")) : fallback();
        const context = params.context ?? 0;
        try {
          const result = validateGrepResult(await active.request("grep", {
            ...scope,
            pattern: params.pattern,
            glob: params.glob,
            ignoreCase: params.ignoreCase === true,
            context,
            limit,
          }, signal), context);
          return formatIndexedGrepResult(result, limit);
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.message === "Operation aborted")) throw new Error("Operation aborted");
          return fallback();
        }
      },
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    await stopWorker();
    if (!ownsBuiltInSearch()) return;
    const root = await realpath(ctx.cwd).catch(() => undefined);
    if (!root) return;
    try {
      await createFindToolDefinition(root).execute(
        "indexed-search-fd-probe",
        { pattern: "__pi_indexed_search_probe_7f4a__", limit: 1 },
        undefined,
        undefined,
        ctx,
      );
    } catch (error) {
      ctx.ui.notify(`Indexed search unavailable. Pi will use native search. ${safeDisplayLine(error, 500)}`, "warning");
      return;
    }
    const currentGeneration = generation;
    latestContext = ctx;
    ctx.ui.setStatus(INDEX_STATUS_KEY, "indexing files");
    let active: IndexedSearchWorker;
    try {
      active = new IndexedSearchWorker(root, (event) => {
        if (worker !== active || generation !== currentGeneration) return;
        if (event.event === "progress") {
          const progress = Number.isSafeInteger(event.scannedFiles) && Number.isSafeInteger(event.totalFiles)
            ? `indexing ${event.scannedFiles}/${event.totalFiles}`
            : "indexing files";
          ctx.ui.setStatus(INDEX_STATUS_KEY, progress);
        } else if (event.event === "ready" || event.event === "updated") {
          ctx.ui.setStatus(INDEX_STATUS_KEY, undefined);
          registerOverrides(active, currentGeneration);
        } else {
          ctx.ui.setStatus(INDEX_STATUS_KEY, undefined);
          if (event.event === "failed") {
            ctx.ui.notify(`Indexed search unavailable. Pi will use native search. ${safeDisplayLine(event.error, 500)}`, "warning");
            if (worker === active) worker = undefined;
            void active.stop();
          }
        }
      });
      worker = active;
    } catch (error) {
      ctx.ui.setStatus(INDEX_STATUS_KEY, undefined);
      ctx.ui.notify(`Indexed search unavailable. Pi will use native search. ${safeDisplayLine(error, 500)}`, "warning");
    }
  });

  pi.registerCommand("search-index", {
    description: "Show or rebuild the session search index: /search-index [rescan]",
    handler: async (args, ctx) => {
      const active = worker;
      if (!active) {
        ctx.ui.notify("Indexed search is inactive. Pi is using native search.", "info");
        return;
      }
      const action = args.trim();
      if (action && action !== "rescan") {
        ctx.ui.notify("Usage: /search-index [rescan]", "warning");
        return;
      }
      try {
        const value = await active.request(action === "rescan" ? "rescan" : "status", {}, undefined, RESCAN_TIMEOUT_MS, false) as {
          available?: unknown; indexing?: unknown; files?: unknown; sourceBytes?: unknown;
        };
        const files = typeof value.files === "number" && Number.isSafeInteger(value.files) ? value.files : 0;
        const sourceBytes = typeof value.sourceBytes === "number" && Number.isSafeInteger(value.sourceBytes) ? value.sourceBytes : 0;
        const state = value.available === true ? "ready" : value.indexing === true ? "indexing" : "stale";
        ctx.ui.notify(`Search index: ${state}, ${files} files, ${formatSize(sourceBytes)} source`, "info");
      } catch (error) {
        ctx.ui.notify(`Search index failed: ${safeDisplayLine(error, 500)}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    latestContext = undefined;
    await stopWorker();
  });
}
