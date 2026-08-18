import { safeDisplayLine } from "./text-safety.ts";

export const TODO_LIMITS = {
  tasks: 25,
  subject: 200,
  description: 2000,
  activeForm: 120,
  blockers: 10,
} as const;

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_DELEGATION_PHASES = ["queued", "running", "awaiting_integration", "awaiting_verification"] as const;
export type TodoDelegationPhase = (typeof TODO_DELEGATION_PHASES)[number];
export type TodoDelegationRole = "explorer" | "worker" | "reviewer";

export interface TodoDelegation {
  runId: string;
  taskId: string;
  role: TodoDelegationRole;
  phase: TodoDelegationPhase;
}

export interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TodoStatus;
  blockedBy: number[];
  delegation?: TodoDelegation;
}

export interface TodoSnapshot {
  tasks: TodoTask[];
  nextId: number;
}

export type TodoAction =
  | { action: "create"; subject?: string; description?: string; activeForm?: string; status?: TodoStatus; blockedBy?: number[] }
  | { action: "update"; id?: number; subject?: string; description?: string; activeForm?: string; status?: TodoStatus; blockedBy?: number[] }
  | { action: "list" }
  | { action: "get"; id?: number }
  | { action: "delete"; id?: number }
  | { action: "clear" };

export interface TodoChange {
  snapshot: TodoSnapshot;
  task?: TodoTask;
  deleted?: TodoTask;
  cleared?: number;
}

const copyTask = (task: TodoTask): TodoTask => ({
  ...task,
  blockedBy: [...task.blockedBy],
  ...(task.delegation ? { delegation: { ...task.delegation } } : {}),
});
export const copyTodoSnapshot = (snapshot: TodoSnapshot): TodoSnapshot => ({
  tasks: snapshot.tasks.map(copyTask),
  nextId: snapshot.nextId,
});

export const emptyTodoSnapshot = (): TodoSnapshot => ({ tasks: [], nextId: 1 });

function validText(value: unknown, name: string, maximum: number, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > maximum) throw new Error(`${name} must be at most ${maximum} characters`);
  const text = safeDisplayLine(value);
  if (required && !text) throw new Error(`${name} is required`);
  return text || undefined;
}

function validId(value: unknown, name = "id"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive integer`);
  return value as number;
}

function validStatus(value: unknown): TodoStatus {
  if (typeof value !== "string" || !TODO_STATUSES.includes(value as TodoStatus)) throw new Error("Invalid todo status");
  return value as TodoStatus;
}

function validBlockers(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("blockedBy must be an array");
  if (value.length > TODO_LIMITS.blockers) throw new Error(`blockedBy may contain at most ${TODO_LIMITS.blockers} ids`);
  const blockers = value.map((id) => validId(id, "blockedBy id"));
  if (new Set(blockers).size !== blockers.length) throw new Error("blockedBy ids must be unique");
  return blockers;
}

function validDelegation(value: unknown): TodoDelegation | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid todo delegation");
  const input = value as Record<string, unknown>;
  const runId = validText(input.runId, "delegation runId", 100, true)!;
  const taskId = validText(input.taskId, "delegation taskId", 80, true)!;
  if (input.role !== "explorer" && input.role !== "worker" && input.role !== "reviewer") throw new Error("Invalid todo delegation role");
  if (typeof input.phase !== "string" || !TODO_DELEGATION_PHASES.includes(input.phase as TodoDelegationPhase)) {
    throw new Error("Invalid todo delegation phase");
  }
  return { runId, taskId, role: input.role, phase: input.phase as TodoDelegationPhase };
}

function validateTasks(tasks: TodoTask[]): void {
  if (tasks.length > TODO_LIMITS.tasks) throw new Error(`Todo list may contain at most ${TODO_LIMITS.tasks} tasks`);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Task ids must be unique");
  if (tasks.filter((task) => task.status === "in_progress" && !task.delegation).length > 1) {
    throw new Error("Only one parent-owned task may be in_progress");
  }
  const delegationKeys = tasks.flatMap((task) => task.delegation ? [`${task.delegation.runId}\0${task.delegation.taskId}`] : []);
  if (new Set(delegationKeys).size !== delegationKeys.length) throw new Error("Todo delegations must be unique");

  for (const task of tasks) {
    if (task.delegation && task.status !== "in_progress") throw new Error(`Delegated task #${task.id} must be in_progress`);
    if (task.blockedBy.includes(task.id)) throw new Error(`Task #${task.id} cannot block itself`);
    for (const id of task.blockedBy) {
      if (!byId.has(id)) throw new Error(`Task #${task.id} has dangling blocker #${id}`);
      if (task.status !== "pending" && byId.get(id)?.status !== "completed") {
        throw new Error(`Task #${task.id} cannot be ${task.status} until blocker #${id} is completed`);
      }
    }
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visiting.has(id)) throw new Error("Task dependencies must not contain a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const blocker of byId.get(id)?.blockedBy ?? []) visit(blocker);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

export function validateTodoSnapshot(value: unknown): TodoSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid todo snapshot");
  const input = value as { tasks?: unknown; nextId?: unknown };
  if (!Array.isArray(input.tasks)) throw new Error("Invalid todo snapshot tasks");
  const tasks = input.tasks.map((value): TodoTask => {
    if (!value || typeof value !== "object") throw new Error("Invalid todo task");
    const task = value as Record<string, unknown>;
    return {
      id: validId(task.id),
      subject: validText(task.subject, "subject", TODO_LIMITS.subject, true)!,
      description: validText(task.description, "description", TODO_LIMITS.description),
      activeForm: validText(task.activeForm, "activeForm", TODO_LIMITS.activeForm),
      status: validStatus(task.status),
      blockedBy: validBlockers(task.blockedBy),
      delegation: validDelegation(task.delegation),
    };
  });
  const nextId = validId(input.nextId, "nextId");
  if (tasks.some((task) => task.id >= nextId)) throw new Error("nextId must exceed every task id");
  validateTasks(tasks);
  return copyTodoSnapshot({ tasks, nextId });
}

function validateActionFields(input: TodoAction): void {
  const allowed = new Set<string>(input.action === "create"
    ? ["action", "subject", "description", "activeForm", "status", "blockedBy"]
    : input.action === "update"
      ? ["action", "id", "subject", "description", "activeForm", "status", "blockedBy"]
      : input.action === "get" || input.action === "delete"
        ? ["action", "id"]
        : ["action"]);
  const irrelevant = Object.entries(input as unknown as Record<string, unknown>)
    .filter(([name, value]) => value !== undefined && !allowed.has(name))
    .map(([name]) => name);
  if (irrelevant.length > 0) throw new Error(`${input.action} does not accept: ${irrelevant.join(", ")}`);
}

export function applyTodoAction(current: TodoSnapshot, input: TodoAction): TodoChange {
  validateActionFields(input);
  const snapshot = validateTodoSnapshot(current);
  const find = (id: unknown) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === validId(id));
    if (!task) throw new Error(`Task #${String(id)} not found`);
    return task;
  };

  switch (input.action) {
    case "list":
      return { snapshot };
    case "get":
      return { snapshot, task: copyTask(find(input.id)) };
    case "create": {
      if (snapshot.tasks.length >= TODO_LIMITS.tasks) throw new Error(`Todo list is limited to ${TODO_LIMITS.tasks} tasks`);
      if (snapshot.nextId >= Number.MAX_SAFE_INTEGER) throw new Error("Todo id space is exhausted");
      const task: TodoTask = {
        id: snapshot.nextId++,
        subject: validText(input.subject, "subject", TODO_LIMITS.subject, true)!,
        description: validText(input.description, "description", TODO_LIMITS.description),
        activeForm: validText(input.activeForm, "activeForm", TODO_LIMITS.activeForm),
        status: input.status === undefined ? "pending" : validStatus(input.status),
        blockedBy: validBlockers(input.blockedBy),
      };
      snapshot.tasks.push(task);
      validateTasks(snapshot.tasks);
      return { snapshot: copyTodoSnapshot(snapshot), task: copyTask(task) };
    }
    case "update": {
      const task = find(input.id);
      if (input.subject !== undefined) task.subject = validText(input.subject, "subject", TODO_LIMITS.subject, true)!;
      if (input.description !== undefined) task.description = validText(input.description, "description", TODO_LIMITS.description);
      if (input.activeForm !== undefined) task.activeForm = validText(input.activeForm, "activeForm", TODO_LIMITS.activeForm);
      if (input.status !== undefined) {
        task.status = validStatus(input.status);
        task.delegation = undefined;
      }
      if (input.blockedBy !== undefined) task.blockedBy = validBlockers(input.blockedBy);
      validateTasks(snapshot.tasks);
      return { snapshot: copyTodoSnapshot(snapshot), task: copyTask(task) };
    }
    case "delete": {
      const task = find(input.id);
      snapshot.tasks.splice(snapshot.tasks.indexOf(task), 1);
      validateTasks(snapshot.tasks);
      return { snapshot: copyTodoSnapshot(snapshot), deleted: copyTask(task) };
    }
    case "clear": {
      const cleared = snapshot.tasks.length;
      return { snapshot: emptyTodoSnapshot(), cleared };
    }
  }
}

export interface TodoDelegationClaim {
  todoId: number;
  runId: string;
  taskId: string;
  role: TodoDelegationRole;
}

export function claimTodoDelegations(current: TodoSnapshot, claims: readonly TodoDelegationClaim[]): TodoSnapshot {
  const snapshot = validateTodoSnapshot(current);
  if (claims.length === 0) return snapshot;
  const todoIds = claims.map((claim) => validId(claim.todoId, "todoId"));
  if (new Set(todoIds).size !== todoIds.length) throw new Error("A todo may be claimed only once per agent wave");
  const completed = new Set(snapshot.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  for (const claim of claims) {
    const task = snapshot.tasks.find((candidate) => candidate.id === claim.todoId);
    if (!task) throw new Error(`Task #${claim.todoId} not found`);
    if (task.status !== "pending" || task.delegation) throw new Error(`Task #${claim.todoId} is not ready for delegation`);
    if (!task.blockedBy.every((id) => completed.has(id))) throw new Error(`Task #${claim.todoId} is blocked`);
    const delegation = validDelegation({ ...claim, phase: "queued" });
    task.status = "in_progress";
    task.delegation = delegation;
  }
  validateTasks(snapshot.tasks);
  return copyTodoSnapshot(snapshot);
}

export function updateTodoDelegation(
  current: TodoSnapshot,
  claim: Pick<TodoDelegationClaim, "todoId" | "runId" | "taskId">,
  phase: TodoDelegationPhase | "release",
): TodoSnapshot {
  const snapshot = validateTodoSnapshot(current);
  const task = snapshot.tasks.find((candidate) => candidate.id === validId(claim.todoId, "todoId"));
  if (!task?.delegation || task.delegation.runId !== claim.runId || task.delegation.taskId !== claim.taskId) {
    throw new Error(`Task #${claim.todoId} is not claimed by ${claim.runId}/${claim.taskId}`);
  }
  if (phase === "release") {
    task.status = "pending";
    task.delegation = undefined;
  } else {
    task.delegation.phase = phase;
  }
  validateTasks(snapshot.tasks);
  return copyTodoSnapshot(snapshot);
}
