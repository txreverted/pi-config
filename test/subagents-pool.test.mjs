import test from "node:test";
import assert from "node:assert/strict";
import { runOrderedPool } from "../extensions/subagents-pool.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const size of [2, 4, 5, 10]) {
  test(`ordered pool caps concurrency and retains order for ${size} items`, async () => {
    const gates = Array.from({ length: size }, deferred);
    const started = [];
    let active = 0;
    let maximum = 0;
    const execution = runOrderedPool(
      Array.from({ length: size }, (_, index) => index),
      async (item) => {
        started.push(item);
        active++;
        maximum = Math.max(maximum, active);
        await gates[item].promise;
        active--;
        return `result-${item}`;
      },
      { concurrency: 4 },
    );

    await tick();
    assert.deepEqual(started, Array.from({ length: Math.min(4, size) }, (_, index) => index));
    while (started.length < size) {
      const before = started.length;
      gates[before - 1].resolve();
      await tick();
      assert.equal(started.length, before + 1);
    }
    for (let index = size - 1; index >= 0; index--) gates[index].resolve();
    const outcomes = await execution;

    assert.ok(maximum <= 4);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : outcome.status),
      Array.from({ length: size }, (_, index) => `result-${index}`),
    );
  });
}

test("ordered pool starts stable priorities first, refills immediately, and returns input order", async () => {
  const items = [
    { name: "survey-first", priority: 1 },
    { name: "audit-first", priority: 3 },
    { name: "trace-first", priority: 2 },
    { name: "audit-second", priority: 3 },
    { name: "survey-second", priority: 1 },
    { name: "trace-second", priority: 2 },
  ];
  const expectedStartOrder = [1, 3, 2, 5, 0, 4];
  const gates = items.map(() => deferred());
  const started = [];
  let active = 0;
  let maximum = 0;
  const execution = runOrderedPool(
    items,
    async (item, index) => {
      started.push(index);
      active++;
      maximum = Math.max(maximum, active);
      await gates[index].promise;
      active--;
      return `result-${item.name}`;
    },
    { concurrency: 2, priority: (item) => item.priority },
  );

  await tick();
  assert.deepEqual(started, expectedStartOrder.slice(0, 2));
  for (let index = 0; index < expectedStartOrder.length - 2; index++) {
    gates[expectedStartOrder[index]].resolve();
    await tick();
    assert.deepEqual(started, expectedStartOrder.slice(0, index + 3));
  }
  for (const index of expectedStartOrder.slice(-2)) gates[index].resolve();
  const outcomes = await execution;

  assert.equal(maximum, 2);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : outcome.status),
    items.map((item) => `result-${item.name}`),
  );
});

test("ordered pool isolates rejection and emits immutable snapshots", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const snapshots = [];
  const execution = runOrderedPool(
    ["a", "b", "c"],
    async (_item, index) => {
      await gates[index].promise;
      if (index === 1) throw new Error("isolated failure");
      return index;
    },
    { concurrency: 2, onUpdate: (snapshot) => snapshots.push(snapshot) },
  );
  await tick();
  const captured = snapshots.at(-1);
  assert.deepEqual(captured.items.map((item) => item.phase), ["running", "running", "queued"]);
  gates[1].resolve();
  await tick();
  assert.deepEqual(captured.items.map((item) => item.phase), ["running", "running", "queued"]);
  gates[0].resolve();
  gates[2].resolve();
  const outcomes = await execution;
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.match(outcomes[1].reason.message, /isolated failure/);
  assert.equal(outcomes[2].status, "fulfilled");
});

test("abort prevents queued work from starting", async () => {
  const controller = new AbortController();
  const gates = Array.from({ length: 6 }, deferred);
  const started = [];
  const execution = runOrderedPool(
    [0, 1, 2, 3, 4, 5],
    async (item) => {
      started.push(item);
      await gates[item].promise;
      return item;
    },
    { concurrency: 2, signal: controller.signal },
  );
  await tick();
  assert.deepEqual(started, [0, 1]);
  controller.abort();
  gates[0].resolve();
  gates[1].resolve();
  const outcomes = await execution;
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(outcomes.slice(2).map((outcome) => outcome.status), ["aborted", "aborted", "aborted", "aborted"]);
});

test("ordered pool rejects invalid concurrency", async () => {
  await assert.rejects(() => runOrderedPool([], async () => undefined, { concurrency: 0 }), /positive integer/);
});
