import { safeDisplayLine } from "./text-safety.ts";

export const GOAL_LIMITS = {
  objective: 4000,
  summary: 4000,
  reason: 2000,
  evidence: 4000,
  snapshotText: 4000,
} as const;

export type GoalStatus = "active" | "paused" | "waiting" | "completed";

export interface GoalSnapshot {
  id: string;
  objective: string;
  status: GoalStatus;
  waitingUntil?: number;
  note?: string;
}

export type GoalCommand =
  | { type: "create"; objective: string }
  | { type: "status" | "pause" | "resume" | "clear" }
  | { type: "edit"; objective: string }
  | { type: "invalid"; error: string };

const VALID_STATUSES = new Set<GoalStatus>(["active", "paused", "waiting", "completed"]);

export function cleanGoalText(value: string): string {
  return safeDisplayLine(value);
}

function objectiveOnly(input: string): { objective: string } | { error: string } {
  let objective = input.trim();
  if (/(?:^|\s)--tokens(?:=|\s|$)/i.test(objective)) {
    return { error: "Goal token budgets are no longer supported; use /goal pause or /goal clear to stop a goal." };
  }
  if (objective.length > GOAL_LIMITS.objective) return { error: `Objective must be at most ${GOAL_LIMITS.objective} characters.` };
  objective = cleanGoalText(objective);
  if (!objective) return { error: "Objective is required." };
  return { objective };
}

export function parseGoalCommand(value: unknown): GoalCommand {
  const text = String(value ?? "").trim();
  if (!text) return { type: "status" };
  const command = text.match(/^(status|pause|resume|clear)(?:\s+|$)/i);
  if (command) {
    return text.toLowerCase() === command[1]!.toLowerCase()
      ? { type: command[1]!.toLowerCase() as "status" | "pause" | "resume" | "clear" }
      : { type: "invalid", error: `${command[1]!.toLowerCase()} does not accept arguments.` };
  }
  const edit = /^edit(?:\s+|$)/i.exec(text);
  const parsed = objectiveOnly(edit ? text.slice(edit[0].length) : text);
  if ("error" in parsed) return { type: "invalid", error: parsed.error };
  return { type: edit ? "edit" : "create", ...parsed };
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length <= maximum ? cleanGoalText(value) : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

export function validateGoalSnapshot(value: unknown): GoalSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const objective = boundedText(input.objective, GOAL_LIMITS.objective);
  const id = boundedText(input.id, 100);
  if (!id || !objective?.trim() || !VALID_STATUSES.has(input.status as GoalStatus)) return undefined;
  const waitingUntil = input.waitingUntil === undefined ? undefined : nonnegativeInteger(input.waitingUntil);
  if (input.waitingUntil !== undefined && waitingUntil === undefined) return undefined;
  const note = boundedText(input.note, GOAL_LIMITS.snapshotText);
  return {
    id, objective, status: input.status as GoalStatus,
    ...(waitingUntil === undefined ? {} : { waitingUntil }),
    ...(note === undefined ? {} : { note }),
  };
}
