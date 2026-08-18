import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  emptyTodoSnapshot,
  validateTodoSnapshot,
  type TodoDelegationRole,
  type TodoSnapshot,
} from "./todo-core.ts";

export const CONFIG_EVENTS = {
  ponytailMode: "pi-config:ponytail-mode",
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

function resultDetails(entry: SessionEntry): { toolName: string; details: Record<string, unknown> } | undefined {
  if (entry.type !== "message" || entry.message.role !== "toolResult") return undefined;
  const details = entry.message.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  return { toolName: entry.message.toolName, details: details as Record<string, unknown> };
}

export function restoreCoordinatedTodoSnapshot(entries: readonly SessionEntry[]): TodoSnapshot {
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

export function unresolvedAgentPatches(entries: readonly SessionEntry[]): UnresolvedAgentPatch[] {
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
