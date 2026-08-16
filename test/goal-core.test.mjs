import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticStopReason,
  GOAL_LIMITS,
  parseGoalCommand,
  recordAutomaticRun,
  validateGoalSnapshot,
} from "../extensions/goal-core.ts";

const goal = (overrides = {}) => ({
  id: "goal-1",
  objective: "Ship the fix",
  status: "active",
  tokensUsed: 0,
  automaticResponses: 0,
  automaticRuns: 0,
  repeatedToolFreeRuns: 0,
  ...overrides,
});

test("goal parser accepts bounded objectives, token suffixes, and exact subcommands", () => {
  assert.deepEqual(parseGoalCommand("Ship it --tokens 100k"), { type: "create", objective: "Ship it", tokenBudget: 100_000 });
  assert.deepEqual(parseGoalCommand("--tokens 1.5k Ship it"), { type: "create", objective: "Ship it", tokenBudget: 1_500 });
  assert.deepEqual(parseGoalCommand("edit Safer objective --tokens 2m"), { type: "edit", objective: "Safer objective", tokenBudget: 2_000_000 });
  assert.equal(parseGoalCommand("Ship\u001b[31m safely").objective, "Ship [31m safely");
  assert.deepEqual(parseGoalCommand("pause"), { type: "pause" });
  assert.equal(parseGoalCommand(`x${"y".repeat(GOAL_LIMITS.objective)}`).type, "invalid");
  assert.equal(parseGoalCommand("resume now").type, "invalid");
  assert.equal(parseGoalCommand("work --tokens nope").type, "invalid");
});

test("automatic safety counts only identical or empty tool-free runs", () => {
  let state = recordAutomaticRun(goal(), "same output", false, 1, 10);
  assert.equal(state.repeatedToolFreeRuns, 1);
  state = recordAutomaticRun(state, " same   output ", false, 1, 10);
  state = recordAutomaticRun(state, "same output", false, 1, 10);
  assert.match(automaticStopReason(state), /repeated or empty/);

  state = recordAutomaticRun(state, "same output", true, 1, 10);
  assert.equal(state.repeatedToolFreeRuns, 0);
  assert.equal(automaticStopReason(state), undefined);
});

test("response and token ceilings stop at the settled boundary", () => {
  assert.match(automaticStopReason(goal({ automaticResponses: 25 })), /response limit/);
  assert.equal(automaticStopReason(goal({ tokenBudget: 100, tokensUsed: 99 })), undefined);
  assert.match(automaticStopReason(goal({ tokenBudget: 100, tokensUsed: 120 })), /token budget/);
});

test("snapshot validation rejects malformed persisted state", () => {
  assert.deepEqual(validateGoalSnapshot(goal()), goal());
  assert.equal(validateGoalSnapshot(goal({ objective: "" })), undefined);
  assert.equal(validateGoalSnapshot(goal({ automaticResponses: -1 })), undefined);
  assert.equal(validateGoalSnapshot(goal({ status: "invented" })), undefined);
});
