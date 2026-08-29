import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentCheckpoint,
  checkpointFromBranch,
  continuationAllowed,
  latestPersistedCheckpointRevision,
  redactContinuityText,
  renderContinuitySnapshot,
} from "../extensions/continuity-state.ts";
import { DEFAULT_CONTINUITY_CONFIG, parseContinuityConfig } from "../extensions/continuity-types.ts";

const user = (id, text, parentId = null) => ({
  type: "message", id, parentId, timestamp: "2026-01-01T00:00:00Z",
  message: { role: "user", content: text, timestamp: 1 },
});
const assistantCall = (id, parentId, toolCallId, name, args) => ({
  type: "message", id, parentId, timestamp: "2026-01-01T00:00:01Z",
  message: {
    role: "assistant", api: "test", provider: "test", model: "test", stopReason: "toolUse", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: "toolCall", id: toolCallId, name, arguments: args }],
  },
});
const result = (id, parentId, toolCallId, toolName, text, isError = false) => ({
  type: "message", id, parentId, timestamp: "2026-01-01T00:00:02Z",
  message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 3 },
});

test("deterministic state gives tool results execution authority", () => {
  const entries = [
    user("u1", "Implement parser; done when tests and typecheck pass"),
    assistantCall("a1", "u1", "c1", "edit", { path: "src/parser.ts", edits: [] }),
    result("t1", "a1", "c1", "edit", "updated"),
    assistantCall("a2", "t1", "c2", "bash", { command: "npm test" }),
    result("t2", "a2", "c2", "bash", "10 passed"),
    assistantCall("a3", "t2", "c3", "bash", { command: "npm run typecheck" }),
    result("t3", "a3", "c3", "bash", "ok", true),
  ];
  const checkpoint = checkpointFromBranch(entries);
  assert.equal(checkpoint.goal, "Implement parser; done when tests and typecheck pass");
  assert.deepEqual(checkpoint.files.map(({ path, action }) => ({ path, action })), [{ path: "src/parser.ts", action: "modified" }]);
  assert.deepEqual(checkpoint.checks.map(({ category, status }) => ({ category, status })), [
    { category: "test", status: "passed" },
    { category: "typecheck", status: "failed" },
  ]);
  assert.equal(checkpoint.status, "blocked");
  assert.equal(continuationAllowed(checkpoint), false);
});

test("agent checkpoint cannot claim done with pending work or unknown checks", () => {
  const current = checkpointFromBranch([user("u1", "Implement parser")]);
  const next = applyAgentCheckpoint(current, {
    status: "done",
    nextActions: ["run tests"],
    doneWhen: ["tests pass"],
  }, "a1");
  assert.equal(next.status, "working");
  assert.deepEqual(next.nextActions, ["run tests"]);
});

test("new task epoch keeps durable preferences and drops old operational state", () => {
  const current = applyAgentCheckpoint(checkpointFromBranch([user("u1", "First task")]), {
    status: "done",
    preferences: ["Use pnpm"],
    environment: ["Windows CI"],
    decisions: ["Old decision"],
  }, "a1");
  const entries = [
    { type: "custom", id: "s1", parentId: "a1", timestamp: "2026-01-01T00:00:03Z", customType: "pi-config/continuity-checkpoint", data: current },
    user("u2", "Now implement the second task", "s1"),
  ];
  const next = checkpointFromBranch(entries);
  assert.match(next.goal, /second task/);
  assert.deepEqual(next.preferences, ["Use pnpm"]);
  assert.deepEqual(next.environment, ["Windows CI"]);
  assert.deepEqual(next.decisions, []);
});

test("automatic extraction retains explicit next steps for guarded continuation", () => {
  const entries = [
    user("u1", "Implement parser"),
    {
      type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant", api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 2,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: "text", text: "Next steps:\n1. Add fragmented header test\n2. Run npm test" }],
      },
    },
  ];
  const checkpoint = checkpointFromBranch(entries);
  assert.deepEqual(checkpoint.nextActions, ["Add fragmented header test", "Run npm test"]);
  assert.equal(continuationAllowed(checkpoint), true);
});

test("persisted checkpoint revision is distinct from later derived state", () => {
  const saved = applyAgentCheckpoint(checkpointFromBranch([user("u1", "Task")]), {
    nextActions: ["run tests"],
  }, "a1");
  const entries = [
    user("u1", "Task"),
    { type: "custom", id: "s1", parentId: "u1", timestamp: "2026-01-01T00:00:03Z", customType: "pi-config/continuity-checkpoint", data: saved },
    user("u2", "Also update docs", "s1"),
  ];
  assert.equal(latestPersistedCheckpointRevision(entries), saved.revision);
  assert.notEqual(checkpointFromBranch(entries).revision, saved.revision);
});

test("snapshot is bounded and secret redaction covers common credentials", () => {
  const checkpoint = applyAgentCheckpoint(checkpointFromBranch([user("u1", "Task")]), {
    nextActions: Array.from({ length: 20 }, (_, index) => `long action ${index} ${"x".repeat(100)}`),
  }, "a1");
  assert.ok(renderContinuitySnapshot(checkpoint, 900).length <= 900);
  assert.equal(redactContinuityText("api_key=secret-value and sk-abcdefghijklmnopqrstuvwxyz"), "[REDACTED] and [REDACTED]");
});

test("configuration is deep, bounded, and defaults to automatic operation", () => {
  const config = parseContinuityConfig({
    compaction: { ratio: 9, minTokens: 1 },
    continuation: { maxPerUserTurn: 999 },
    retrieval: { maxHits: 0 },
  });
  assert.equal(config.compaction.ratio, 0.9);
  assert.equal(config.compaction.minTokens, 16_000);
  assert.equal(config.continuation.maxPerUserTurn, 24);
  assert.equal(config.retrieval.maxHits, 1);
  assert.equal(DEFAULT_CONTINUITY_CONFIG.continuation.afterSessionResume, true);
});
