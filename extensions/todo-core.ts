export const TODO_LIMITS = {
  tasks: 25,
  subject: 200,
  description: 2000,
  activeForm: 120,
  blockers: 10,
} as const;

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TodoStatus;
  blockedBy: number[];
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

const copyTask = (task: TodoTask): TodoTask => ({ ...task, blockedBy: [...task.blockedBy] });
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
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
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

function validateTasks(tasks: TodoTask[]): void {
  if (tasks.length > TODO_LIMITS.tasks) throw new Error(`Todo list may contain at most ${TODO_LIMITS.tasks} tasks`);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Task ids must be unique");
  if (tasks.filter((task) => task.status === "in_progress").length > 1) {
    throw new Error("Only one task may be in_progress");
  }

  for (const task of tasks) {
    if (task.blockedBy.includes(task.id)) throw new Error(`Task #${task.id} cannot block itself`);
    for (const id of task.blockedBy) {
      if (!byId.has(id)) throw new Error(`Task #${task.id} has dangling blocker #${id}`);
      if (task.status === "completed" && byId.get(id)?.status !== "completed") {
        throw new Error(`Task #${task.id} cannot be completed until blocker #${id} is completed`);
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
    };
  });
  const nextId = validId(input.nextId, "nextId");
  if (tasks.some((task) => task.id >= nextId)) throw new Error("nextId must exceed every task id");
  validateTasks(tasks);
  return copyTodoSnapshot({ tasks, nextId });
}

export function applyTodoAction(current: TodoSnapshot, input: TodoAction): TodoChange {
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
      if (input.status !== undefined) task.status = validStatus(input.status);
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
