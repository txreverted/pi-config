import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { applyTaskAction } from "../extensions/task-core.ts";
import { TaskStore } from "../extensions/task-store.ts";

const main = { id: "main", main: true };

async function temporaryStore(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-shared-tasks-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new TaskStore(join(root, "list"));
}

test("task store serializes concurrent mutations and writes private state", async (t) => {
  const store = await temporaryStore(t);
  const create = (subject) => store.transact((snapshot) => {
    const change = applyTaskAction(snapshot, { action: "create", subject }, main);
    return { snapshot: change.snapshot, result: change.task.id };
  });
  const ids = await Promise.all([create("one"), create("two"), create("three")]);
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3]);
  const snapshot = await store.read();
  assert.equal(snapshot.tasks.length, 3);
  assert.equal((await stat(store.directory)).mode & 0o077, 0);
  assert.equal((await stat(store.file)).mode & 0o077, 0);
  assert.doesNotMatch(await readFile(store.file, "utf8"), /\.tmp/);
});

test("task store permits only one concurrent claim", async (t) => {
  const store = await temporaryStore(t);
  await store.transact((snapshot) => {
    const change = applyTaskAction(snapshot, { action: "create", subject: "one" }, main);
    return { snapshot: change.snapshot, result: undefined };
  });

  const claim = (owner) => store.transact((snapshot) => {
    const change = applyTaskAction(snapshot, { action: "claim", id: 1 }, { id: owner, main: false });
    return { snapshot: change.snapshot, result: change.task.owner };
  });
  const results = await Promise.allSettled([claim("one"), claim("two")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /pending|owned/);
});

test("task store fails closed on corruption and recovers only an unambiguous stale lock", async (t) => {
  const store = await temporaryStore(t);
  await mkdir(store.directory, { recursive: true });
  await writeFile(store.file, "not json", { mode: 0o600 });
  await assert.rejects(store.read(), /corrupt/);

  await writeFile(store.file, '{"tasks":[],"nextId":1}\n');
  await mkdir(store.lock);
  await writeFile(join(store.lock, "owner.json"), JSON.stringify({ host: hostname(), pid: 2_147_483_647, token: "dead" }));
  const old = new Date(Date.now() - 60_000);
  await utimes(store.lock, old, old);
  const second = new TaskStore(store.directory);
  await Promise.all([store, second].map((candidate, index) => candidate.transact((snapshot) => {
    const change = applyTaskAction(snapshot, { action: "create", subject: `recovered-${index}` }, main);
    return { snapshot: change.snapshot, result: undefined };
  })));
  assert.equal((await store.read()).tasks.length, 2);

  await mkdir(store.recoveryLock);
  await writeFile(join(store.recoveryLock, "owner.json"), JSON.stringify({ host: hostname(), pid: 2_147_483_647, token: "dead-recovery" }));
  await utimes(store.recoveryLock, old, old);
  await store.transact((snapshot) => ({ snapshot, result: undefined }));

  await mkdir(store.lock);
  await utimes(store.lock, old, old);
  await store.transact((snapshot) => ({ snapshot, result: undefined }));

  await mkdir(store.lock);
  await chmod(store.lock, 0o700);
  await assert.rejects(
    store.transact((snapshot) => ({ snapshot, result: undefined })),
    /locked/,
  );
});
