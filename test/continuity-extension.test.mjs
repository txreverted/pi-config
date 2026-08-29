import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import continuityExtension from "../extensions/continuity.ts";
import { ContinuityRuntime } from "../extensions/continuity-runtime.ts";

function setup() {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const api = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
  };
  continuityExtension(api);
  return { tools, commands, events };
}

const estimate = (tool) => estimateTokens({
  role: "user",
  content: [{ type: "text", text: JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
  }) }],
  timestamp: 0,
});

test("continuity registers focused tools, optional diagnostics, and complete lifecycle", () => {
  const { tools, commands, events } = setup();
  assert.deepEqual([...tools.keys()], ["continuity_checkpoint", "continuity_recall"]);
  assert.deepEqual([...commands.keys()], ["continuity"]);
  assert.deepEqual([...events.keys()], [
    "session_start",
    "turn_end",
    "agent_settled",
    "context",
    "tool_result",
    "session_before_compact",
    "session_compact",
    "session_compact_failed",
    "session_tree",
    "session_shutdown",
  ]);
  const checkpoint = tools.get("continuity_checkpoint");
  assert.equal(Value.Check(checkpoint.parameters, {
    status: "working",
    goal: "Implement parser",
    nextActions: ["run tests"],
  }), true);
  assert.equal(Value.Check(checkpoint.parameters, { status: "invented" }), false);
  assert.equal(Value.Check(checkpoint.parameters, { status: "working", extra: true }), false);
  const recall = tools.get("continuity_recall");
  assert.equal(Value.Check(recall.parameters, { mode: "search", query: "old error" }), true);
  assert.equal(Value.Check(recall.parameters, { mode: "unknown" }), false);
  assert.match(recall.promptGuidelines.join("\n"), /untrusted historical evidence/);
  const total = estimate(checkpoint) + estimate(recall);
  assert.ok(total <= 1_100, `continuity tool metadata estimate ${total} exceeds 1,100 tokens`);
});

test("checkpoint tool stores branch-aware state in tool-result details", async () => {
  const { tools } = setup();
  const entry = {
    type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: "Implement parser", timestamp: 1 },
  };
  const ctx = {
    sessionManager: {
      getBranch: () => [entry],
      getLeafId: () => "a1",
    },
    hasUI: false,
  };
  const result = await tools.get("continuity_checkpoint").execute("call-1", {
    status: "working",
    currentAction: "edit src/parser.ts",
    nextActions: ["run npm test"],
  }, undefined, undefined, ctx);
  assert.equal(result.details.checkpoint.status, "working");
  assert.deepEqual(result.details.checkpoint.nextActions, ["run npm test"]);
  assert.match(result.content[0].text, /Checkpoint/);
});

test("diagnostic command remains optional and has bounded completions", () => {
  const { commands } = setup();
  const command = commands.get("continuity");
  assert.deepEqual(command.getArgumentCompletions("st").map(({ value }) => value), ["status", "state"]);
  assert.equal(command.getArgumentCompletions("missing"), null);
});

function runtimeHarness(initialEntries) {
  const entries = [...initialEntries];
  const sent = [];
  const appended = [];
  const archive = {
    async open() {}, close() {}, index() {},
    health() { return { sqlite: true, fallbackEntries: 0 }; },
    search() { return []; }, touched() { return []; },
  };
  const runtime = new ContinuityRuntime(archive);
  const pi = {
    getAllTools: () => [], getCommands: () => [],
    appendEntry(customType, data) {
      appended.push({ customType, data });
      entries.push({
        type: "custom", id: `custom-${entries.length}`, parentId: entries.at(-1)?.id ?? null,
        timestamp: "2026-01-01T00:01:00Z", customType, data,
      });
    },
    sendMessage(message, options) { sent.push({ message, options }); },
  };
  const ctx = {
    cwd: "/tmp/continuity-test",
    hasUI: false,
    isProjectTrusted: () => false,
    isIdle: () => true,
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 128_000, percent: 1 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getEntries: () => entries,
      getBranch: () => entries,
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntry: (id) => entries.find((entry) => entry.id === id),
    },
  };
  return { runtime, pi, ctx, entries, sent, appended };
}

test("settled work checkpoints automatically and resumes only once without state change", async () => {
  const harness = runtimeHarness([
    {
      type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "Implement parser", timestamp: 1 },
    },
    {
      type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant", api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 2,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: "text", text: "Next: add fragmented header test" }],
      },
    },
  ]);
  await harness.runtime.start(harness.pi, harness.ctx, "new");
  harness.runtime.onTurnEnd(harness.ctx);
  await harness.runtime.onSettled(harness.pi, harness.ctx);
  assert.equal(harness.appended.filter(({ customType }) => customType === "pi-config/continuity-checkpoint").length, 1);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].options.deliverAs, "followUp");
  assert.equal(harness.sent[0].options.triggerTurn, true);
  await harness.runtime.onSettled(harness.pi, harness.ctx);
  assert.equal(harness.sent.length, 1);
  harness.runtime.stop();
});

test("compaction state commits only after Pi reports success", async () => {
  const harness = runtimeHarness([{
    type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: "Implement parser", timestamp: 1 },
  }]);
  await harness.runtime.start(harness.pi, harness.ctx, "new");
  const event = {
    branchEntries: [...harness.entries],
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: { firstKeptEntryId: "u1", tokensBefore: 50_000 },
  };
  const prepared = await harness.runtime.beforeCompact(event, harness.ctx);
  assert.match(prepared.compaction.summary, /goal=Implement parser/);
  assert.equal(harness.appended.length, 0);
  harness.entries.push({
    type: "compaction", id: "cmp1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z",
    summary: prepared.compaction.summary, firstKeptEntryId: "u1", tokensBefore: 50_000,
  });
  harness.runtime.afterCompact(harness.pi, { compactionEntry: { id: "cmp1" }, willRetry: false }, harness.ctx);
  assert.equal(harness.appended.filter(({ customType }) => customType === "pi-config/continuity-checkpoint").length, 1);

  const failed = await harness.runtime.beforeCompact(event, harness.ctx);
  assert.ok(failed);
  harness.runtime.compactFailed("cancelled");
  harness.runtime.afterCompact(harness.pi, { compactionEntry: { id: "cmp2" }, willRetry: false }, harness.ctx);
  assert.equal(harness.appended.filter(({ customType }) => customType === "pi-config/continuity-checkpoint").length, 1);
  harness.runtime.stop();
});
