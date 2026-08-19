import type { Usage } from "@earendil-works/pi-ai";
import { relative, resolve, sep } from "node:path";
import { safeDisplayLine, safeDisplayText } from "../text-safety.ts";
import type { TodoSnapshot, TodoTask } from "../todo-core.ts";
import { AGENT_ROLES, ROLE_DEFINITIONS, type AgentRole, type ThinkingLevel } from "./roles.ts";

export const SUBAGENT_LIMITS = {
  tasks: 6,
  concurrency: 3,
  taskChars: 8_000,
  contextChars: 4_000,
  contextFiles: 20,
  criteria: 10,
  criterionChars: 500,
  scopes: 20,
  resultBytes: 12_000,
  contextPacketBytes: 16_000,
  stderrBytes: 16_000,
  processOutputBytes: 10 * 1024 * 1024,
  startupMs: 20_000,
} as const;

export const AGENT_STATUSES = ["queued", "starting", "running", "succeeded", "failed", "blocked", "cancelled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentTaskInput {
  id: string;
  role: AgentRole;
  title: string;
  objective: string;
  todoId?: number;
  context?: string;
  contextFiles?: string[];
  acceptanceCriteria: string[];
  writeScope?: string[];
  model?: string;
  thinking?: ThinkingLevel | "inherit";
}

export interface AgentTask extends AgentTaskInput {
  contextFiles: string[];
  writeScope: string[];
  context?: string;
  model?: string;
  thinking?: ThinkingLevel | "inherit";
}

export interface AgentWaveInput {
  title: string;
  tasks: AgentTaskInput[];
  maxConcurrency?: number;
}

export interface AgentResultPayload {
  status: "succeeded" | "blocked";
  summary: string;
  evidence: string[];
  question?: string;
}

export const AGENT_RESULT_LIMITS = {
  summaryChars: 8_000,
  evidenceItems: 20,
  evidenceChars: 1_000,
  questionChars: 1_000,
} as const;

export interface UsageSummary extends Usage {}

export interface AgentProgress {
  id: string;
  role: AgentRole;
  title: string;
  todoId?: number;
  status: AgentStatus;
  activity?: string;
  currentTool?: string;
  toolCalls: number;
  turns: number;
  startedAt?: number;
  endedAt?: number;
  usage: UsageSummary;
  model?: string;
  thinking: ThinkingLevel;
}

export interface AgentRunResult extends AgentProgress {
  objective: string;
  result?: AgentResultPayload;
  error?: string;
  stderr?: string;
  changedFiles: string[];
  patchState?: "ready" | "none" | "scope_violation";
  patchHash?: string;
  patchBytes?: number;
}

export interface ParallelAgentsDetails {
  runId: string;
  title: string;
  progress: AgentProgress[];
  results: AgentRunResult[];
  usage: UsageSummary;
  todoSnapshot: TodoSnapshot;
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

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeUsage(value: unknown): UsageSummary {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cost = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, unknown> : {};
  return {
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: number(usage.cacheWrite1h) } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: number(usage.reasoning) } : {}),
    totalTokens: number(usage.totalTokens),
    cost: {
      input: number(cost.input),
      output: number(cost.output),
      cacheRead: number(cost.cacheRead),
      cacheWrite: number(cost.cacheWrite),
      total: number(cost.total),
    },
  };
}

export function validateAgentResultPayload(value: unknown): AgentResultPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agentResult must be an object");
  const input = value as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => !["status", "summary", "evidence", "question"].includes(key));
  if (unexpected.length) throw new Error(`agentResult contains unexpected fields: ${unexpected.join(", ")}`);
  if (input.status !== "succeeded" && input.status !== "blocked") throw new Error("agentResult status is invalid");
  if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > AGENT_RESULT_LIMITS.summaryChars) {
    throw new Error(`agentResult summary must contain 1-${AGENT_RESULT_LIMITS.summaryChars} characters`);
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > AGENT_RESULT_LIMITS.evidenceItems) {
    throw new Error(`agentResult evidence must contain at most ${AGENT_RESULT_LIMITS.evidenceItems} items`);
  }
  const evidence = input.evidence.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > AGENT_RESULT_LIMITS.evidenceChars) {
      throw new Error(`agentResult evidence items must contain 1-${AGENT_RESULT_LIMITS.evidenceChars} characters`);
    }
    return safeDisplayText(item).trim();
  });
  const question = input.question;
  if (question !== undefined && (typeof question !== "string" || !question.trim() || question.length > AGENT_RESULT_LIMITS.questionChars)) {
    throw new Error(`agentResult question must contain 1-${AGENT_RESULT_LIMITS.questionChars} characters`);
  }
  const result: AgentResultPayload = {
    status: input.status,
    summary: safeDisplayText(input.summary).trim(),
    evidence,
    ...(typeof question === "string" ? { question: safeDisplayText(question).trim() } : {}),
  };
  if (!result.summary || evidence.some((item) => !item) || (question !== undefined && !result.question)) {
    throw new Error("agentResult text is empty after display-safety normalization");
  }
  if (result.status === "blocked" && !result.question) throw new Error("Blocked agent results require a question");
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > SUBAGENT_LIMITS.resultBytes) {
    throw new Error(`agentResult must be at most ${SUBAGENT_LIMITS.resultBytes} bytes`);
  }
  return result;
}

export function addUsage(left: UsageSummary, right: UsageSummary): UsageSummary {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    ...(left.cacheWrite1h !== undefined || right.cacheWrite1h !== undefined ? { cacheWrite1h: (left.cacheWrite1h ?? 0) + (right.cacheWrite1h ?? 0) } : {}),
    ...(left.reasoning !== undefined || right.reasoning !== undefined ? { reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0) } : {}),
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

export function aggregateUsage(values: Iterable<UsageSummary>): UsageSummary {
  let result = emptyUsage();
  for (const value of values) result = addUsage(result, value);
  return result;
}

function cleanText(value: unknown, name: string, maximum: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > maximum) throw new Error(`${name} must be at most ${maximum} characters`);
  const text = safeDisplayText(value).trim();
  if (required && !text) throw new Error(`${name} is required`);
  return text || undefined;
}

function cleanId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) {
    throw new Error("Agent task ids may contain only letters, digits, dots, underscores, and hyphens");
  }
  return value;
}

function cleanRelativePath(value: unknown, name: string): string {
  const text = cleanText(value, name, 4_096)!;
  if (text.includes("\0") || resolve("/workspace", text).split(sep).includes("..")) throw new Error(`${name} is invalid`);
  const normalized = text.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${name} must be relative to the workspace`);
  }
  return normalized;
}

function staticScopePrefix(scope: string): string {
  const index = scope.search(/[*?[{]/);
  return (index < 0 ? scope : scope.slice(0, index)).replace(/\/+$/, "");
}

function scopesOverlap(left: string, right: string): boolean {
  const a = staticScopePrefix(left);
  const b = staticScopePrefix(right);
  return !a || !b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function normalizeAgentWave(input: AgentWaveInput, todos: TodoSnapshot): { title: string; tasks: AgentTask[]; maxConcurrency: number } {
  const title = safeDisplayLine(cleanText(input.title, "title", 120)!, 120);
  if (!Array.isArray(input.tasks) || input.tasks.length < 2 || input.tasks.length > SUBAGENT_LIMITS.tasks) {
    throw new Error(`parallel_agents requires 2-${SUBAGENT_LIMITS.tasks} tasks`);
  }
  const ids = new Set<string>();
  const todoIds = new Set<number>();
  const byTodo = new Map(todos.tasks.map((task) => [task.id, task]));
  const completed = new Set(todos.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const tasks = input.tasks.map((task, index): AgentTask => {
    const id = cleanId(task.id);
    if (ids.has(id)) throw new Error(`Duplicate agent task id '${id}'`);
    ids.add(id);
    if (!AGENT_ROLES.includes(task.role)) throw new Error(`Invalid role for task '${id}'`);
    const role = ROLE_DEFINITIONS[task.role];
    const todo = task.todoId === undefined ? undefined : byTodo.get(task.todoId);
    if (task.todoId !== undefined) {
      if (!Number.isSafeInteger(task.todoId) || task.todoId < 1 || !todo) throw new Error(`Task '${id}' references an unknown todo`);
      if (todoIds.has(task.todoId)) throw new Error(`Todo #${task.todoId} is claimed by more than one agent task`);
      if (todo.status !== "pending" || todo.delegation) throw new Error(`Todo #${task.todoId} is not ready for delegation`);
      if (!todo.blockedBy.every((blocker) => completed.has(blocker))) throw new Error(`Todo #${task.todoId} is blocked`);
      todoIds.add(task.todoId);
    }
    const contextFiles = (task.contextFiles ?? []).map((path) => cleanRelativePath(path, `tasks[${index}].contextFiles`));
    if (contextFiles.length > SUBAGENT_LIMITS.contextFiles) throw new Error(`Task '${id}' has too many context files`);
    const criteria = task.acceptanceCriteria;
    if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > SUBAGENT_LIMITS.criteria) {
      throw new Error(`Task '${id}' requires 1-${SUBAGENT_LIMITS.criteria} acceptance criteria`);
    }
    const acceptanceCriteria = criteria.map((criterion) => cleanText(criterion, `Task '${id}' criterion`, SUBAGENT_LIMITS.criterionChars)!);
    const writeScope = (task.writeScope ?? []).map((scope) => cleanRelativePath(scope, `Task '${id}' write scope`));
    if (writeScope.length > SUBAGENT_LIMITS.scopes) throw new Error(`Task '${id}' has too many write scopes`);
    if (role.mutatesWorkspace && writeScope.length === 0) throw new Error(`Worker '${id}' requires writeScope`);
    if (!role.mutatesWorkspace && writeScope.length > 0) throw new Error(`${task.role} '${id}' may not declare writeScope`);
    if (task.thinking !== undefined && task.thinking !== "inherit" && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(task.thinking)) {
      throw new Error(`Task '${id}' has an invalid thinking level`);
    }
    return {
      id,
      role: task.role,
      title: safeDisplayLine(cleanText(task.title, `Task '${id}' title`, 80)!, 80),
      objective: cleanText(task.objective, `Task '${id}' objective`, SUBAGENT_LIMITS.taskChars)!,
      ...(task.todoId === undefined ? {} : { todoId: task.todoId }),
      ...(task.context === undefined ? {} : { context: cleanText(task.context, `Task '${id}' context`, SUBAGENT_LIMITS.contextChars, false) }),
      contextFiles,
      acceptanceCriteria,
      writeScope,
      ...(task.model === undefined ? {} : { model: safeDisplayLine(cleanText(task.model, `Task '${id}' model`, 200)!, 200) }),
      ...(task.thinking === undefined ? {} : { thinking: task.thinking }),
    };
  });

  for (let left = 0; left < tasks.length; left++) {
    for (let right = left + 1; right < tasks.length; right++) {
      const a = tasks[left];
      const b = tasks[right];
      if (a.todoId !== undefined && b.todoId !== undefined) {
        const aTodo = byTodo.get(a.todoId)!;
        const bTodo = byTodo.get(b.todoId)!;
        if (aTodo.blockedBy.includes(bTodo.id) || bTodo.blockedBy.includes(aTodo.id)) throw new Error("Dependent todos cannot run in the same agent wave");
      }
      if (a.role === "worker" && b.role === "worker" && a.writeScope.some((x) => b.writeScope.some((y) => scopesOverlap(x, y)))) {
        throw new Error(`Worker write scopes overlap: '${a.id}' and '${b.id}'`);
      }
    }
  }

  const maxConcurrency = input.maxConcurrency ?? SUBAGENT_LIMITS.concurrency;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > SUBAGENT_LIMITS.concurrency) {
    throw new Error(`maxConcurrency must be 1-${SUBAGENT_LIMITS.concurrency}`);
  }
  return { title, tasks, maxConcurrency };
}

function utf8Prefix(value: string, maximum: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximum) return value;
  const notice = Buffer.from("\n[Context truncated]", "utf8");
  let end = Math.max(0, maximum - notice.length);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return `${bytes.subarray(0, end).toString("utf8").trimEnd()}${notice.toString("utf8")}`;
}

export function buildContextPacket(input: {
  overallGoal: string;
  task: AgentTask;
  todo?: TodoTask;
}): string {
  const { task, todo } = input;
  const sections = [
    "OVERALL GOAL\n" + safeDisplayText(input.overallGoal),
    "ASSIGNED TASK\n" + task.objective,
    todo ? `TODO\n#${todo.id} ${todo.subject}${todo.description ? `\n${todo.description}` : ""}` : "",
    task.context ? "KNOWN CONTEXT\n" + task.context : "",
    task.contextFiles.length ? "STARTING FILES\n" + task.contextFiles.map((path) => `- ${path}`).join("\n") : "",
    task.writeScope.length ? "WRITE SCOPE\n" + task.writeScope.map((scope) => `- ${scope}`).join("\n") : "",
    "ACCEPTANCE CRITERIA\n" + task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n"),
    "RETURN CONTRACT\nCall agent_result alone when done. Report blocked only when parent input is required.",
  ].filter(Boolean);
  return utf8Prefix(sections.join("\n\n"), SUBAGENT_LIMITS.contextPacketBytes);
}

export function resolveInside(root: string, requested: string): string {
  const target = resolve(root, requested);
  const fromRoot = relative(resolve(root), target);
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`))) return target;
  throw new Error("Path must remain inside the agent workspace");
}

export async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, run: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await run(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
