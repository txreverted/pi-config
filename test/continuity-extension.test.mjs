import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(predicate(), true, "condition was not met before timeout");
}

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

function runtimeHarness(initialEntries, options = {}) {
  const entries = [...initialEntries];
  const sent = [];
  const appended = [];
  const archive = {
    async open() {}, close() {}, index() {},
    health() { return { sqlite: true, fallbackEntries: 0 }; },
    search() { return []; }, touched() { return []; },
    async readBlob() { return undefined; },
    ...options.archive,
  };
  const runtime = new ContinuityRuntime(archive);
  const pi = {
    getAllTools: () => options.tools ?? [], getCommands: () => options.commands ?? [],
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
    cwd: options.cwd ?? "/tmp/continuity-test",
    hasUI: false,
    isProjectTrusted: () => options.trusted ?? false,
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
  return { runtime, pi, ctx, entries, sent, appended, archive };
}

test("continuity clears old footer status without publishing a replacement", async () => {
  const harness = runtimeHarness([]);
  const statuses = [];
  harness.ctx.hasUI = true;
  harness.ctx.ui = {
    setStatus(key, value) { statuses.push({ key, value }); },
    notify() {},
  };

  await harness.runtime.start(harness.pi, harness.ctx, "new");
  harness.runtime.onTurnEnd(harness.ctx);
  harness.runtime.stop(harness.ctx);

  assert.deepEqual(statuses, [
    { key: "continuity", value: undefined },
    { key: "continuity", value: undefined },
  ]);
});

test("session resume restarts explicit unfinished work", async () => {
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
  await harness.runtime.start(harness.pi, harness.ctx, "resume");
  await waitFor(() => harness.sent.length === 1);
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].message.content, /reason=session-resume/);
  harness.runtime.stop();
});

test("trusted project config overrides global automatic continuation controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-config-"));
  const agentDir = join(root, "agent");
  const project = join(root, "project");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    await mkdir(join(project, ".pi"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "continuity.json"), JSON.stringify({
      continuation: { afterSessionResume: false, maxPerUserTurn: 2 },
      retrieval: { maxHits: 2 },
    }));
    await writeFile(join(project, ".pi", "continuity.json"), JSON.stringify({
      continuation: { afterIdleUnfinished: false },
    }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const harness = runtimeHarness([], { cwd: project, trusted: true });
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    assert.equal(harness.runtime.currentConfig.continuation.afterSessionResume, false);
    assert.equal(harness.runtime.currentConfig.continuation.afterIdleUnfinished, false);
    assert.equal(harness.runtime.currentConfig.continuation.maxPerUserTurn, 2);
    assert.equal(harness.runtime.currentConfig.retrieval.maxHits, 2);
    harness.runtime.stop();
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("known compaction tools keep continuity in support mode", async () => {
  const harness = runtimeHarness([], { tools: [{ name: "smart_compact" }] });
  await harness.runtime.start(harness.pi, harness.ctx, "new");
  assert.match(harness.runtime.command("doctor", harness.pi, harness.ctx), /compaction_owner=support/);
  harness.runtime.stop();
});

test("recall modes enforce branch scope and return source-addressed evidence", async () => {
  const searchCalls = [];
  const harness = runtimeHarness([
    {
      type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "Implement parser", timestamp: 1 },
    },
    {
      type: "message", id: "other", parentId: null, timestamp: "2026-01-01T00:00:01Z",
      message: { role: "user", content: "Abandoned branch", timestamp: 2 },
    },
  ], { archive: {
    search(sessionId, query, ids, limit) {
      searchCalls.push({ sessionId, query, ids: [...ids], limit });
      return [{
        sessionId, entryId: "u1", parentId: null, ordinal: 0,
        timestamp: "2026-01-01T00:00:00Z", role: "user", isError: false,
        text: "Implement parser", filePaths: ["src/parser.ts"], score: 1,
      }];
    },
    touched(_sessionId, ids) { return ids.has("u1") ? ["src/parser.ts"] : []; },
    async readBlob(id, sessionId) {
      return id === "blob-1" ? {
        text: "compiler output",
        record: { id, sessionId, toolCallId: "c1", path: "/tmp/blob", bytes: 15, sha256: "abc" },
      } : undefined;
    },
  } });
  harness.ctx.sessionManager.getBranch = () => [harness.entries[0]];
  await harness.runtime.start(harness.pi, harness.ctx, "new");

  assert.match(await harness.runtime.recall({ mode: "state" }, harness.ctx), /goal=Implement parser/);
  assert.match(await harness.runtime.recall({ mode: "entry", id: "u1" }, harness.ctx), /\[entry:u1\]/);
  await assert.rejects(() => harness.runtime.recall({ mode: "entry", id: "other" }, harness.ctx), /not found/);
  assert.match(await harness.runtime.recall({ mode: "entry", id: "other", scope: "session" }, harness.ctx), /Abandoned branch/);
  assert.match(await harness.runtime.recall({ mode: "around", id: "u1" }, harness.ctx), /type:message/);
  assert.equal(await harness.runtime.recall({ mode: "files" }, harness.ctx), "src/parser.ts");
  assert.equal(await harness.runtime.recall({ mode: "touched" }, harness.ctx), "src/parser.ts");
  assert.match(await harness.runtime.recall({ mode: "search", query: "parser", limit: 3 }, harness.ctx), /role:user/);
  assert.deepEqual(searchCalls[0], { sessionId: "session-1", query: "parser", ids: ["u1"], limit: 3 });
  assert.match(await harness.runtime.recall({ mode: "blob", id: "blob-1" }, harness.ctx), /compiler output/);
  harness.runtime.stop();
});

test("settled work recovers from transient tool errors and resumes only once without state change", async () => {
  const harness = runtimeHarness([
    {
      type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "Implement parser", timestamp: 1 },
    },
    {
      type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant", api: "test", provider: "test", model: "test", stopReason: "toolUse", timestamp: 2,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: "toolCall", id: "c1", name: "continuity_checkpoint", arguments: { extra: true } }],
      },
    },
    {
      type: "message", id: "t1", parentId: "a1", timestamp: "2026-01-01T00:00:02Z",
      message: { role: "toolResult", toolCallId: "c1", toolName: "continuity_checkpoint", content: [{ type: "text", text: "validation failed" }], isError: true, timestamp: 3 },
    },
    {
      type: "message", id: "a2", parentId: "t1", timestamp: "2026-01-01T00:00:03Z",
      message: {
        role: "assistant", api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 4,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: "text", text: "Next: correct the checkpoint input" }],
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
