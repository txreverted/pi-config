import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import continuityExtension from "../extensions/continuity.ts";
import { ContinuityRuntime } from "../extensions/continuity-runtime.ts";
import { applyAgentCheckpoint, checkpointFromBranch } from "../extensions/continuity-state.ts";
import { DEFAULT_CONTINUITY_CONFIG } from "../extensions/continuity-types.ts";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(id, text, parentId = null) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: text, timestamp: 1 },
  };
}

function assistant(id, parentId, { text = "", stopReason = "stop", toolCall } = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01Z",
    message: {
      role: "assistant",
      api: "test",
      provider: "test",
      model: "test",
      stopReason,
      timestamp: 2,
      usage,
      content: toolCall
        ? [{ type: "toolCall", id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments ?? {} }]
        : [{ type: "text", text }],
    },
  };
}

function toolResult(id, parentId, toolCallId, toolName, text, options = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02Z",
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      details: options.details,
      isError: options.isError ?? false,
      timestamp: 3,
    },
  };
}

function explicitBranch() {
  const first = user("u1", "Implement parser");
  const checkpoint = applyAgentCheckpoint(checkpointFromBranch([first]), {
    status: "working",
    currentAction: "add fragmented header test",
    nextActions: ["run npm test"],
  }, "a1");
  return {
    checkpoint,
    entries: [
      first,
      assistant("a1", "u1", {
        stopReason: "toolUse",
        toolCall: { id: "checkpoint-1", name: "continuity_checkpoint" },
      }),
      toolResult("t1", "a1", "checkpoint-1", "continuity_checkpoint", "saved", {
        details: { checkpoint },
      }),
      assistant("a2", "t1", { text: "Checkpoint recorded." }),
    ],
  };
}

function staleExplicitBranch() {
  const { entries } = explicitBranch();
  return [
    ...entries,
    user("u2", "Stop here. Do not continue.", "a2"),
    assistant("a3", "u2", { text: "Acknowledged." }),
  ];
}

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
  content: [{
    type: "text",
    text: JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
    }),
  }],
  timestamp: 0,
});

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true, "condition was not met before timeout");
}

async function withGlobalConfig(value, run) {
  const root = await mkdtemp(join(tmpdir(), "continuity-config-"));
  const agentDir = join(root, "agent");
  const previous = process.env.PI_CODING_AGENT_DIR;
  await mkdir(agentDir, { recursive: true });
  if (value !== undefined) {
    await writeFile(
      join(agentDir, "continuity.json"),
      typeof value === "string" ? value : JSON.stringify(value),
      "utf8",
    );
  }
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await run({ root, agentDir });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function runtimeHarness(initialEntries, options = {}) {
  const entries = [...initialEntries];
  const sent = [];
  const appended = [];
  const archiveCalls = {
    open: 0,
    close: 0,
    index: [],
    maintain: [],
    purge: 0,
    spool: [],
    search: [],
    readBlob: [],
  };
  const archiveOverrides = options.archive ?? {};
  const archive = {
    async open() {
      archiveCalls.open++;
      await archiveOverrides.open?.();
    },
    close() {
      archiveCalls.close++;
      archiveOverrides.close?.();
    },
    index(batch) {
      archiveCalls.index.push(batch.map((entry) => structuredClone(entry)));
      archiveOverrides.index?.(batch);
    },
    async maintain(storage) {
      archiveCalls.maintain.push(structuredClone(storage));
      return archiveOverrides.maintain
        ? await archiveOverrides.maintain(storage)
        : { removedEntries: 0, removedBlobs: 0, bytes: 0 };
    },
    async purgeAll() {
      archiveCalls.purge++;
      await archiveOverrides.purgeAll?.();
    },
    async spoolBlob(input) {
      archiveCalls.spool.push(structuredClone(input));
      return archiveOverrides.spoolBlob ? await archiveOverrides.spoolBlob(input) : undefined;
    },
    health() {
      return archiveOverrides.health?.() ?? { sqlite: true, fallbackEntries: 0 };
    },
    search(sessionId, query, ids, limit) {
      archiveCalls.search.push({ sessionId, query, ids: [...ids], limit });
      return archiveOverrides.search?.(sessionId, query, ids, limit) ?? [];
    },
    touched(sessionId, ids) {
      return archiveOverrides.touched?.(sessionId, ids) ?? [];
    },
    async readBlob(id, sessionId) {
      archiveCalls.readBlob.push({ id, sessionId });
      return archiveOverrides.readBlob ? await archiveOverrides.readBlob(id, sessionId) : undefined;
    },
  };
  const runtime = new ContinuityRuntime(archive);
  let customId = 0;
  const pi = {
    getAllTools: () => options.tools ?? [],
    getCommands: () => options.commands ?? [],
    appendEntry(customType, data) {
      const appendedEntry = {
        type: "custom",
        id: `custom-${++customId}`,
        parentId: entries.at(-1)?.id ?? null,
        timestamp: "2026-01-01T00:01:00Z",
        customType,
        data,
      };
      appended.push({ customType, data });
      entries.push(appendedEntry);
    },
    sendMessage(message, sendOptions) {
      sent.push({ message, options: sendOptions });
    },
  };
  const branch = () => options.branch?.(entries) ?? entries;
  const ctx = {
    cwd: options.cwd ?? "/tmp/continuity-test",
    hasUI: options.hasUI ?? false,
    ui: options.ui,
    isProjectTrusted: () => options.trusted ?? false,
    isIdle: () => options.idle ?? true,
    hasPendingMessages: () => options.pending ?? false,
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 128_000, percent: 1 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getEntries: () => entries,
      getBranch: () => branch(),
      getLeafId: () => branch().at(-1)?.id ?? null,
      getEntry: (id) => entries.find((entry) => entry.id === id),
    },
  };
  return { runtime, pi, ctx, entries, sent, appended, archive, archiveCalls };
}

test("continuity registers focused tools without compaction hooks", () => {
  const { tools, commands, events } = setup();
  assert.deepEqual([...tools.keys()], ["continuity_checkpoint", "continuity_recall"]);
  assert.deepEqual([...commands.keys()], ["continuity"]);
  assert.deepEqual([...events.keys()], [
    "session_start",
    "turn_end",
    "agent_settled",
    "context",
    "tool_result",
    "session_tree",
    "session_shutdown",
  ]);
  assert.equal([...events.keys()].some((name) => name.includes("compact")), false);

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
  assert.ok(estimate(checkpoint) + estimate(recall) <= 1_100);

  const command = commands.get("continuity");
  assert.deepEqual(command.getArgumentCompletions("p").map(({ value }) => value), ["pause", "purge"]);
  assert.equal(command.getArgumentCompletions("missing"), null);
  const runtime = new ContinuityRuntime({});
  assert.equal(runtime.beforeCompact, undefined);
  assert.equal(runtime.afterCompact, undefined);
  assert.equal(runtime.compactFailed, undefined);
});

test("checkpoint tool returns complete branch-aware state in result details", async () => {
  const { tools } = setup();
  const entry = user("u1", "Implement parser");
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

test("recall truncation exposes a protected complete-output path", async () => {
  await withGlobalConfig(undefined, async () => {
    const { tools, events } = setup();
    const entries = [user("u1", `Inspect this output: ${"x".repeat(70_000)}`)];
    const ctx = {
      hasUI: false,
      isIdle: () => true,
      hasPendingMessages: () => false,
      sessionManager: {
        getSessionId: () => "bounded-session",
        getEntries: () => entries,
        getBranch: () => entries,
        getLeafId: () => "u1",
        getEntry: (id) => entries.find((entry) => entry.id === id),
      },
    };
    await events.get("session_start")({ reason: "new" }, ctx);
    let fullOutputPath;
    try {
      const result = await tools.get("continuity_recall").execute(
        "recall-1",
        { mode: "entry", id: "u1" },
        undefined,
        undefined,
        ctx,
      );
      fullOutputPath = result.details.fullOutputPath;
      assert.equal(result.details.truncation.truncated, true);
      assert.match(result.content[0].text, /Full output saved to:/);
      assert.match(await readFile(fullOutputPath, "utf8"), /x{1000}/);
      if (process.platform !== "win32") {
        assert.equal((await stat(dirname(fullOutputPath))).mode & 0o777, 0o700);
        assert.equal((await stat(fullOutputPath)).mode & 0o777, 0o600);
      }
    } finally {
      events.get("session_shutdown")({}, ctx);
      if (fullOutputPath) await rm(dirname(fullOutputPath), { recursive: true, force: true });
    }
  });
});

test("only the global config is read and malformed JSON falls back safely", async () => {
  await withGlobalConfig({
    retrieval: { maxHits: 2 },
    continuation: { maxPerUserTurn: 2 },
  }, async ({ root, agentDir }) => {
    const project = join(root, "project");
    await mkdir(join(project, ".pi"), { recursive: true });
    await writeFile(join(project, ".pi", "continuity.json"), JSON.stringify({
      enabled: false,
      retrieval: { maxHits: 9 },
    }), "utf8");

    const harness = runtimeHarness([], { cwd: project, trusted: true });
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    assert.equal(harness.runtime.currentConfig.enabled, true);
    assert.equal(harness.runtime.currentConfig.retrieval.maxHits, 2);
    assert.equal(harness.runtime.currentConfig.continuation.maxPerUserTurn, 2);
    assert.match(await harness.runtime.command("doctor", harness.pi, harness.ctx), /config=global/);
    harness.runtime.stop();

    await writeFile(join(agentDir, "continuity.json"), "{ malformed", "utf8");
    const malformed = runtimeHarness([]);
    await malformed.runtime.start(malformed.pi, malformed.ctx, "new");
    assert.deepEqual(malformed.runtime.currentConfig, DEFAULT_CONTINUITY_CONFIG);
    assert.match(await malformed.runtime.command("doctor", malformed.pi, malformed.ctx), /last_error=(?!none)/);
    malformed.runtime.stop();
  });
});

test("disabled continuity performs no persistence or automatic recovery", async () => {
  await withGlobalConfig({ enabled: false, blobs: { enabled: true } }, async () => {
    const harness = runtimeHarness([user("u1", "Implement parser")]);
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    harness.entries.push(assistant("a1", "u1", { text: "Next: run tests" }));
    await harness.runtime.onTurnEnd(harness.ctx);
    await harness.runtime.onTree(harness.ctx);
    await harness.runtime.onSettled(harness.pi, harness.ctx);
    const toolEvent = {
      toolName: "bash",
      toolCallId: "c1",
      content: [{ type: "text", text: "output" }],
      details: { fullOutputPath: "/tmp/output.log" },
      isError: false,
    };
    assert.equal(await harness.runtime.onToolResult(toolEvent), undefined);
    assert.equal(harness.runtime.buildContext([], harness.ctx), undefined);
    assert.throws(
      () => harness.runtime.checkpointFromAgent({ status: "working" }, harness.ctx),
      /disabled/,
    );
    assert.equal(await harness.runtime.command("pause", harness.pi, harness.ctx), "Continuity is disabled.");
    assert.equal(harness.archiveCalls.open, 0);
    assert.deepEqual(harness.archiveCalls.index, []);
    assert.deepEqual(harness.archiveCalls.maintain, []);
    assert.deepEqual(harness.archiveCalls.spool, []);
    assert.deepEqual(harness.appended, []);
    assert.deepEqual(harness.sent, []);
  });
});

test("pause and tree changes neither write nor backfill paused history", async () => {
  await withGlobalConfig({ blobs: { enabled: true } }, async () => {
    const harness = runtimeHarness([user("u1", "Implement parser")]);
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    harness.archiveCalls.index.length = 0;
    harness.archiveCalls.maintain.length = 0;

    assert.match(await harness.runtime.command("pause", harness.pi, harness.ctx), /paused/);
    harness.entries.push(user("u2", "Private paused note", harness.entries.at(-1).id));
    await harness.runtime.onTurnEnd(harness.ctx);
    await harness.runtime.onTree(harness.ctx);
    await harness.runtime.onSettled(harness.pi, harness.ctx);
    assert.equal(harness.runtime.buildContext([], harness.ctx), undefined);
    assert.equal(await harness.runtime.onToolResult({
      toolName: "bash",
      toolCallId: "paused-call",
      content: [{ type: "text", text: "output" }],
      details: { fullOutputPath: "/tmp/output.log" },
      isError: false,
    }), undefined);
    assert.throws(
      () => harness.runtime.checkpointFromAgent({ status: "working" }, harness.ctx),
      /paused/,
    );
    assert.deepEqual(harness.archiveCalls.index, []);
    assert.deepEqual(harness.archiveCalls.maintain, []);
    assert.deepEqual(harness.archiveCalls.spool, []);
    assert.equal(harness.appended.length, 1);

    assert.match(await harness.runtime.command("resume", harness.pi, harness.ctx), /not indexed/);
    harness.entries.push(user("u3", "Resume work", harness.entries.at(-1).id));
    await harness.runtime.onTurnEnd(harness.ctx);
    const indexedIds = harness.archiveCalls.index.flat().map((entry) => entry.entryId);
    assert.equal(indexedIds.includes("u2"), false);
    assert.equal(indexedIds.includes("u3"), true);
    harness.runtime.stop();
  });
});

test("paused descendants remain excluded after a runtime restart", async () => {
  await withGlobalConfig(undefined, async () => {
    const entries = [
      user("u1", "Implement parser"),
      {
        type: "custom", id: "pause-1", parentId: "u1", timestamp: "2026-01-01T00:00:01Z",
        customType: "pi-config/continuity-policy", data: "paused",
      },
      user("paused-1", "Never index this paused entry", "pause-1"),
      {
        type: "custom", id: "resume-1", parentId: "paused-1", timestamp: "2026-01-01T00:00:03Z",
        customType: "pi-config/continuity-policy", data: "active",
      },
      user("active-1", "Index work after resume", "resume-1"),
    ];
    const harness = runtimeHarness(entries);
    await harness.runtime.start(harness.pi, harness.ctx, "resume");
    const indexedIds = harness.archiveCalls.index.flat().map((entry) => entry.entryId);
    assert.equal(indexedIds.includes("pause-1"), false);
    assert.equal(indexedIds.includes("paused-1"), false);
    assert.equal(indexedIds.includes("resume-1"), true);
    assert.equal(indexedIds.includes("active-1"), true);
    harness.runtime.stop();
  });
});

test("an active tree switch indexes newly exposed history", async () => {
  await withGlobalConfig(undefined, async () => {
    const harness = runtimeHarness([user("u1", "Implement parser")]);
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    harness.archiveCalls.index.length = 0;
    harness.archiveCalls.maintain.length = 0;

    harness.entries.push(user("tree-only", "History exposed by a tree switch", "u1"));
    await harness.runtime.onTree(harness.ctx);
    assert.equal(harness.archiveCalls.index.flat().some((entry) => entry.entryId === "tree-only"), true);
    assert.equal(harness.archiveCalls.maintain.length, 1);

    harness.entries.push(user("after-tree", "New work after the tree switch", "tree-only"));
    await harness.runtime.onTurnEnd(harness.ctx);
    const indexedIds = harness.archiveCalls.index.flat().map((entry) => entry.entryId);
    assert.equal(indexedIds.includes("tree-only"), true);
    assert.equal(indexedIds.includes("after-tree"), true);
    harness.runtime.stop();
  });
});

test("idle recovery requires a fresh successful explicit checkpoint", async () => {
  await withGlobalConfig({
    continuation: { afterIdleUnfinished: true, afterSessionResume: false },
  }, async () => {
    const fresh = runtimeHarness(explicitBranch().entries);
    await fresh.runtime.start(fresh.pi, fresh.ctx, "new");
    await fresh.runtime.onSettled(fresh.pi, fresh.ctx);
    assert.equal(fresh.sent.length, 1);
    assert.match(fresh.sent[0].message.content, /reason=idle-unfinished/);
    await fresh.runtime.onSettled(fresh.pi, fresh.ctx);
    assert.equal(fresh.sent.length, 1);
    fresh.runtime.stop();

    const stale = runtimeHarness(staleExplicitBranch());
    await stale.runtime.start(stale.pi, stale.ctx, "new");
    await stale.runtime.onSettled(stale.pi, stale.ctx);
    assert.equal(stale.sent.length, 0);
    stale.runtime.stop();
  });
});

test("prose-only next steps never authorize idle or session recovery", async () => {
  await withGlobalConfig({
    continuation: { afterIdleUnfinished: true, afterSessionResume: true },
  }, async () => {
    const harness = runtimeHarness([
      user("u1", "Implement parser"),
      assistant("a1", "u1", { text: "Next steps:\n1. Run npm test" }),
    ]);
    await harness.runtime.start(harness.pi, harness.ctx, "resume");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await harness.runtime.onSettled(harness.pi, harness.ctx);
    assert.deepEqual(harness.sent, []);
    harness.runtime.stop();
  });
});

test("session recovery requires a fresh successful explicit checkpoint", async () => {
  await withGlobalConfig({
    continuation: { afterSessionResume: true, afterIdleUnfinished: false },
  }, async () => {
    const fresh = runtimeHarness(explicitBranch().entries);
    await fresh.runtime.start(fresh.pi, fresh.ctx, "resume");
    await waitFor(() => fresh.sent.length === 1);
    assert.match(fresh.sent[0].message.content, /reason=session-resume/);
    fresh.runtime.stop();

    const stale = runtimeHarness(staleExplicitBranch());
    await stale.runtime.start(stale.pi, stale.ctx, "resume");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(stale.sent.length, 0);
    stale.runtime.stop();
  });
});

test("length-stop recovery is independent of explicit checkpoint and next-action gates", async () => {
  await withGlobalConfig({
    continuation: { afterIdleUnfinished: false, afterSessionResume: false },
  }, async () => {
    const entries = [
      user("u1", "Implement parser"),
      assistant("a1", "u1", {
        text: "The response ended while I was editing.",
        stopReason: "length",
      }),
    ];
    const harness = runtimeHarness(entries);
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    assert.equal(harness.runtime.currentConfig.continuation.afterLengthStop, true);
    await harness.runtime.onSettled(harness.pi, harness.ctx);
    assert.equal(harness.sent.length, 1);
    assert.match(harness.sent[0].message.content, /reason=length-stop/);
    assert.match(harness.sent[0].message.content, /continue interrupted work/);
    harness.runtime.stop();
  });
});

test("purge requires confirmation, preserves session entries, and supports cancellation", async () => {
  await withGlobalConfig(undefined, async () => {
    let confirmed = false;
    const confirmations = [];
    const ui = {
      async confirm(title, message) {
        confirmations.push({ title, message });
        return confirmed;
      },
      notify() {},
      setStatus() {},
    };
    const harness = runtimeHarness([user("u1", "Implement parser")], { hasUI: true, ui });
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    const entryCount = harness.entries.length;

    assert.equal(
      await harness.runtime.command("purge", harness.pi, harness.ctx),
      "Continuity purge cancelled.",
    );
    assert.equal(harness.archiveCalls.purge, 0);

    confirmed = true;
    assert.match(await harness.runtime.command("purge", harness.pi, harness.ctx), /JSONL was preserved/);
    assert.equal(harness.archiveCalls.purge, 1);
    assert.equal(harness.archiveCalls.open, 2);
    assert.equal(harness.entries.length, entryCount);
    assert.equal(confirmations.length, 2);
    harness.runtime.stop(harness.ctx);
  });
});

test("blob results expose a recall pointer and blob recall obeys branch scope", async () => {
  await withGlobalConfig({ blobs: { enabled: true } }, async () => {
    const first = user("u1", "Inspect compiler output");
    const branchResult = toolResult("t1", "u1", "call-1", "bash", "short output");
    const abandonedResult = toolResult("t2", null, "call-2", "bash", "abandoned output");
    const records = {
      "blob-1": {
        text: "full compiler output",
        record: {
          id: "blob-1",
          sessionId: "session-1",
          toolCallId: "call-1",
          path: "/tmp/blob-1",
          bytes: 20,
          sha256: "sha-1",
          createdAt: 1,
        },
      },
      "blob-2": {
        text: "abandoned compiler output",
        record: {
          id: "blob-2",
          sessionId: "session-1",
          toolCallId: "call-2",
          path: "/tmp/blob-2",
          bytes: 25,
          sha256: "sha-2",
          createdAt: 1,
        },
      },
    };
    const harness = runtimeHarness([first, branchResult, abandonedResult], {
      branch: (entries) => entries.filter((entry) => entry.id === "u1" || entry.id === "t1"),
      archive: {
        async spoolBlob(input) {
          return { ...records["blob-1"].record, toolCallId: input.toolCallId };
        },
        async readBlob(id) {
          return records[id];
        },
      },
    });
    await harness.runtime.start(harness.pi, harness.ctx, "new");
    harness.archiveCalls.maintain.length = 0;
    const rewritten = await harness.runtime.onToolResult({
      toolName: "bash",
      toolCallId: "call-1",
      content: [{ type: "text", text: "short output" }],
      details: { fullOutputPath: "/tmp/full-output.log", preserved: true },
      isError: false,
    });
    assert.deepEqual(rewritten.details.continuityBlob, {
      id: "blob-1",
      bytes: 20,
      sha256: "sha-1",
    });
    assert.equal(rewritten.details.preserved, true);
    assert.match(rewritten.content.at(-1).text, /continuity_recall mode=blob id=blob-1/);
    assert.equal(harness.archiveCalls.spool.length, 1);
    assert.equal(harness.archiveCalls.maintain.length, 1);

    assert.match(await harness.runtime.recall({ mode: "blob", id: "blob-1" }, harness.ctx), /full compiler output/);
    await assert.rejects(
      () => harness.runtime.recall({ mode: "blob", id: "blob-2" }, harness.ctx),
      /selected scope/,
    );
    assert.match(
      await harness.runtime.recall({ mode: "blob", id: "blob-2", scope: "session" }, harness.ctx),
      /abandoned compiler output/,
    );
    harness.runtime.stop();
  });
});
