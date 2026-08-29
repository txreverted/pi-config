import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentCheckpoint,
  checkCategory,
  checkpointData,
  checkpointFromBranch,
  continuationAllowed,
  hasFreshAgentCheckpoint,
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
const assistantText = (id, parentId, text) => ({
  type: "message", id, parentId, timestamp: "2026-01-01T00:00:01Z",
  message: {
    role: "assistant", api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: "text", text }],
  },
});
const result = (id, parentId, toolCallId, toolName, text, isError = false) => ({
  type: "message", id, parentId, timestamp: "2026-01-01T00:00:02Z",
  message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 3 },
});

test("verification classification requires a known command at the shell entry point", () => {
  for (const [command, category] of [
    ["npm test", "test"],
    ["CI=1 npm run typecheck", "typecheck"],
    ["pnpm lint", "lint"],
    ["cargo check", "build"],
    ["git status && npm test", "other"],
    ["find test -type f", "other"],
    ["rg test test", "other"],
    ["wc -l test/*.mjs", "other"],
  ]) assert.equal(checkCategory(command), category, command);
});

test("deterministic state records verification evidence without turning failures into blockers", () => {
  const entries = [
    user("u1", "Implement parser; done when tests and typecheck pass"),
    assistantCall("a1", "u1", "c1", "edit", { path: "src/parser.ts", edits: [] }),
    result("t1", "a1", "c1", "edit", "updated"),
    assistantCall("a2", "t1", "c2", "bash", { command: "npm test" }),
    result("t2", "a2", "c2", "bash", "10 passed"),
    assistantCall("a3", "t2", "c3", "bash", { command: "npm run typecheck" }),
    result("t3", "a3", "c3", "bash", "type error", true),
  ];
  const checkpoint = checkpointFromBranch(entries);
  assert.equal(checkpoint.goal, "Implement parser; done when tests and typecheck pass");
  assert.deepEqual(checkpoint.files.map(({ path, action }) => ({ path, action })), [{ path: "src/parser.ts", action: "modified" }]);
  assert.deepEqual(checkpoint.checks.map(({ category, status }) => ({ category, status })), [
    { category: "test", status: "passed" },
    { category: "typecheck", status: "failed" },
  ]);
  assert.deepEqual(checkpoint.completed, ["npm test"]);
  assert.deepEqual(checkpoint.blockers, []);
  assert.equal(checkpoint.currentAction, "npm run typecheck");
  assert.equal(checkpoint.status, "working");
});

test("inspection commands and recoverable tool errors stay out of task state", () => {
  const entries = [
    user("u1", "Implement parser"),
    assistantCall("a1", "u1", "c1", "bash", { command: "git status && find test -type f" }),
    result("t1", "a1", "c1", "bash", "clean"),
    assistantCall("a2", "t1", "c2", "bash", { command: "rg test test" }),
    result("t2", "a2", "c2", "bash", "no matches", true),
    assistantCall("a3", "t2", "c3", "continuity_checkpoint", { extra: true }),
    result("t3", "a3", "c3", "continuity_checkpoint", "validation failed", true),
    assistantCall("a4", "t3", "c4", "edit", { path: "src/parser.ts", edits: [] }),
    result("t4", "a4", "c4", "edit", "edit failed", true),
  ];
  const checkpoint = checkpointFromBranch(entries);
  assert.deepEqual(checkpoint.checks, []);
  assert.deepEqual(checkpoint.completed, []);
  assert.deepEqual(checkpoint.blockers, []);
  assert.deepEqual(checkpoint.files, []);
  assert.equal(checkpoint.currentAction, undefined);
  assert.equal(checkpoint.status, "working");
});

test("persisted inspection noise is pruned while explicit blockers survive later tools", () => {
  const saved = applyAgentCheckpoint(checkpointFromBranch([user("u1", "Implement parser")]), {
    status: "blocked",
    currentAction: "find test -type f",
    blockers: ["Waiting for API access"],
    completed: ["Reviewed parser design", "find test -type f"],
  }, "a1");
  saved.checks = [{
    command: "find test -type f",
    category: "test",
    status: "passed",
    sourceEntryIds: ["a1"],
  }];
  const entries = [
    user("u1", "Implement parser"),
    { type: "custom", id: "s1", parentId: "u1", timestamp: "2026-01-01T00:00:03Z", customType: "pi-config/continuity-checkpoint", data: saved },
    assistantCall("a2", "s1", "c2", "edit", { path: "src/parser.ts", edits: [] }),
    result("t2", "a2", "c2", "edit", "updated"),
  ];
  const checkpoint = checkpointFromBranch(entries);
  assert.deepEqual(checkpoint.checks, []);
  assert.deepEqual(checkpoint.completed, ["Reviewed parser design"]);
  assert.deepEqual(checkpoint.blockers, ["Waiting for API access"]);
  assert.equal(checkpoint.currentAction, undefined);
  assert.equal(checkpoint.status, "blocked");
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

test("only a successful checkpoint result can set done", () => {
  const first = user("u1", "Implement parser");
  const done = applyAgentCheckpoint(checkpointFromBranch([first]), {
    status: "done",
    nextActions: [],
  }, "a1");
  const failed = result("t1", "a1", "c1", "continuity_checkpoint", "failed", true);
  failed.message.details = { checkpoint: done };
  const checkpoint = checkpointFromBranch([
    first,
    assistantCall("a1", "u1", "c1", "continuity_checkpoint", {}),
    failed,
  ]);
  assert.equal(checkpoint.status, "working");

  const saved = result("t2", "a1", "c1", "continuity_checkpoint", "saved");
  saved.message.details = { checkpoint: done };
  assert.equal(checkpointFromBranch([first, assistantCall("a1", "u1", "c1", "continuity_checkpoint", {}), saved]).status, "done");

  const legacyAutomatic = { ...done, origin: "automatic" };
  assert.equal(checkpointFromBranch([first, {
    type: "custom", id: "s1", parentId: "u1", timestamp: "2026-01-01T00:00:03Z",
    customType: "pi-config/continuity-checkpoint", data: legacyAutomatic,
  }]).status, "working");
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

test("assistant prose, including negated completion, does not set done", () => {
  for (const text of [
    "The task is complete and all requested work is done.",
    "The task is not complete.",
  ]) {
    const checkpoint = checkpointFromBranch([
      user("u1", "Implement parser"),
      assistantText("a1", "u1", text),
    ]);
    assert.equal(checkpoint.status, "working");
    assert.equal(checkpoint.currentAction, undefined);
  }
});

test("checkpoint data requires the complete schema and returns an isolated value", () => {
  const checkpoint = applyAgentCheckpoint(checkpointFromBranch([user("u1", "Task")]), {
    nextActions: ["run tests"],
  }, "a1");
  const validated = checkpointData(checkpoint);
  assert.deepEqual(validated, checkpoint);
  assert.notEqual(validated, checkpoint);
  assert.equal(checkpointData({ ...checkpoint, nextActions: undefined }), undefined);
  assert.equal(checkpointData({
    ...checkpoint,
    files: [{ path: "src/parser.ts", action: "invented", sourceEntryIds: ["t1"] }],
  }), undefined);
  assert.equal(checkpointData({ ...checkpoint, extra: true }), undefined);
});

test("fresh agent checkpoints must be successful and follow the latest user message", () => {
  const checkpoint = applyAgentCheckpoint(checkpointFromBranch([user("u1", "Task")]), {
    nextActions: ["run tests"],
  }, "a1");
  const checkpointResult = result("t1", "a1", "c1", "continuity_checkpoint", "saved");
  checkpointResult.message.details = { checkpoint };
  const branch = [
    user("u1", "Task"),
    assistantCall("a1", "u1", "c1", "continuity_checkpoint", {}),
    checkpointResult,
    assistantText("a2", "t1", "Continuing."),
  ];
  assert.equal(hasFreshAgentCheckpoint(branch, checkpoint.revision), true);
  assert.equal(hasFreshAgentCheckpoint([...branch, user("u2", "One more thing", "a2")], checkpoint.revision), false);
  const failed = result("t2", "a2", "c2", "continuity_checkpoint", "failed", true);
  failed.message.details = { checkpoint };
  assert.equal(hasFreshAgentCheckpoint([...branch, failed], checkpoint.revision), false);
  assert.equal(hasFreshAgentCheckpoint(branch, "different-revision"), false);

  const changed = [
    ...branch,
    assistantCall("a3", "a2", "c3", "edit", { path: "src/parser.ts", edits: [] }),
    result("t3", "a3", "c3", "edit", "updated"),
  ];
  assert.equal(hasFreshAgentCheckpoint(changed, checkpointFromBranch(changed).revision), false);
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

test("configuration is bounded and defaults persistence and continuation conservatively", () => {
  const config = parseContinuityConfig({
    compaction: { ratio: 9, minTokens: 1 },
    storage: { retentionDays: 9_999, maxTotalBytes: 1 },
    continuation: { maxPerUserTurn: 999 },
    retrieval: { maxHits: 0 },
  });
  assert.equal("compaction" in config, false);
  assert.equal("afterCompaction" in config.continuation, false);
  assert.equal(config.storage.retentionDays, 3_650);
  assert.equal(config.storage.maxTotalBytes, 16 * 1024 * 1024);
  assert.equal(config.continuation.maxPerUserTurn, 24);
  assert.equal(config.retrieval.maxHits, 1);
  assert.deepEqual(DEFAULT_CONTINUITY_CONFIG.storage, {
    retentionDays: 30,
    maxTotalBytes: 256 * 1024 * 1024,
  });
  assert.equal(DEFAULT_CONTINUITY_CONFIG.blobs.enabled, false);
  assert.equal(DEFAULT_CONTINUITY_CONFIG.continuation.afterIdleUnfinished, false);
  assert.equal(DEFAULT_CONTINUITY_CONFIG.continuation.afterSessionResume, false);
});
