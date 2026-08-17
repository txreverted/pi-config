import test from "node:test";
import assert from "node:assert/strict";
import { GOAL_LIMITS, parseGoalCommand, validateGoalSnapshot } from "../extensions/goal-core.ts";

const goal = (overrides = {}) => ({
  id: "goal-1",
  objective: "Ship the fix",
  status: "active",
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

test("snapshot validation rejects malformed persisted state", () => {
  assert.deepEqual(validateGoalSnapshot(goal()), goal());
  assert.equal(validateGoalSnapshot(goal({ objective: "" })), undefined);
  assert.equal(validateGoalSnapshot(goal({ waitingUntil: -1 })), undefined);
  assert.equal(validateGoalSnapshot(goal({ status: "invented" })), undefined);
  assert.equal(validateGoalSnapshot(goal({ status: "blocked" })), undefined);
});
