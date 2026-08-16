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
  automaticResponses: 0,
  automaticRuns: 0,
  repeatedToolFreeRuns: 0,
  ...overrides,
});

test("goal parser accepts bounded objectives, rejects legacy token caps, and sanitizes text", () => {
  assert.deepEqual(parseGoalCommand("Ship it"), { type: "create", objective: "Ship it" });
  assert.deepEqual(parseGoalCommand("edit Safer objective"), { type: "edit", objective: "Safer objective" });
  assert.match(parseGoalCommand("Ship it --tokens 100k").error, /no longer supported/);
  assert.match(parseGoalCommand("--tokens 1.5k Ship it").error, /no longer supported/);
  assert.match(parseGoalCommand("Ship it --tokens=100k").error, /no longer supported/);
  assert.equal(parseGoalCommand("Ship\u001b[31m safely\u202e").objective, "Ship safely");
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

test("productive runs have no response ceiling", () => {
  assert.equal(automaticStopReason(goal({ automaticResponses: 1_000_000 })), undefined);
});

test("snapshot validation rejects malformed persisted state", () => {
  assert.deepEqual(validateGoalSnapshot(goal()), goal());
  assert.equal(validateGoalSnapshot(goal({ objective: "" })), undefined);
  assert.equal(validateGoalSnapshot(goal({ automaticResponses: -1 })), undefined);
  assert.equal(validateGoalSnapshot(goal({ status: "invented" })), undefined);
});

test("legacy quota fields are accepted and discarded", () => {
  const restored = validateGoalSnapshot(goal({ tokenBudget: 100, tokensUsed: 120 }));
  assert.deepEqual(restored, goal());
  assert.equal("tokenBudget" in restored, false);
  assert.equal("tokensUsed" in restored, false);
});
