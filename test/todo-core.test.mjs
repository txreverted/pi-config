import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTodoAction,
  claimTodoDelegations,
  emptyTodoSnapshot,
  TODO_LIMITS,
  updateTodoDelegation,
  validateTodoSnapshot,
} from "../extensions/todo-core.ts";

const apply = (snapshot, action) => applyTodoAction(snapshot, action).snapshot;

test("todo lifecycle is deterministic and snapshots are independent", () => {
  const empty = emptyTodoSnapshot();
  const created = applyTodoAction(empty, {
    action: "create",
    subject: " First\n\u001b[31m task\u001b[0m\u202e ",
    description: "safe\u001b]52;c;SGFja2Vk\u0007 description\r\nnext",
  });
  assert.deepEqual(created.task, {
    id: 1,
    subject: "First task",
    description: "safe description next",
    activeForm: undefined,
    status: "pending",
    blockedBy: [],
  });
  assert.deepEqual(empty, { tasks: [], nextId: 1 });

  const updated = applyTodoAction(created.snapshot, { action: "update", id: 1, status: "in_progress", activeForm: "Working" });
  assert.equal(updated.task.status, "in_progress");
  assert.equal(applyTodoAction(updated.snapshot, { action: "get", id: 1 }).task.subject, "First task");

  const removed = applyTodoAction(updated.snapshot, { action: "delete", id: 1 });
  assert.equal(removed.deleted.id, 1);
  assert.deepEqual(applyTodoAction(removed.snapshot, { action: "clear" }).snapshot, emptyTodoSnapshot());
});

test("dependencies must exist, differ from the task, and remain acyclic", () => {
  let snapshot = apply(emptyTodoSnapshot(), { action: "create", subject: "A" });
  snapshot = apply(snapshot, { action: "create", subject: "B", blockedBy: [1] });

  assert.throws(() => apply(snapshot, { action: "update", id: 1, blockedBy: [99] }), /dangling blocker/);
  assert.throws(() => apply(snapshot, { action: "update", id: 1, blockedBy: [1, 1] }), /must be unique/);
  assert.throws(() => apply(snapshot, { action: "update", id: 1, blockedBy: [1] }), /block itself/);
  assert.throws(() => apply(snapshot, { action: "update", id: 1, blockedBy: [2] }), /cycle/);
  assert.throws(() => apply(snapshot, { action: "delete", id: 1 }), /dangling blocker/);
});

test("only one parent task may be active and work waits for blockers", () => {
  let pending = apply(emptyTodoSnapshot(), { action: "create", subject: "Blocker" });
  pending = apply(pending, { action: "create", subject: "Dependent", blockedBy: [1] });
  assert.throws(() => apply(pending, { action: "update", id: 2, status: "in_progress" }), /until blocker/);
  assert.throws(() => apply(pending, { action: "update", id: 2, status: "completed" }), /until blocker/);

  let snapshot = apply(pending, { action: "update", id: 1, status: "in_progress" });
  assert.throws(() => apply(snapshot, { action: "update", id: 2, status: "in_progress" }), /Only one/);
  snapshot = apply(snapshot, { action: "update", id: 1, status: "completed" });
  snapshot = apply(snapshot, { action: "update", id: 2, status: "completed" });
  assert.equal(snapshot.tasks.every((task) => task.status === "completed"), true);
  assert.throws(() => apply(snapshot, { action: "update", id: 1, status: "pending" }), /until blocker/);
});

test("parallel agents claim independent todos without weakening parent ownership", () => {
  let snapshot = apply(emptyTodoSnapshot(), { action: "create", subject: "Parent", status: "in_progress" });
  snapshot = apply(snapshot, { action: "create", subject: "Worker A" });
  snapshot = apply(snapshot, { action: "create", subject: "Worker B" });
  snapshot = claimTodoDelegations(snapshot, [
    { todoId: 2, runId: "run", taskId: "a", role: "worker" },
    { todoId: 3, runId: "run", taskId: "b", role: "reviewer" },
  ]);
  assert.equal(snapshot.tasks.filter((task) => task.status === "in_progress").length, 3);
  assert.equal(snapshot.tasks[1].delegation.phase, "queued");
  snapshot = updateTodoDelegation(snapshot, { todoId: 2, runId: "run", taskId: "a" }, "awaiting_integration");
  snapshot = updateTodoDelegation(snapshot, { todoId: 3, runId: "run", taskId: "b" }, "release");
  assert.equal(snapshot.tasks[1].delegation.phase, "awaiting_integration");
  assert.equal(snapshot.tasks[2].status, "pending");
  assert.throws(() => claimTodoDelegations(snapshot, [{ todoId: 2, runId: "other", taskId: "x", role: "worker" }]), /not ready/);
});

test("all declared bounds are enforced at the core boundary", () => {
  assert.throws(() => apply(emptyTodoSnapshot(), { action: "create", subject: "x".repeat(TODO_LIMITS.subject + 1) }), /subject/);
  assert.throws(() => apply(emptyTodoSnapshot(), { action: "create", subject: "x", description: "d".repeat(TODO_LIMITS.description + 1) }), /description/);
  assert.throws(() => apply(emptyTodoSnapshot(), { action: "create", subject: "x", activeForm: "a".repeat(TODO_LIMITS.activeForm + 1) }), /activeForm/);
  assert.throws(() => apply(emptyTodoSnapshot(), { action: "create", subject: "x", blockedBy: Array.from({ length: 11 }, (_, index) => index + 1) }), /at most 10/);

  let snapshot = emptyTodoSnapshot();
  for (let index = 0; index < TODO_LIMITS.tasks; index++) snapshot = apply(snapshot, { action: "create", subject: `Task ${index}` });
  assert.throws(() => apply(snapshot, { action: "create", subject: "Overflow" }), /limited to 25/);
});

test("todo actions reject irrelevant fields", () => {
  const snapshot = emptyTodoSnapshot();
  assert.throws(() => applyTodoAction(snapshot, { action: "list", subject: "ignored" }), /list does not accept: subject/);
  assert.throws(() => applyTodoAction(snapshot, { action: "clear", id: 1 }), /clear does not accept: id/);
  assert.throws(() => applyTodoAction(snapshot, { action: "create", id: 1, subject: "Task" }), /create does not accept: id/);
});

test("snapshot validation rejects malformed persisted state", () => {
  assert.throws(() => validateTodoSnapshot({ tasks: [{ id: 1, subject: "A", status: "unknown", blockedBy: [] }], nextId: 2 }), /status/);
  assert.throws(() => validateTodoSnapshot({ tasks: [{ id: 1, subject: "A", status: "pending", blockedBy: [] }], nextId: 1 }), /nextId/);
});

test("creation fails without mutation when the id space is exhausted", () => {
  const exhausted = { tasks: [], nextId: Number.MAX_SAFE_INTEGER };
  assert.throws(() => applyTodoAction(exhausted, { action: "create", subject: "Overflow" }), /id space is exhausted/);
  assert.deepEqual(exhausted, { tasks: [], nextId: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(applyTodoAction(exhausted, { action: "list" }).snapshot, exhausted);
});
