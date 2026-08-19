import {
  emptyTodoSnapshot,
  validateTodoSnapshot,
  type TodoDelegationRole,
  type TodoSnapshot,
} from "./todo-core.ts";

export const CONFIG_EVENTS = {
  subagentProgress: "pi-config:subagents-progress",
  todoSnapshot: "pi-config:todo-snapshot",
} as const;

export interface SubagentActivity {
  runId: string;
  taskId: string;
  todoId?: number;
  role: TodoDelegationRole;
  status: "queued" | "starting" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  activity?: string;
}

export interface SubagentProgressEvent {
  runId: string;
  tasks: SubagentActivity[];
}

const SUBAGENT_ROLES = new Set(["explorer", "worker", "reviewer"]);
const SUBAGENT_STATUSES = new Set(["queued", "starting", "running", "succeeded", "failed", "blocked", "cancelled"]);

function resultDetails(entry: unknown): { toolName: string; details: Record<string, unknown> } | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as { type?: unknown; message?: unknown };
  if (candidate.type !== "message" || !candidate.message || typeof candidate.message !== "object") return undefined;
  const message = candidate.message as Record<string, unknown>;
  if (message.role !== "toolResult" || typeof message.toolName !== "string") return undefined;
  const details = message.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  return { toolName: message.toolName, details: details as Record<string, unknown> };
}

export function restoreCoordinatedTodoSnapshot(entries: readonly unknown[]): TodoSnapshot {
  let snapshot = emptyTodoSnapshot();
  for (const entry of entries) {
    const result = resultDetails(entry);
    if (!result) continue;
    const candidate = result.toolName === "todo"
      ? result.details.snapshot
      : result.toolName === "parallel_agents" || result.toolName === "agent_patch"
        ? result.details.todoSnapshot
        : undefined;
    if (candidate === undefined) continue;
    try {
      snapshot = validateTodoSnapshot(candidate);
    } catch {
      // Keep the latest validated branch snapshot.
    }
  }
  return snapshot;
}

export interface UnresolvedAgentPatch {
  runId: string;
  taskId: string;
}

export function unresolvedAgentPatches(entries: readonly unknown[]): UnresolvedAgentPatch[] {
  const unresolved = new Map<string, UnresolvedAgentPatch>();
  for (const entry of entries) {
    const result = resultDetails(entry);
    if (!result) continue;
    if (result.toolName === "parallel_agents" && typeof result.details.runId === "string" && Array.isArray(result.details.results)) {
      for (const value of result.details.results) {
        if (!value || typeof value !== "object") continue;
        const task = value as Record<string, unknown>;
        if (typeof task.id !== "string" || task.role !== "worker" || task.patchState !== "ready") continue;
        const patch = { runId: result.details.runId, taskId: task.id };
        unresolved.set(`${patch.runId}\0${patch.taskId}`, patch);
      }
    }
    if (result.toolName === "agent_patch" && typeof result.details.runId === "string" && typeof result.details.taskId === "string") {
      if (result.details.patchState === "applied" || result.details.patchState === "discarded") {
        unresolved.delete(`${result.details.runId}\0${result.details.taskId}`);
      }
    }
  }
  return [...unresolved.values()];
}

export function validateSubagentProgressEvent(value: unknown): SubagentProgressEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.runId !== "string" || !Array.isArray(input.tasks)) return undefined;
  const tasks: SubagentActivity[] = [];
  for (const value of input.tasks) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const task = value as Record<string, unknown>;
    if (
      typeof task.runId !== "string" || typeof task.taskId !== "string" ||
      !SUBAGENT_ROLES.has(task.role as string) || !SUBAGENT_STATUSES.has(task.status as string) ||
      (task.todoId !== undefined && (!Number.isSafeInteger(task.todoId) || (task.todoId as number) < 1)) ||
      (task.activity !== undefined && typeof task.activity !== "string")
    ) return undefined;
    tasks.push({
      runId: task.runId,
      taskId: task.taskId,
      ...(task.todoId === undefined ? {} : { todoId: task.todoId as number }),
      role: task.role as SubagentActivity["role"],
      status: task.status as SubagentActivity["status"],
      ...(task.activity === undefined ? {} : { activity: task.activity }),
    });
  }
  return { runId: input.runId, tasks };
}
