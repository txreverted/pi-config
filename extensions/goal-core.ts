import { safeDisplayLine } from "./text-safety.ts";

export const GOAL_LIMITS = {
  objective: 4000,
  summary: 4000,
  reason: 2000,
  evidence: 4000,
  repeatedRuns: 3,
  automaticRuns: 20,
  snapshotText: 4000,
} as const;

export type GoalStatus = "active" | "paused" | "waiting" | "completed" | "blocked";

export interface GoalSnapshot {
  id: string;
  objective: string;
  status: GoalStatus;
  automaticRuns: number;
  repeatedToolFreeRuns: number;
  lastToolFreeSignature?: string;
  blockerSignature?: string;
  blockerReports?: number;
  lastBlockerRun?: number;
  waitingUntil?: number;
  note?: string;
}

export type GoalCommand =
  | { type: "create"; objective: string }
  | { type: "status" | "pause" | "resume" | "clear" }
  | { type: "edit"; objective: string }
  | { type: "invalid"; error: string };

const VALID_STATUSES = new Set<GoalStatus>(["active", "paused", "waiting", "completed", "blocked"]);

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
  const automaticResponses = input.automaticResponses === undefined ? undefined : nonnegativeInteger(input.automaticResponses);
  const automaticRuns = nonnegativeInteger(input.automaticRuns);
  const repeatedToolFreeRuns = nonnegativeInteger(input.repeatedToolFreeRuns);
  if (!id || !objective?.trim() || !VALID_STATUSES.has(input.status as GoalStatus) || (input.automaticResponses !== undefined && automaticResponses === undefined) || automaticRuns === undefined || repeatedToolFreeRuns === undefined) return undefined;
  const waitingUntil = input.waitingUntil === undefined ? undefined : nonnegativeInteger(input.waitingUntil);
  if (input.waitingUntil !== undefined && waitingUntil === undefined) return undefined;
  const blockerReports = input.blockerReports === undefined ? undefined : nonnegativeInteger(input.blockerReports);
  const lastBlockerRun = input.lastBlockerRun === undefined ? undefined : nonnegativeInteger(input.lastBlockerRun);
  if (input.blockerReports !== undefined && blockerReports === undefined) return undefined;
  if (input.lastBlockerRun !== undefined && lastBlockerRun === undefined) return undefined;
  const lastToolFreeSignature = boundedText(input.lastToolFreeSignature, GOAL_LIMITS.snapshotText);
  const blockerSignature = boundedText(input.blockerSignature, 64);
  const note = boundedText(input.note, GOAL_LIMITS.snapshotText);
  if (input.blockerSignature !== undefined && blockerSignature === undefined) return undefined;
  return {
    id, objective, status: input.status as GoalStatus, automaticRuns, repeatedToolFreeRuns,
    ...(lastToolFreeSignature === undefined ? {} : { lastToolFreeSignature }),
    ...(blockerSignature === undefined ? {} : { blockerSignature }),
    ...(blockerReports === undefined ? {} : { blockerReports }),
    ...(lastBlockerRun === undefined ? {} : { lastBlockerRun }),
    ...(waitingUntil === undefined ? {} : { waitingUntil }),
    ...(note === undefined ? {} : { note }),
  };
}

export function recordAutomaticRun(goal: GoalSnapshot, text: string, usedTool: boolean): GoalSnapshot {
  const next = { ...goal };
  next.automaticRuns += 1;
  const signature = cleanGoalText(text).slice(0, GOAL_LIMITS.snapshotText);
  if (usedTool) {
    next.repeatedToolFreeRuns = 0;
    delete next.lastToolFreeSignature;
  } else if (!signature || signature === next.lastToolFreeSignature) {
    next.repeatedToolFreeRuns += 1;
    next.lastToolFreeSignature = signature;
  } else {
    next.repeatedToolFreeRuns = 1;
    next.lastToolFreeSignature = signature;
  }
  return next;
}

export function automaticStopReason(goal: GoalSnapshot): string | undefined {
  if (goal.automaticRuns >= GOAL_LIMITS.automaticRuns) return `${GOAL_LIMITS.automaticRuns} automatic runs`;
  if (goal.repeatedToolFreeRuns >= GOAL_LIMITS.repeatedRuns) return `${GOAL_LIMITS.repeatedRuns} repeated or empty tool-free automatic runs`;
  return undefined;
}
