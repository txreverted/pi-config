import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  InlineExtension,
  ToolCallEventResult,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  SCOUT_TOOLS,
  SUBAGENT_LIMITS,
  toolBudgetForKind,
  type ScoutKind,
} from "./subagents-core.ts";
import { runOrderedPool } from "./subagents-pool.ts";
import { safeDisplayText } from "./text-safety.ts";

const GUARDED_TOOL_NAMES = new Set<string>(SCOUT_TOOLS);
const PROTECTED_SEGMENTS = new Set([".git", ".ssh", ".pi", ".codex", "sessions", "transcripts"]);
const PROTECTED_BASENAMES = new Set([
  "credentials",
  "credentials.json",
  "auth.json",
  "auth.jsonl",
  "settings.json",
  "settings.jsonl",
  "models.json",
  "models.jsonl",
  "trust.json",
  "trust.jsonl",
  "session.json",
  "session.jsonl",
  "sessions.json",
  "sessions.jsonl",
  "transcript.json",
  "transcript.jsonl",
  "transcripts.json",
  "transcripts.jsonl",
  "id_rsa",
  "id_ed25519",
]);
const IMAGE_SUFFIXES = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
]);
const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/gi;
const PROVIDER_TOKEN = /\b(?:github_pat_[A-Za-z0-9_]{4,}|ghp_[A-Za-z0-9]{4,}|sk-[A-Za-z0-9_-]{4,})\b/g;
const ASSIGNMENT = /((?:^|[^\p{L}\p{N}_])(["']?)([\p{L}\p{N}_.-]+)\2\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;#}\]\r\n]+)/gmu;
const MAX_SANITIZED_ERROR_CHARACTERS = 500;

export type ScoutPathBlockReason =
  | "invalid_path"
  | "traversal"
  | "outside_repository"
  | "symlink_escape"
  | "protected_path"
  | "image"
  | "unresolvable_path";

export type ScoutPathInspection =
  | { allowed: true; absolutePath: string; canonicalPath: string }
  | { allowed: false; reason: ScoutPathBlockReason; message: string };

export interface ScoutGuardOptions {
  cwd: string;
  kind: ScoutKind;
  repositoryRoot?: string;
}

export type ScoutPathInspector = typeof inspectScoutPath;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function relativeSegments(root: string, candidate: string): string[] {
  const child = relative(root, candidate);
  return child === "" ? [] : child.split(/[\\/]+/).filter(Boolean);
}

function privatePathReason(segments: readonly string[]): ScoutPathBlockReason | undefined {
  for (const segment of segments) {
    const normalized = segment.toLowerCase();
    if (PROTECTED_SEGMENTS.has(normalized) || normalized.startsWith(".env")) return "protected_path";
    if (PROTECTED_BASENAMES.has(normalized) || normalized.endsWith(".pem") || normalized.endsWith(".key")) {
      return "protected_path";
    }
  }
  const leaf = segments.at(-1)?.toLowerCase();
  if (!leaf) return undefined;
  if (IMAGE_SUFFIXES.has(leaf.slice(leaf.lastIndexOf(".")))) return "image";
  return undefined;
}

function blockMessage(reason: ScoutPathBlockReason): string {
  if (reason === "traversal") return "Scout paths cannot contain parent traversal segments.";
  if (reason === "outside_repository") return "Scout paths must stay inside the repository root.";
  if (reason === "symlink_escape") return "Scout paths cannot escape the repository through a symlink.";
  if (reason === "protected_path") return "Credentials, private state, and protected paths are unavailable to scouts.";
  if (reason === "image") return "Image files are unavailable to scouts.";
  if (reason === "unresolvable_path") return "The scout path could not be resolved safely.";
  return "The scout supplied an invalid path.";
}

async function canonicalizeFromNearestExisting(absolutePath: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = absolutePath;
  while (true) {
    try {
      await lstat(current);
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(basename(current));
      current = parent;
      continue;
    }

    const canonicalAncestor = await realpath(current);
    return missingSegments.length === 0
      ? canonicalAncestor
      : resolve(canonicalAncestor, ...missingSegments);
  }
}

/** Resolve the closest enclosing Git worktree root, falling back to the canonical cwd. */
export async function resolveRepositoryRoot(cwd: string): Promise<string> {
  const canonicalCwd = await realpath(resolve(cwd));
  let current = canonicalCwd;
  while (true) {
    try {
      await lstat(join(current, ".git"));
      return current;
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return canonicalCwd;
    current = parent;
  }
}

/**
 * Validate one built-in read/search path against a canonical repository root.
 * Nonexistent leaves are checked through their nearest existing ancestor.
 */
export async function inspectScoutPath(
  repositoryRoot: string,
  cwd: string,
  requestedPath: unknown,
): Promise<ScoutPathInspection> {
  if (requestedPath !== undefined && typeof requestedPath !== "string") {
    return { allowed: false, reason: "invalid_path", message: blockMessage("invalid_path") };
  }
  const rawPath = requestedPath ?? ".";
  if (rawPath.includes("\0")) {
    return { allowed: false, reason: "invalid_path", message: blockMessage("invalid_path") };
  }
  if (rawPath.split(/[\\/]+/).includes("..")) {
    return { allowed: false, reason: "traversal", message: blockMessage("traversal") };
  }

  const root = resolve(repositoryRoot);
  let canonicalCwd: string;
  try {
    canonicalCwd = await realpath(resolve(cwd));
  } catch {
    return { allowed: false, reason: "unresolvable_path", message: blockMessage("unresolvable_path") };
  }
  let absolutePath = resolve(canonicalCwd, rawPath || ".");
  if (!isWithin(root, absolutePath)) {
    try {
      const canonicalAbsolute = await canonicalizeFromNearestExisting(absolutePath);
      if (!isWithin(root, canonicalAbsolute)) {
        return { allowed: false, reason: "outside_repository", message: blockMessage("outside_repository") };
      }
      absolutePath = canonicalAbsolute;
    } catch {
      return { allowed: false, reason: "outside_repository", message: blockMessage("outside_repository") };
    }
  }
  const lexicalReason = privatePathReason(relativeSegments(root, absolutePath));
  if (lexicalReason) {
    return { allowed: false, reason: lexicalReason, message: blockMessage(lexicalReason) };
  }

  let canonicalPath: string;
  try {
    canonicalPath = await canonicalizeFromNearestExisting(absolutePath);
  } catch {
    return { allowed: false, reason: "unresolvable_path", message: blockMessage("unresolvable_path") };
  }
  if (!isWithin(root, canonicalPath)) {
    return { allowed: false, reason: "symlink_escape", message: blockMessage("symlink_escape") };
  }
  const canonicalReason = privatePathReason(relativeSegments(root, canonicalPath));
  if (canonicalReason) {
    return { allowed: false, reason: canonicalReason, message: blockMessage(canonicalReason) };
  }
  return { allowed: true, absolutePath, canonicalPath };
}

function selectorPartIsProtected(part: string): boolean {
  const normalized = part
    .toLowerCase()
    .replace(/[!?*\[\]{}()]/g, "")
    .trim();
  if (!normalized) return false;
  if (PROTECTED_SEGMENTS.has(normalized) || normalized.startsWith(".env")) return true;
  return PROTECTED_BASENAMES.has(normalized)
    || normalized.endsWith(".pem")
    || normalized.endsWith(".key");
}

/** Check grep globs and find patterns that explicitly select protected files. */
export function scoutSelectorIsProtected(selector: unknown): boolean {
  if (typeof selector !== "string") return false;
  return selector
    .split(/[\\/,]+/)
    .some(selectorPartIsProtected);
}

function secretKeyKind(key: string): "strong" | "generic_token" | undefined {
  const normalized = key.toLowerCase();
  if (/(?:^|[_.-])(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)(?:$|[_.-])/.test(normalized)) {
    return "strong";
  }
  if (/(?:ApiKey|AccessToken|AuthToken|Secret|Password)(?:$|[A-Z0-9_])/.test(key)
    || /^(?:apiKey|accessToken|authToken|secret|password)(?:$|[A-Z0-9_])/.test(key)) {
    return "strong";
  }
  return /(?:^|[_.-])token$/i.test(key) || /Token$/.test(key) ? "generic_token" : undefined;
}

function assignmentValue(value: string): string {
  const quote = value[0] === "\"" || value[0] === "'" ? value[0] : "";
  return quote && value.endsWith(quote) ? value.slice(1, -1).trim() : value.trim();
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (value.length < 4 || value.includes("[REDACTED")) return true;
  if (/^(?:\$|<|process\.env\b|deno\.env\b|import\.meta\.env\b)/i.test(value)) return true;
  return /^(?:true|false|null|undefined|none|empty|string|number|boolean|unknown|any|never|example|sample|test|dummy|placeholder|change-?me|your[_ -].*|x+|\*+|\[?redacted\]?)$/i.test(normalized);
}

function genericTokenLooksSecret(key: string, value: string): boolean {
  if (/^[A-Z][A-Z0-9]*_TOKEN$/u.test(key)) return value.length >= 8;
  return value.length >= 16 && /[^A-Za-z]/u.test(value);
}

/** Redact secrets while leaving ordinary source and tool-result structure intact. */
export function redactScoutText(value: unknown): string {
  const withoutKeys = safeDisplayText(value).replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]");
  const withoutAssignments = withoutKeys.replace(
    ASSIGNMENT,
    (match, prefix: string, _quote: string, key: string, rawValue: string) => {
      const valueText = assignmentValue(rawValue);
      const keyKind = secretKeyKind(key);
      if (!keyKind || isPlaceholderValue(valueText)) return match;
      if (keyKind === "generic_token" && !genericTokenLooksSecret(key, valueText)) return match;
      const quote = rawValue[0] === "\"" || rawValue[0] === "'" ? rawValue[0] : "";
      return `${prefix}${quote}[REDACTED SECRET]${quote}`;
    },
  );
  return withoutAssignments.replace(PROVIDER_TOKEN, "[REDACTED PROVIDER TOKEN]");
}

/** Convert provider/tool failures to a bounded, single-line, terminal-safe message. */
export function sanitizeScoutError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Scout failed.");
  const firstStackLine = raw.split(/\r?\n\s*at\s/u, 1)[0] ?? "";
  const normalized = redactScoutText(firstStackLine).replace(/\s+/gu, " ").trim() || "Scout failed.";
  const characters = Array.from(normalized);
  return characters.length <= MAX_SANITIZED_ERROR_CHARACTERS
    ? normalized
    : `${characters.slice(0, MAX_SANITIZED_ERROR_CHARACTERS - 3).join("")}...`;
}

/** Redact a guarded tool result without replacing its details or usage metadata. */
export function sanitizeScoutToolResult(
  event: ToolResultEvent,
): { content: ToolResultEvent["content"]; isError?: boolean } | undefined {
  let changed = false;
  let blockedImage = false;
  const content = event.content.flatMap((block) => {
    if (block.type === "image") {
      changed = true;
      blockedImage = true;
      return [];
    }
    const text = event.isError ? sanitizeScoutError(block.text) : redactScoutText(block.text);
    if (text !== block.text) changed = true;
    return [{ ...block, text }];
  });

  if (blockedImage) {
    content.push({ type: "text", text: "[Image content blocked for read-only scout safety.]" });
  }
  if (!changed) return undefined;
  return blockedImage ? { content, isError: true } : { content };
}

function selectorFor(toolName: string, input: Record<string, unknown>): unknown {
  if (toolName === "grep") return input.glob;
  if (toolName === "find") return input.pattern;
  return undefined;
}

function resultPathForLine(toolName: string, line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("[") || trimmed === "(empty directory)") return undefined;
  if (trimmed === "No matches found" || trimmed === "No files found matching pattern") return undefined;
  if (toolName === "grep") {
    return /^(.*?)(?::\d+:|-\d+-)/u.exec(line)?.[1]?.trim();
  }
  if (toolName === "find" || toolName === "ls") return trimmed.replace(/[\\/]$/u, "");
  return undefined;
}

/**
 * Remove protected descendants from recursive search/list output before it reaches the child model.
 * Direct paths are rejected before execution; this closes the equivalent broad-directory result path.
 */
export async function protectScoutToolResult(
  repositoryRoot: string,
  cwd: string,
  event: ToolResultEvent,
  inspectResultPath: ScoutPathInspector = inspectScoutPath,
): Promise<{ content: ToolResultEvent["content"]; isError?: boolean } | undefined> {
  if (event.isError || event.toolName === "read") return sanitizeScoutToolResult(event);

  const baseInspection = await inspectScoutPath(repositoryRoot, cwd, event.input.path);
  if (!baseInspection.allowed) {
    return {
      content: [{ type: "text", text: blockMessage(baseInspection.reason) }],
      isError: true,
    };
  }

  let resultBase = baseInspection.absolutePath;
  try {
    if (!(await lstat(resultBase)).isDirectory()) resultBase = dirname(resultBase);
  } catch {
    resultBase = dirname(resultBase);
  }

  const candidates: string[] = [];
  const uniqueCandidates = new Set<string>();
  for (const block of event.content) {
    if (block.type !== "text") continue;
    for (const line of block.text.split("\n")) {
      const candidate = resultPathForLine(event.toolName, line);
      if (!candidate || uniqueCandidates.has(candidate)) continue;
      uniqueCandidates.add(candidate);
      candidates.push(candidate);
    }
  }

  const decisions = new Map<string, boolean>();
  if (candidates.length > 0) {
    const inspections = await runOrderedPool(
      candidates,
      async (candidate) => (await inspectResultPath(repositoryRoot, resultBase, candidate)).allowed,
      { concurrency: Math.min(SUBAGENT_LIMITS.pathCheckConcurrency, candidates.length) },
    );
    inspections.forEach((outcome, index) => {
      decisions.set(
        candidates[index],
        outcome.status === "fulfilled" ? outcome.value : false,
      );
    });
  }

  let removed = false;
  const content = [] as ToolResultEvent["content"];
  for (const block of event.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    const kept: string[] = [];
    for (const line of block.text.split("\n")) {
      const candidate = resultPathForLine(event.toolName, line);
      if (!candidate || decisions.get(candidate) === true) kept.push(line);
      else removed = true;
    }
    content.push({ ...block, text: kept.join("\n") });
  }
  if (removed) {
    const notice = "[Protected paths removed from scout tool output.]";
    const target = content.findLast((block) => block.type === "text");
    if (target?.type === "text") target.text = `${target.text.trimEnd()}\n${notice}`.trimStart();
    else content.push({ type: "text", text: notice });
  }

  const filteredEvent = { ...event, content } as ToolResultEvent;
  const sanitized = sanitizeScoutToolResult(filteredEvent);
  if (sanitized) return sanitized;
  return removed ? { content } : undefined;
}

/** Create a hidden inline extension suitable for DefaultResourceLoader.extensionFactories. */
export function createScoutGuardExtension(options: ScoutGuardOptions): InlineExtension {
  let repositoryRoot: Promise<string> | undefined;
  return {
    name: "pi-config-scout-guard",
    hidden: true,
    factory: async (pi: ExtensionAPI) => {
      const root = await (repositoryRoot ??= options.repositoryRoot
        ? Promise.resolve(options.repositoryRoot)
        : resolveRepositoryRoot(options.cwd));
      let toolCalls = 0;
      pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
        if (!GUARDED_TOOL_NAMES.has(event.toolName)) return undefined;
        toolCalls += 1;
        const budget = toolBudgetForKind(options.kind);
        if (toolCalls > budget) {
          return {
            block: true,
            reason: `Scout tool budget exhausted after ${budget} calls. Synthesize the evidence already collected.`,
          };
        }

        const input = event.input as Record<string, unknown>;
        if (scoutSelectorIsProtected(selectorFor(event.toolName, input))) {
          return { block: true, reason: blockMessage("protected_path") };
        }
        const inspection = await inspectScoutPath(root, options.cwd, input.path);
        return inspection.allowed ? undefined : { block: true, reason: inspection.message };
      });
      pi.on("tool_result", (event) => {
        if (!GUARDED_TOOL_NAMES.has(event.toolName)) return undefined;
        return protectScoutToolResult(root, options.cwd, event);
      });
    },
  };
}
