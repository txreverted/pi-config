import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { CONTINUITY_TYPES, type CheckCategory, type ContinuityCheck, type ContinuityCheckpoint, type ContinuityFile, type IndexedEntry, type TaskStatus } from "./continuity-types.ts";

const PATH_KEYS = new Set(["path", "file", "filePath", "file_path", "target"]);
const DONE_TEXT = /\b(?:all requested (?:work|changes)|task|implementation|fix|refactor)\b.{0,100}\b(?:complete|completed|done|finished|implemented|fixed)\b/i;
const OPEN_TEXT = /\b(?:still need|need to|next step|remaining|blocked|waiting|not done|incomplete|failed)\b/i;
const SECRET_PATTERNS = [
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,
];

function hash(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function redactContinuityText(value: string): string {
  let text = value.replace(/\u0000/g, "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  return text;
}

export function normalizeContinuityText(value: string, max = 4_000): string {
  const text = redactContinuityText(value).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (text.length <= max) return text;
  const head = Math.ceil((max - 25) * 0.6);
  const tail = max - 25 - head;
  return `${text.slice(0, head)}\n...[truncated]...\n${text.slice(-tail)}`;
}

export function messageText(message: AgentMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  }
  if (message.role === "assistant") {
    return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  }
  if (message.role === "toolResult") {
    return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  }
  if (message.role === "custom") {
    if (typeof message.content === "string") return message.content;
    return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  }
  if (message.role === "bashExecution") return `${message.command}\n${message.output}`;
  if (message.role === "branchSummary") return message.summary;
  if (message.role === "compactionSummary") return message.summary;
  return "";
}

function strings(values: unknown, max = 50): string[] {
  if (!Array.isArray(values)) return [];
  return unique(values.filter((value): value is string => typeof value === "string").map((value) => normalizeContinuityText(value, 1_000)), max);
}

function explicitNextActions(text: string): string[] {
  const lines = text.split("\n");
  const actions: string[] = [];
  let inNextSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const inline = trimmed.match(/^(?:[-*]\s*)?(?:next(?: steps?)?|todo)\s*[:=-]\s*(.+)$/i);
    if (inline?.[1]) {
      actions.push(normalizeContinuityText(inline[1], 1_000));
      inNextSection = false;
      continue;
    }
    if (/^#{0,3}\s*next(?: steps?)?\s*:?$/i.test(trimmed)) {
      inNextSection = true;
      continue;
    }
    if (inNextSection) {
      const item = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
      if (item?.[1]) actions.push(normalizeContinuityText(item[1], 1_000));
      else if (trimmed && !/^#{1,6}\s/.test(trimmed)) inNextSection = false;
    }
  }
  return unique(actions, 20);
}

function unique(values: string[], max = 100): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function emptyCheckpoint(goal?: string, sourceId?: string): ContinuityCheckpoint {
  const normalizedGoal = goal ? normalizeContinuityText(goal, 1_200) : undefined;
  const taskId = hash(`${sourceId ?? "session"}\n${normalizedGoal ?? "unknown"}`);
  return {
    schema: 1,
    id: hash(`${taskId}\ninitial`),
    taskId,
    revision: "",
    status: normalizedGoal ? "working" : "unknown",
    goal: normalizedGoal,
    nextActions: [],
    doneWhen: [],
    blockers: [],
    constraints: [],
    decisions: [],
    rejectedApproaches: [],
    completed: [],
    files: [],
    checks: [],
    preferences: [],
    environment: [],
    sourceEntryIds: sourceId ? [sourceId] : [],
    createdAt: new Date().toISOString(),
    origin: "automatic",
  };
}

export function checkpointData(value: unknown): ContinuityCheckpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ContinuityCheckpoint>;
  if (candidate.schema !== 1 || typeof candidate.taskId !== "string" || typeof candidate.revision !== "string") return undefined;
  if (!candidate.status || !["unknown", "working", "blocked", "waiting", "done"].includes(candidate.status)) return undefined;
  return candidate as ContinuityCheckpoint;
}

function cloneCheckpoint(value: ContinuityCheckpoint): ContinuityCheckpoint {
  return structuredClone(value);
}

function toolCalls(message: AgentMessage): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  if (message.role !== "assistant") return [];
  return message.content.flatMap((part) => part.type === "toolCall"
    ? [{ id: part.id, name: part.name, arguments: part.arguments }]
    : []);
}

function pathValues(value: unknown, key?: string): string[] {
  if (typeof value === "string") return key && PATH_KEYS.has(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => pathValues(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => pathValues(child, childKey));
}

function actionForTool(name: string): ContinuityFile["action"] | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "read" || normalized.includes("fetch") || normalized.includes("search")) return "read";
  if (normalized === "write") return "created";
  if (normalized === "edit" || normalized.includes("patch")) return "modified";
  return undefined;
}

function commandFromCall(call: { name: string; arguments: Record<string, unknown> }): string | undefined {
  if (!/^(?:bash|powershell|shell|exec)$/i.test(call.name)) return undefined;
  const command = call.arguments.command ?? call.arguments.cmd ?? call.arguments.script;
  return typeof command === "string" ? normalizeContinuityText(command, 2_000) : undefined;
}

export function checkCategory(command: string): CheckCategory {
  const lower = command.toLowerCase();
  if (/\b(?:typecheck|tsc\b|type-check)/.test(lower)) return "typecheck";
  if (/\b(?:lint|eslint|biome check|ruff check)/.test(lower)) return "lint";
  if (/\b(?:test|pytest|vitest|jest|cargo test|go test)/.test(lower)) return "test";
  if (/\b(?:build|compile|cargo check)/.test(lower)) return "build";
  return "other";
}

function mergeFile(files: ContinuityFile[], next: ContinuityFile): void {
  const key = process.platform === "win32" ? next.path.toLowerCase() : next.path;
  const existing = files.find((file) => (process.platform === "win32" ? file.path.toLowerCase() : file.path) === key);
  if (!existing) files.push(next);
  else {
    existing.action = next.action;
    existing.sourceEntryIds = unique([...existing.sourceEntryIds, ...next.sourceEntryIds]);
  }
}

function mergeCheck(checks: ContinuityCheck[], next: ContinuityCheck): void {
  const existing = checks.find((check) => check.command === next.command);
  if (!existing) checks.push(next);
  else {
    existing.status = next.status;
    existing.category = next.category;
    existing.sourceEntryIds = unique([...existing.sourceEntryIds, ...next.sourceEntryIds]);
  }
}

function finalize(checkpoint: ContinuityCheckpoint, origin: ContinuityCheckpoint["origin"]): ContinuityCheckpoint {
  checkpoint.nextActions = unique(checkpoint.nextActions, 30);
  checkpoint.doneWhen = unique(checkpoint.doneWhen, 30);
  checkpoint.blockers = unique(checkpoint.blockers, 20);
  checkpoint.constraints = unique(checkpoint.constraints, 50);
  checkpoint.decisions = unique(checkpoint.decisions, 50);
  checkpoint.rejectedApproaches = unique(checkpoint.rejectedApproaches, 30);
  checkpoint.completed = unique(checkpoint.completed, 50);
  checkpoint.preferences = unique(checkpoint.preferences, 30);
  checkpoint.environment = unique(checkpoint.environment, 30);
  checkpoint.sourceEntryIds = unique(checkpoint.sourceEntryIds, 200);
  if (checkpoint.blockers.length > 0 && checkpoint.status === "working") checkpoint.status = "blocked";
  if (checkpoint.status === "done" && (
    checkpoint.nextActions.length > 0 ||
    checkpoint.blockers.length > 0 ||
    checkpoint.checks.some((check) => check.status === "failed" || check.status === "unknown")
  )) checkpoint.status = checkpoint.blockers.length > 0 ? "blocked" : "working";
  const revisionSource = JSON.stringify({
    taskId: checkpoint.taskId,
    status: checkpoint.status,
    goal: checkpoint.goal,
    currentAction: checkpoint.currentAction,
    nextActions: checkpoint.nextActions,
    doneWhen: checkpoint.doneWhen,
    blockers: checkpoint.blockers,
    constraints: checkpoint.constraints,
    decisions: checkpoint.decisions,
    rejectedApproaches: checkpoint.rejectedApproaches,
    completed: checkpoint.completed,
    files: checkpoint.files.map(({ path, action }) => ({ path, action })),
    checks: checkpoint.checks.map(({ command, category, status }) => ({ command, category, status })),
  });
  checkpoint.revision = hash(revisionSource, 24);
  checkpoint.id = hash(`${checkpoint.taskId}\n${checkpoint.revision}`, 24);
  checkpoint.createdAt = new Date().toISOString();
  checkpoint.origin = origin;
  return checkpoint;
}

export interface AgentCheckpointInput {
  taskMode?: "continue" | "replace" | "add";
  status?: TaskStatus;
  goal?: string;
  currentAction?: string;
  nextActions?: string[];
  doneWhen?: string[];
  blockers?: string[];
  constraints?: string[];
  decisions?: string[];
  rejectedApproaches?: string[];
  completed?: string[];
  preferences?: string[];
  environment?: string[];
}

export function applyAgentCheckpoint(
  current: ContinuityCheckpoint,
  input: AgentCheckpointInput,
  sourceEntryId: string,
): ContinuityCheckpoint {
  const replace = input.taskMode === "replace";
  const checkpoint = replace
    ? emptyCheckpoint(input.goal, sourceEntryId)
    : cloneCheckpoint(current);
  if (input.taskMode === "add" && input.goal) checkpoint.nextActions.push(normalizeContinuityText(input.goal, 1_000));
  else if (input.goal) checkpoint.goal = normalizeContinuityText(input.goal, 1_200);
  if (input.status) checkpoint.status = input.status;
  if (input.currentAction) checkpoint.currentAction = normalizeContinuityText(input.currentAction, 1_000);
  if (input.nextActions) checkpoint.nextActions = strings(input.nextActions);
  if (input.doneWhen) checkpoint.doneWhen = strings(input.doneWhen);
  if (input.blockers) checkpoint.blockers = strings(input.blockers);
  if (input.constraints) checkpoint.constraints = unique([...checkpoint.constraints, ...strings(input.constraints)]);
  if (input.decisions) checkpoint.decisions = unique([...checkpoint.decisions, ...strings(input.decisions)]);
  if (input.rejectedApproaches) checkpoint.rejectedApproaches = unique([
    ...checkpoint.rejectedApproaches,
    ...strings(input.rejectedApproaches),
  ]);
  if (input.completed) checkpoint.completed = unique([...checkpoint.completed, ...strings(input.completed)]);
  if (input.preferences) checkpoint.preferences = unique([...checkpoint.preferences, ...strings(input.preferences)]);
  if (input.environment) checkpoint.environment = unique([...checkpoint.environment, ...strings(input.environment)]);
  checkpoint.sourceEntryIds.push(sourceEntryId);
  return finalize(checkpoint, "agent");
}

export function latestPersistedCheckpointRevision(entries: readonly SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type === "custom" && entry.customType === CONTINUITY_TYPES.checkpoint) {
      const checkpoint = checkpointData(entry.data);
      if (checkpoint) return checkpoint.revision;
    }
    if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "continuity_checkpoint") {
      const details = entry.message.details as { checkpoint?: unknown } | undefined;
      const checkpoint = checkpointData(details?.checkpoint);
      if (checkpoint) return checkpoint.revision;
    }
  }
  return undefined;
}

export function checkpointFromBranch(entries: readonly SessionEntry[]): ContinuityCheckpoint {
  let checkpoint: ContinuityCheckpoint | undefined;
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type === "custom" && entry.customType === CONTINUITY_TYPES.checkpoint) {
      checkpoint = checkpointData(entry.data);
    } else if (
      entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "continuity_checkpoint"
    ) {
      const details = entry.message.details as { checkpoint?: unknown } | undefined;
      checkpoint = checkpointData(details?.checkpoint);
    }
    if (checkpoint) {
      checkpoint = cloneCheckpoint(checkpoint);
      start = index + 1;
      break;
    }
  }

  const calls = new Map<string, { name: string; arguments: Record<string, unknown>; entryId: string }>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    for (const call of toolCalls(entry.message)) calls.set(call.id, { ...call, entryId: entry.id });
  }

  for (let index = start; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user") {
      const text = normalizeContinuityText(messageText(message), 1_200);
      if (!text) continue;
      if (!checkpoint || checkpoint.status === "done" || /^(?:new task|separate task|instead[, :]?|now[, :]?)/i.test(text)) {
        const durable = checkpoint ? { preferences: checkpoint.preferences, environment: checkpoint.environment } : undefined;
        checkpoint = emptyCheckpoint(text, entry.id);
        if (durable) {
          checkpoint.preferences = durable.preferences;
          checkpoint.environment = durable.environment;
        }
      } else if (text !== checkpoint.goal) {
        checkpoint.constraints.push(text);
        checkpoint.status = "working";
      }
      checkpoint.sourceEntryIds.push(entry.id);
      continue;
    }
    if (!checkpoint) continue;

    if (message.role === "assistant") {
      for (const call of toolCalls(message)) {
        const action = actionForTool(call.name);
        if (action) {
          for (const path of pathValues(call.arguments)) {
            mergeFile(checkpoint.files, { path: normalizeContinuityText(path, 1_000), action, sourceEntryIds: [entry.id] });
          }
        }
        const command = commandFromCall(call);
        if (command) checkpoint.currentAction = command;
      }
      const text = normalizeContinuityText(messageText(message), 2_400);
      const nextActions = explicitNextActions(text);
      if (nextActions.length > 0) {
        checkpoint.nextActions = nextActions;
        checkpoint.currentAction = nextActions[0];
        checkpoint.status = "working";
      }
      if (text && DONE_TEXT.test(text) && !OPEN_TEXT.test(text) && checkpoint.blockers.length === 0 && checkpoint.checks.every((check) => check.status === "passed")) {
        checkpoint.status = "done";
        checkpoint.currentAction = "task complete";
        checkpoint.nextActions = [];
      }
      checkpoint.sourceEntryIds.push(entry.id);
      continue;
    }

    if (message.role === "toolResult") {
      const call = calls.get(message.toolCallId);
      const text = normalizeContinuityText(messageText(message), 2_000);
      if (call) {
        const command = commandFromCall(call);
        if (command) {
          mergeCheck(checkpoint.checks, {
            command,
            category: checkCategory(command),
            status: message.isError ? "failed" : "passed",
            sourceEntryIds: [call.entryId, entry.id],
          });
          if (!message.isError) {
            checkpoint.completed.push(command);
            if (checkpoint.checks.every((check) => check.status !== "failed")) {
              checkpoint.blockers = [];
              if (checkpoint.status === "blocked") checkpoint.status = "working";
            }
          }
        }
        const action = actionForTool(call.name);
        if (action && !message.isError) {
          for (const path of pathValues(call.arguments)) {
            mergeFile(checkpoint.files, { path: normalizeContinuityText(path, 1_000), action, sourceEntryIds: [call.entryId, entry.id] });
          }
        }
      }
      if (message.isError) {
        checkpoint.blockers.push(text || `${message.toolName} failed`);
        checkpoint.status = "blocked";
      } else if (checkpoint.status === "blocked" && checkpoint.blockers.length === 0) checkpoint.status = "working";
      checkpoint.sourceEntryIds.push(entry.id);
    }
  }
  return finalize(checkpoint ?? emptyCheckpoint(), "automatic");
}

export function checkpointChanged(previous: ContinuityCheckpoint | undefined, next: ContinuityCheckpoint): boolean {
  return Boolean(next.goal) && previous?.revision !== next.revision;
}

export function renderContinuitySnapshot(checkpoint: ContinuityCheckpoint, maxChars: number): string {
  const lines = [
    "[continuity state; current user instructions win]",
    `goal=${checkpoint.goal ?? "unknown"}`,
    `status=${checkpoint.status}`,
    `now=${checkpoint.currentAction ?? "unknown"}`,
    `next=${checkpoint.nextActions.join("; ") || "none"}`,
    `done_when=${checkpoint.doneWhen.join("; ") || "unspecified"}`,
    `blockers=${checkpoint.blockers.join("; ") || "none"}`,
    `checks=${checkpoint.checks.slice(-8).map((check) => `${check.status}:${check.command}`).join("; ") || "none"}`,
    `files=${checkpoint.files.slice(-12).map((file) => `${file.action}:${file.path}`).join("; ") || "none"}`,
    `decisions=${checkpoint.decisions.slice(-8).join("; ") || "none"}`,
    `avoid=${checkpoint.rejectedApproaches.slice(-6).join("; ") || "none"}`,
    `sources=${checkpoint.sourceEntryIds.slice(-20).join(",") || "none"}`,
    "resume_rule=continue exact next action; do not redo completed work; ask only for required user choice",
  ];
  const required = lines.slice(0, 7).join("\n");
  if (lines.join("\n").length <= maxChars) return lines.join("\n");
  const optional = lines.slice(7).join("\n");
  return normalizeContinuityText(`${required}\n${optional}`, maxChars);
}

export function renderCompactionSummary(checkpoint: ContinuityCheckpoint, reflection: string | undefined, maxChars: number): string {
  const snapshot = renderContinuitySnapshot(checkpoint, Math.min(maxChars, 8_000));
  const details = [
    checkpoint.constraints.length ? `constraints=${checkpoint.constraints.join("; ")}` : "",
    checkpoint.completed.length ? `completed=${checkpoint.completed.join("; ")}` : "",
    checkpoint.preferences.length ? `preferences=${checkpoint.preferences.join("; ")}` : "",
    checkpoint.environment.length ? `environment=${checkpoint.environment.join("; ")}` : "",
    reflection ? `reflection=${normalizeContinuityText(reflection, 3_000)}` : "",
  ].filter(Boolean).join("\n");
  return normalizeContinuityText(`${snapshot}\n${details}`, maxChars);
}

export function entryToIndexed(sessionId: string, entry: SessionEntry, ordinal: number): IndexedEntry | undefined {
  let role: string = entry.type;
  let text = "";
  let toolName: string | undefined;
  let isError = false;
  if (entry.type === "message") {
    role = entry.message.role;
    text = messageText(entry.message);
    if (entry.message.role === "toolResult") {
      toolName = entry.message.toolName;
      isError = entry.message.isError;
    }
  } else if (entry.type === "compaction" || entry.type === "branch_summary") text = entry.summary;
  else if (entry.type === "custom_message") text = typeof entry.content === "string"
    ? entry.content
    : entry.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  else if (entry.type === "custom") text = JSON.stringify(entry.data ?? {});
  text = normalizeContinuityText(text, 50_000);
  if (!text) return undefined;
  return {
    sessionId,
    entryId: entry.id,
    parentId: entry.parentId,
    ordinal,
    timestamp: entry.timestamp,
    role,
    toolName,
    isError,
    text,
    filePaths: unique(pathValues(entry), 100),
  };
}

export function latestUserEntryId(entries: readonly SessionEntry[]): string | undefined {
  return entries.findLast((entry) => entry.type === "message" && entry.message.role === "user")?.id;
}

export function latestAssistantStopReason(entries: readonly SessionEntry[]): string | undefined {
  const entry = entries.findLast((candidate) => candidate.type === "message" && candidate.message.role === "assistant");
  return entry?.type === "message" && entry.message.role === "assistant" ? entry.message.stopReason : undefined;
}

export function continuationAllowed(checkpoint: ContinuityCheckpoint): boolean {
  return checkpoint.status === "working" && checkpoint.nextActions.length > 0 && checkpoint.blockers.length === 0;
}
