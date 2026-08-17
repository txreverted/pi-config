import test from "node:test";
import assert from "node:assert/strict";
import { BackgroundRunManager } from "../extensions/subagents-background.ts";
import { emptyUsage } from "../extensions/subagents-core.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function task(id) {
  return { id, name: `Task ${id}`, agent: "worker", task: `Task ${id}`, cwd: process.cwd() };
}

function resultFor(value, status = "done") {
  const now = Date.now();
  return {
    id: value.id,
    agent: value.agent,
    thinking: "medium",
    status,
    startedAt: now,
    turns: 1,
    toolCalls: 1,
    text: status === "done" ? "done" : "",
    usage: { ...emptyUsage(), output: 1, totalTokens: 1 },
    task: value.task,
    cwd: value.cwd,
    output: status === "done" ? "done" : "",
    ...(status === "error" ? { error: "cancelled" } : {}),
    exitCode: status === "done" ? 0 : null,
    endedAt: now,
    durationMs: 0,
    truncated: false,
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("background manager bounds concurrency and drains FIFO", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const started = [];
  const completed = [];
  const manager = new BackgroundRunManager(2, 3, (result) => completed.push(result.id));

  for (let index = 0; index < 3; index++) {
    const value = task(`job-${index + 1}`);
    manager.enqueue(value, "medium", async () => {
      started.push(value.id);
      await gates[index].promise;
      return resultFor(value);
    });
  }
  await nextTurn();
  assert.deepEqual(started, ["job-1", "job-2"]);
  assert.deepEqual(manager.active().map((entry) => entry.name), ["Task job-1", "Task job-2", "Task job-3"]);
  assert.equal(manager.progress("job-3").status, "queued");

  gates[0].resolve();
  await manager.wait("job-1");
  await nextTurn();
  assert.deepEqual(started, ["job-1", "job-2", "job-3"]);

  gates[1].resolve();
  gates[2].resolve();
  await Promise.all([manager.wait("job-2"), manager.wait("job-3")]);
  assert.deepEqual(completed, ["job-1", "job-2", "job-3"]);
  assert.deepEqual(manager.active(), []);
  assert.equal(manager.hasOutstanding(), true);
  assert.equal(manager.availableSlots(), 0);
  assert.throws(
    () => manager.enqueue(task("job-4"), "medium", async () => resultFor(task("job-4"))),
    /capacity is 3/,
  );

  const collected = manager.collect("job-1");
  assert.equal(collected.usage.totalTokens, 1);
  assert.equal(manager.progress("job-1"), undefined);
  assert.equal(manager.collect("job-1"), undefined);
  assert.equal(manager.hasOutstanding(), true);
  assert.equal(manager.availableSlots(), 1);
});

test("background manager cancels queued work and aborts running work on shutdown", async () => {
  const completed = [];
  const manager = new BackgroundRunManager(1, 2, (result) => completed.push(result.id));
  const first = task("running");
  const second = task("queued");

  manager.enqueue(first, "medium", (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      setTimeout(() => resolve(resultFor(first, "error")), 20);
    }, { once: true });
  }));
  manager.enqueue(second, "medium", async () => resultFor(second));
  await nextTurn();

  assert.equal(manager.cancel("queued"), true);
  assert.equal((await manager.wait("queued")).status, "error");
  assert.deepEqual(completed, ["queued"]);

  let shutdownSettled = false;
  const shutdown = manager.shutdown().then(() => { shutdownSettled = true; });
  await nextTurn();
  assert.equal(shutdownSettled, false);
  await shutdown;
  assert.equal((await manager.wait("running")).status, "error");
  assert.deepEqual(completed, ["queued"]);
});
