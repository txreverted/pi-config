export const GOAL_LIMITS = {
  objective: 4000,
  summary: 4000,
  reason: 2000,
  evidence: 4000,
  automaticResponses: 25,
  repeatedRuns: 3,
  snapshotText: 4000,
} as const;

export type GoalStatus = "active" | "paused" | "waiting" | "completed" | "blocked";

export interface GoalSnapshot {
  id: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  automaticResponses: number;
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
  | { type: "create"; objective: string; tokenBudget?: number }
  | { type: "status" | "pause" | "resume" | "clear" }
  | { type: "edit"; objective: string; tokenBudget?: number }
  | { type: "invalid"; error: string };

const VALID_STATUSES = new Set<GoalStatus>(["active", "paused", "waiting", "completed", "blocked"]);

function parseTokens(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(value);
  if (!match) return undefined;
  const base = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const total = base * multiplier;
  return Number.isSafeInteger(total) && total > 0 ? total : undefined;
}

export function cleanGoalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function objectiveAndBudget(input: string): { objective: string; tokenBudget?: number } | { error: string } {
  let objective = input.trim();
  let budgetText: string | undefined;
  const prefix = /^--tokens\s+(\S+)\s+([\s\S]+)$/i.exec(objective);
  const suffix = /^([\s\S]+?)\s+--tokens\s+(\S+)$/i.exec(objective);
  if (prefix) {
    budgetText = prefix[1];
    objective = prefix[2] ?? "";
  } else if (suffix) {
    objective = suffix[1] ?? "";
    budgetText = suffix[2];
  } else if (/^--tokens(?:\s|$)|\s--tokens(?:\s|$)/i.test(objective)) {
    return { error: "Token budget must be a positive integer, optionally ending in k or m." };
  }
  if (objective.length > GOAL_LIMITS.objective) return { error: `Objective must be at most ${GOAL_LIMITS.objective} characters.` };
  objective = cleanGoalText(objective);
  if (!objective) return { error: "Objective is required." };
  if (budgetText !== undefined) {
    const tokenBudget = parseTokens(budgetText);
    if (!tokenBudget) return { error: "Token budget must be a positive integer, optionally ending in k or m." };
    return { objective, tokenBudget };
  }
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
  const parsed = objectiveAndBudget(edit ? text.slice(edit[0].length) : text);
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
  const tokensUsed = nonnegativeInteger(input.tokensUsed);
  const automaticResponses = nonnegativeInteger(input.automaticResponses);
  const automaticRuns = nonnegativeInteger(input.automaticRuns);
  const repeatedToolFreeRuns = nonnegativeInteger(input.repeatedToolFreeRuns);
  if (!id || !objective?.trim() || !VALID_STATUSES.has(input.status as GoalStatus) || tokensUsed === undefined || automaticResponses === undefined || automaticRuns === undefined || repeatedToolFreeRuns === undefined) return undefined;
  const tokenBudget = input.tokenBudget === undefined ? undefined : nonnegativeInteger(input.tokenBudget);
  if (input.tokenBudget !== undefined && (!tokenBudget || tokenBudget < 1)) return undefined;
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
    id, objective, status: input.status as GoalStatus, tokensUsed, automaticResponses, automaticRuns, repeatedToolFreeRuns,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(lastToolFreeSignature === undefined ? {} : { lastToolFreeSignature }),
    ...(blockerSignature === undefined ? {} : { blockerSignature }),
    ...(blockerReports === undefined ? {} : { blockerReports }),
    ...(lastBlockerRun === undefined ? {} : { lastBlockerRun }),
    ...(waitingUntil === undefined ? {} : { waitingUntil }),
    ...(note === undefined ? {} : { note }),
  };
}

export function recordAutomaticRun(goal: GoalSnapshot, text: string, usedTool: boolean, responseCount: number, tokens: number): GoalSnapshot {
  const next = { ...goal };
  next.automaticResponses += Math.max(0, responseCount);
  next.automaticRuns += 1;
  next.tokensUsed += Math.max(0, tokens);
  const signature = text.trim().replace(/\s+/g, " ").slice(0, GOAL_LIMITS.snapshotText);
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
  if (goal.automaticResponses >= GOAL_LIMITS.automaticResponses) return `automatic response limit (${GOAL_LIMITS.automaticResponses}) reached`;
  if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) return `token budget (${goal.tokenBudget}) reached`;
  if (goal.repeatedToolFreeRuns >= GOAL_LIMITS.repeatedRuns) return `${GOAL_LIMITS.repeatedRuns} repeated or empty tool-free automatic runs`;
  return undefined;
}
