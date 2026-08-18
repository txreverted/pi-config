import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextPacket,
  mapConcurrent,
  normalizeAgentWave,
  resolveInside,
  SUBAGENT_LIMITS,
} from "../extensions/subagents/core.ts";
import {
  restoreCoordinatedTodoSnapshot,
  unresolvedAgentPatches,
} from "../extensions/coordination-core.ts";
import { applyTodoAction, emptyTodoSnapshot } from "../extensions/todo-core.ts";

const addTodo = (snapshot, subject, blockedBy = []) => applyTodoAction(snapshot, { action: "create", subject, blockedBy }).snapshot;
const baseTask = (id, role = "explorer") => ({
  id,
  role,
  title: `Task ${id}`,
  objective: `Do ${id}`,
  acceptanceCriteria: ["Return evidence"],
  ...(role === "worker" ? { writeScope: [`src/${id}/**`] } : {}),
});

test("agent waves require independent bounded tasks and ready todos", () => {
  let todos = addTodo(emptyTodoSnapshot(), "First");
  todos = addTodo(todos, "Second");
  const wave = normalizeAgentWave({
    title: "Parallel work",
    tasks: [
      { ...baseTask("one", "worker"), todoId: 1 },
      { ...baseTask("two", "reviewer"), todoId: 2 },
    ],
  }, todos);
  assert.equal(wave.maxConcurrency, 3);
  assert.deepEqual(wave.tasks.map((task) => task.todoId), [1, 2]);

  assert.throws(() => normalizeAgentWave({ title: "One", tasks: [baseTask("one")] }, todos), /requires 2-6/);
  assert.throws(() => normalizeAgentWave({
    title: "Overlap",
    tasks: [
      { ...baseTask("one", "worker"), writeScope: ["src/**"] },
      { ...baseTask("two", "worker"), writeScope: ["src/auth/**"] },
    ],
  }, todos), /overlap/);
  assert.throws(() => normalizeAgentWave({
    title: "Duplicate todo",
    tasks: [{ ...baseTask("one"), todoId: 1 }, { ...baseTask("two"), todoId: 1 }],
  }, todos), /more than one/);
});

test("dependent todos cannot share a wave", () => {
  let todos = addTodo(emptyTodoSnapshot(), "First");
  todos = addTodo(todos, "Second", [1]);
  assert.throws(() => normalizeAgentWave({
    title: "Blocked",
    tasks: [{ ...baseTask("one"), todoId: 1 }, { ...baseTask("two"), todoId: 2 }],
  }, todos), /blocked|Dependent/);
});

test("context packets are bounded and contain task ownership", () => {
  const task = {
    ...baseTask("worker", "worker"),
    context: "x".repeat(SUBAGENT_LIMITS.contextChars),
    contextFiles: ["src/a.ts"],
    writeScope: ["src/**"],
  };
  const packet = buildContextPacket({ overallGoal: "Ship it", task, ponytailMode: "full" });
  assert.ok(Buffer.byteLength(packet) <= SUBAGENT_LIMITS.contextPacketBytes);
  assert.match(packet, /WRITE SCOPE/);
  assert.match(packet, /agent_result/);
});

test("bounded concurrency preserves declaration order", async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapConcurrent([30, 5, 10, 1], 2, async (delay, index) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active--;
    return index;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results, [0, 1, 2, 3]);
});

test("workspace path resolution rejects escapes", () => {
  assert.match(resolveInside("/workspace", "src/a.ts"), /workspace/);
  assert.throws(() => resolveInside("/workspace", "../secret"), /inside/);
});

test("coordination restores todo snapshots and tracks unresolved patches", () => {
  const todoSnapshot = addTodo(emptyTodoSnapshot(), "Task");
  const entries = [
    { type: "message", message: { role: "toolResult", toolName: "todo", details: { snapshot: todoSnapshot } } },
    { type: "message", message: { role: "toolResult", toolName: "parallel_agents", details: {
      runId: "run", todoSnapshot, results: [{ id: "worker", role: "worker", patchState: "ready" }],
    } } },
  ];
  assert.equal(restoreCoordinatedTodoSnapshot(entries).tasks[0].subject, "Task");
  assert.deepEqual(unresolvedAgentPatches(entries), [{ runId: "run", taskId: "worker" }]);
  entries.push({ type: "message", message: { role: "toolResult", toolName: "agent_patch", details: {
    runId: "run", taskId: "worker", patchState: "applied", todoSnapshot,
  } } });
  assert.deepEqual(unresolvedAgentPatches(entries), []);
});
