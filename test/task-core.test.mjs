import test from "node:test";
import assert from "node:assert/strict";
import { applyTaskAction, emptyTaskSnapshot } from "../extensions/task-core.ts";

const main = { id: "main", main: true };
const agent = { id: "worker-1", main: false };
const other = { id: "worker-2", main: false };

function apply(snapshot, action, caller = main, now = 100) {
  return applyTaskAction(snapshot, action, caller, now);
}

test("shared tasks validate dependencies and atomically choose unblocked pending work", () => {
  let snapshot = emptyTaskSnapshot();
  snapshot = apply(snapshot, { action: "create", subject: "First" }).snapshot;
  snapshot = apply(snapshot, { action: "create", subject: "Blocked", blockedBy: [1] }).snapshot;
  snapshot = apply(snapshot, { action: "create", subject: "Ready" }).snapshot;

  const claimed = apply(snapshot, { action: "claim" }, agent, 200);
  assert.equal(claimed.task.id, 1);
  assert.equal(claimed.task.owner, "worker-1");
  assert.equal(claimed.task.status, "in_progress");
  assert.equal(claimed.task.version, 2);
  assert.throws(() => apply(claimed.snapshot, { action: "claim", id: 3 }, agent), /already has an active task/);

  snapshot = apply(claimed.snapshot, { action: "update", id: 1, status: "completed" }, agent, 300).snapshot;
  assert.equal(apply(snapshot, { action: "claim" }, other).task.id, 2);
  snapshot = apply(snapshot, { action: "update", id: 3, blockedBy: [2] }).snapshot;
  assert.throws(() => apply(snapshot, { action: "update", id: 1, blockedBy: [3] }), /cycle|blocked/i);
});

test("implicit claim-next skips tasks assigned to another owner", () => {
  let snapshot = apply(emptyTaskSnapshot(), { action: "create", subject: "Assigned", owner: "worker-2" }).snapshot;
  snapshot = apply(snapshot, { action: "create", subject: "Unowned" }).snapshot;
  assert.equal(apply(snapshot, { action: "claim" }, main).task.id, 2);
  assert.equal(apply(snapshot, { action: "claim", id: 1 }, main).task.id, 1);
});

test("agents mutate only owned work while main can administer", () => {
  let snapshot = apply(emptyTaskSnapshot(), { action: "create", subject: "Owned", owner: "worker-1" }).snapshot;
  assert.throws(() => apply(snapshot, { action: "update", id: 1, subject: "No" }, other), /only tasks they own/);
  snapshot = apply(snapshot, { action: "update", id: 1, owner: "" }, main).snapshot;
  assert.equal(snapshot.tasks[0].owner, undefined);
  snapshot = apply(snapshot, { action: "claim", id: 1 }, agent).snapshot;
  snapshot = apply(snapshot, { action: "release", id: 1 }, agent).snapshot;
  assert.equal(snapshot.tasks[0].owner, undefined);
  assert.throws(() => apply(snapshot, { action: "clear" }, agent), /Only main/);
  assert.equal(apply(snapshot, { action: "delete", id: 1 }, main).snapshot.tasks.length, 0);
});

test("metadata and active owners are bounded", () => {
  assert.throws(() => apply(emptyTaskSnapshot(), { action: "create", subject: "Bad", metadata: "not-object" }), /JSON object/);
  assert.throws(() => apply(emptyTaskSnapshot(), { action: "create", subject: "Huge", metadata: { value: "x".repeat(9_000) } }), /at most 8192/);

  let snapshot = apply(emptyTaskSnapshot(), { action: "create", subject: "One", status: "in_progress", owner: "same" }).snapshot;
  assert.throws(() => apply(snapshot, { action: "create", subject: "Two", status: "in_progress", owner: "same" }), /already has an active task/);
});
