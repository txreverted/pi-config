import { safeDisplayLine } from "./text-safety.ts";

export const TASK_LIMITS = { tasks: 100, subject: 200, description: 2_000, activeForm: 120, blockers: 20, owner: 128, metadataBytes: 8_192, metadataDepth: 8 } as const;
export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;
export const TASK_CHANGED_EVENT = "task:changed";
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SharedTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: number[];
  metadata?: JsonValue;
  createdAt: number;
  updatedAt: number;
  version: number;
}
export interface TaskSnapshot { tasks: SharedTask[]; nextId: number; }
export type TaskAction = {
  action: "create" | "update" | "list" | "get" | "claim" | "release" | "delete" | "clear";
  id?: number;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  owner?: string;
  blockedBy?: number[];
  metadata?: JsonValue;
};
export interface TaskChange { snapshot: TaskSnapshot; task?: SharedTask; deleted?: SharedTask; cleared?: number; }
export interface TaskCaller { id: string; main: boolean; }

const copy = (task: SharedTask): SharedTask => ({ ...task, blockedBy: [...task.blockedBy], metadata: task.metadata === undefined ? undefined : structuredClone(task.metadata) });
export const copyTaskSnapshot = (snapshot: TaskSnapshot): TaskSnapshot => ({ tasks: snapshot.tasks.map(copy), nextId: snapshot.nextId });
export const emptyTaskSnapshot = (): TaskSnapshot => ({ tasks: [], nextId: 1 });

function text(value: unknown, name: string, maximum: number, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${name} must be a string of at most ${maximum} characters`);
  const clean = safeDisplayLine(value);
  if (required && !clean) throw new Error(`${name} is required`);
  return clean || undefined;
}
function id(value: unknown, name = "id"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive integer`);
  return value as number;
}
function status(value: unknown): TaskStatus {
  if (typeof value !== "string" || !TASK_STATUSES.includes(value as TaskStatus)) throw new Error("Invalid task status");
  return value as TaskStatus;
}
function blockers(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TASK_LIMITS.blockers) throw new Error(`blockedBy must contain at most ${TASK_LIMITS.blockers} ids`);
  const result = value.map((item) => id(item, "blockedBy id"));
  if (new Set(result).size !== result.length) throw new Error("blockedBy ids must be unique");
  return result;
}
function metadata(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error("metadata must be JSON"); }
  if (encoded === undefined || Buffer.byteLength(encoded) > TASK_LIMITS.metadataBytes) throw new Error(`metadata must be JSON of at most ${TASK_LIMITS.metadataBytes} bytes`);
  const decoded = JSON.parse(encoded) as JsonValue;
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("metadata must be a JSON object");
  const visit = (item: JsonValue, depth: number): void => {
    if (depth > TASK_LIMITS.metadataDepth) throw new Error(`metadata must be at most ${TASK_LIMITS.metadataDepth} levels deep`);
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
    else if (item && typeof item === "object") for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(decoded, 1);
  return decoded;
}
function timestamp(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer`);
  return value as number;
}

function validate(tasks: SharedTask[]): void {
  if (tasks.length > TASK_LIMITS.tasks) throw new Error(`Task list may contain at most ${TASK_LIMITS.tasks} tasks`);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Task ids must be unique");
  const activeOwners = new Set<string>();
  for (const task of tasks) {
    if (task.status === "in_progress") {
      if (!task.owner) throw new Error(`Task #${task.id} must have an owner while in_progress`);
      if (activeOwners.has(task.owner)) throw new Error(`Owner ${task.owner} already has an active task`);
      activeOwners.add(task.owner);
    }
    if (task.blockedBy.includes(task.id)) throw new Error(`Task #${task.id} cannot block itself`);
    for (const blocker of task.blockedBy) {
      const dependency = byId.get(blocker);
      if (!dependency) throw new Error(`Task #${task.id} has dangling blocker #${blocker}`);
      if (task.status !== "pending" && dependency.status !== "completed") throw new Error(`Task #${task.id} is blocked by #${blocker}`);
    }
  }
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (taskId: number) => {
    if (visiting.has(taskId)) throw new Error("Task dependencies must not contain a cycle");
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const blocker of byId.get(taskId)!.blockedBy) visit(blocker);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.id);
}

export function validateTaskSnapshot(value: unknown): TaskSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid task snapshot");
  const input = value as { tasks?: unknown; nextId?: unknown };
  if (!Array.isArray(input.tasks)) throw new Error("Invalid task snapshot tasks");
  const tasks = input.tasks.map((item): SharedTask => {
    if (!item || typeof item !== "object") throw new Error("Invalid task");
    const task = item as Record<string, unknown>;
    const createdAt = timestamp(task.createdAt, "createdAt");
    const updatedAt = timestamp(task.updatedAt, "updatedAt");
    if (updatedAt < createdAt) throw new Error("updatedAt must not precede createdAt");
    return {
      id: id(task.id), subject: text(task.subject, "subject", TASK_LIMITS.subject, true)!,
      description: text(task.description, "description", TASK_LIMITS.description),
      activeForm: text(task.activeForm, "activeForm", TASK_LIMITS.activeForm), status: status(task.status),
      owner: text(task.owner, "owner", TASK_LIMITS.owner), blockedBy: blockers(task.blockedBy), metadata: metadata(task.metadata),
      createdAt, updatedAt, version: id(task.version, "version"),
    };
  });
  const nextId = id(input.nextId, "nextId");
  if (tasks.some((task) => task.id >= nextId)) throw new Error("nextId must exceed every task id");
  validate(tasks);
  return copyTaskSnapshot({ tasks, nextId });
}

export function applyTaskAction(current: TaskSnapshot, input: TaskAction, caller: TaskCaller, now = Date.now()): TaskChange {
  const snapshot = validateTaskSnapshot(current);
  const find = (value: unknown) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === id(value));
    if (!task) throw new Error(`Task #${String(value)} not found`);
    return task;
  };
  const mayMutate = (task: SharedTask) => {
    if (!caller.main && task.owner !== caller.id) throw new Error("Agents may mutate only tasks they own");
  };
  const finish = (task: SharedTask): TaskChange => {
    validate(snapshot.tasks);
    return { snapshot: copyTaskSnapshot(snapshot), task: copy(task) };
  };

  if (input.action === "list") return { snapshot };
  if (input.action === "get") return { snapshot, task: copy(find(input.id)) };
  if (input.action === "create") {
    if (snapshot.tasks.length >= TASK_LIMITS.tasks || snapshot.nextId >= Number.MAX_SAFE_INTEGER) throw new Error("Task list capacity is exhausted");
    const task: SharedTask = {
      id: snapshot.nextId++, subject: text(input.subject, "subject", TASK_LIMITS.subject, true)!,
      description: text(input.description, "description", TASK_LIMITS.description), activeForm: text(input.activeForm, "activeForm", TASK_LIMITS.activeForm),
      status: input.status === undefined ? "pending" : status(input.status),
      owner: caller.main ? text(input.owner, "owner", TASK_LIMITS.owner) : caller.id,
      blockedBy: blockers(input.blockedBy), metadata: metadata(input.metadata), createdAt: now, updatedAt: now, version: 1,
    };
    snapshot.tasks.push(task);
    return finish(task);
  }
  if (input.action === "claim") {
    if (snapshot.tasks.some((task) => task.status === "in_progress" && task.owner === caller.id)) throw new Error("Caller already has an active task");
    const task = input.id === undefined
      ? snapshot.tasks.find((candidate) =>
          candidate.status === "pending" &&
          (caller.main || !candidate.owner || candidate.owner === caller.id) &&
          candidate.blockedBy.every((blocker) => snapshot.tasks.find((item) => item.id === blocker)?.status === "completed"),
        )
      : find(input.id);
    if (!task) throw new Error("No unblocked pending task is available");
    if (task.status !== "pending" || task.blockedBy.some((blocker) => snapshot.tasks.find((item) => item.id === blocker)?.status !== "completed")) throw new Error(`Task #${task.id} is not an unblocked pending task`);
    if (task.owner && task.owner !== caller.id && !caller.main) throw new Error(`Task #${task.id} is owned by another caller`);
    task.owner = caller.id; task.status = "in_progress"; task.updatedAt = now; task.version++;
    return finish(task);
  }
  if (input.action === "clear") {
    if (!caller.main) throw new Error("Only main may clear shared tasks");
    return { snapshot: emptyTaskSnapshot(), cleared: snapshot.tasks.length };
  }
  const task = find(input.id);
  mayMutate(task);
  if (input.action === "release") {
    if (task.status !== "in_progress") throw new Error("Only an in_progress task may be released");
    task.status = "pending"; task.owner = undefined; task.updatedAt = now; task.version++;
    return finish(task);
  }
  if (input.action === "delete") {
    snapshot.tasks.splice(snapshot.tasks.indexOf(task), 1);
    validate(snapshot.tasks);
    return { snapshot: copyTaskSnapshot(snapshot), deleted: copy(task) };
  }
  if (input.action === "update") {
    if (input.subject !== undefined) task.subject = text(input.subject, "subject", TASK_LIMITS.subject, true)!;
    if (input.description !== undefined) task.description = text(input.description, "description", TASK_LIMITS.description);
    if (input.activeForm !== undefined) task.activeForm = text(input.activeForm, "activeForm", TASK_LIMITS.activeForm);
    if (input.status !== undefined) task.status = status(input.status);
    if (input.owner !== undefined) {
      if (!caller.main) throw new Error("Only main may assign task owners");
      task.owner = text(input.owner, "owner", TASK_LIMITS.owner);
    }
    if (input.blockedBy !== undefined) task.blockedBy = blockers(input.blockedBy);
    if (input.metadata !== undefined) task.metadata = metadata(input.metadata);
    task.updatedAt = now; task.version++;
    return finish(task);
  }
  throw new Error("Invalid task action");
}
