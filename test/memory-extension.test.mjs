import test from "node:test";
import assert from "node:assert/strict";
import memoryExtension from "../extensions/memory.ts";
import {
  MEMORY_DETAILS_TYPE,
  MEMORY_ENABLED_ENTRY,
  MEMORY_OBSERVATIONS_ENTRY,
  MEMORY_RESUME_MESSAGE,
} from "../extensions/memory-core.ts";

function activeCheckpoint(overrides = {}) {
  return {
    objective: { id: "goal", text: "Finish memory", sourceEntryIds: ["u1"] },
    requirements: [{ id: "r1", text: "Keep going", sourceEntryIds: ["u1"], status: "open" }],
    decisions: [],
    currentAction: { id: "a1", text: "Run checks", sourceEntryIds: ["u1"] },
    completed: [],
    verification: [],
    blockers: [],
    phase: "active",
    sourceEntryIds: ["u1"],
    ...overrides,
  };
}

function details(checkpoint = activeCheckpoint(), includedObservationIds = []) {
  return {
    type: MEMORY_DETAILS_TYPE,
    version: 1,
    checkpoint,
    includedObservationIds,
    observationCoversUpToId: "u1",
  };
}

function setup(initialBranch = []) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const appended = [];
  const sent = [];
  let active = ["read"];
  let branch = [...initialBranch];
  let nextId = 0;
  const pi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
      active.push(tool.name);
    },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
    appendEntry(customType, data) {
      const entry = { type: "custom", id: `custom-${++nextId}`, customType, data };
      branch.push(entry);
      appended.push(entry);
    },
    sendMessage(message, options) { sent.push({ message, options }); },
  };
  memoryExtension(pi);

  const notifications = [];
  const status = new Map();
  let compactOptions;
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/project",
    model: { provider: "test", id: "model", contextWindow: 128_000, reasoning: false },
    sessionManager: {
      getBranch: () => branch,
      getEntries: () => branch,
      getEntry: (id) => branch.find((entry) => entry.id === id),
    },
    getContextUsage: () => ({ tokens: 10_000, contextWindow: 128_000, percent: 8 }),
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (key, value) => status.set(key, value),
    },
    compact(options) { compactOptions = options; },
  };
  return {
    tools,
    commands,
    events,
    appended,
    sent,
    active: () => active,
    branch: () => branch,
    setBranch: (next) => { branch = next; },
    ctx,
    notifications,
    status,
    compactOptions: () => compactOptions,
  };
}

async function start(setupResult) {
  await setupResult.events.get("session_start")({ type: "session_start", reason: "startup" }, setupResult.ctx);
}

test("memory defaults on while an explicit branch-local toggle persists", async () => {
  const state = setup();
  await start(state);
  assert.deepEqual(state.active(), ["read", "memory_search"]);
  assert.equal(state.status.get("memory"), "mem");

  await state.commands.get("memory").handler("off", state.ctx);
  assert.deepEqual(state.active(), ["read"]);
  assert.equal(state.appended.at(-1).customType, MEMORY_ENABLED_ENTRY);
  assert.equal(state.appended.at(-1).data.enabled, false);

  await start(state);
  assert.deepEqual(state.active(), ["read"]);
  assert.equal(state.status.get("memory"), undefined);

  await state.commands.get("memory").handler("on", state.ctx);
  assert.deepEqual(state.active(), ["read", "memory_search"]);
  assert.equal(state.appended.at(-1).data.enabled, true);
  assert.equal(state.status.get("memory"), "mem");
});

test("memory tools search observations and reject source ids outside the active branch", async () => {
  const branch = [
    { type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Exact auth requirement" }] } },
    {
      type: "custom", id: "m1", customType: MEMORY_OBSERVATIONS_ENTRY,
      data: {
        version: 1,
        coversUpToId: "u1",
        observations: [{
          id: "o1", kind: "requirement", content: "Authentication must use JWT", sourceEntryIds: ["u1"], status: "open", tokenCount: 7,
        }],
      },
    },
    { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
  ];
  const state = setup(branch);
  await start(state);
  assert.ok(!state.active().includes("memory_source"));
  await state.tools.get("memory_search").execute("miss", { query: "deployment" }, undefined, undefined, state.ctx);
  assert.ok(!state.active().includes("memory_source"));
  const search = await state.tools.get("memory_search").execute("call", { query: "JWT authentication" }, undefined, undefined, state.ctx);
  assert.match(search.content[0].text, /o1 \[requirement open\]/);
  assert.deepEqual(search.details.observationIds, ["o1"]);
  assert.ok(state.active().includes("memory_source"));

  const source = await state.tools.get("memory_source").execute("call", { entryIds: ["u1", "abandoned"] }, undefined, undefined, state.ctx);
  assert.match(source.content[0].text, /Exact auth requirement/);
  assert.doesNotMatch(source.content[0].text, /abandoned/);
  assert.deepEqual(source.details.entryIds, ["u1"]);
});

test("context hook injects relevant active-branch observations but excludes records already in compaction", async () => {
  const checkpoint = activeCheckpoint({
    objective: { id: "goal", text: "Fix authentication", sourceEntryIds: ["u1"] },
  });
  const branch = [
    { type: "message", id: "u1", message: { role: "user", content: "Fix authentication" } },
    {
      type: "custom", id: "m1", customType: MEMORY_OBSERVATIONS_ENTRY,
      data: {
        version: 1,
        coversUpToId: "u1",
        observations: [
          { id: "o1", kind: "blocker", content: "Authentication fails with TS2322", sourceEntryIds: ["u1"], tokenCount: 8 },
          { id: "o2", kind: "decision", content: "Authentication uses JWT", sourceEntryIds: ["u1"], tokenCount: 6 },
        ],
      },
    },
    { type: "message", id: "u2", message: { role: "user", content: "Recent continuation" } },
    { type: "compaction", id: "c1", details: details(checkpoint, ["o2"]), firstKeptEntryId: "u2" },
    { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
  ];
  const state = setup(branch);
  await start(state);
  const messages = [{ role: "user", content: [{ type: "text", text: "Fix the authentication TS2322" }], timestamp: 1 }];
  const result = await state.events.get("context")({ type: "context", messages }, state.ctx);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].customType, "pi-config.memory.context");
  assert.match(result.messages[0].content, /o1/);
  assert.doesNotMatch(result.messages[0].content, /o2/);
});

test("context hook does not duplicate observations whose exact sources remain in raw context", async () => {
  const state = setup([
    { type: "message", id: "u1", message: { role: "user", content: "Fix authentication" } },
    {
      type: "custom", id: "m1", customType: MEMORY_OBSERVATIONS_ENTRY,
      data: {
        version: 1,
        coversUpToId: "u1",
        observations: [{ id: "o1", kind: "requirement", content: "Fix authentication", sourceEntryIds: ["u1"], tokenCount: 4 }],
      },
    },
    { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
  ]);
  await start(state);
  const result = await state.events.get("context")({
    type: "context",
    messages: [{ role: "user", content: "Fix authentication", timestamp: 1 }],
  }, state.ctx);
  assert.equal(result, undefined);
});

test("native overflow retries are not duplicated and active terminal compactions continue once settled", async () => {
  const compaction = { type: "compaction", id: "c1", details: details(), firstKeptEntryId: "u1" };
  const state = setup([
    { type: "message", id: "u1", message: { role: "user", content: "Keep going" } },
    compaction,
    { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
  ]);
  await start(state);

  await state.events.get("session_compact")({
    type: "session_compact", compactionEntry: compaction, fromExtension: true, reason: "overflow", willRetry: true,
  }, state.ctx);
  await state.events.get("agent_settled")({ type: "agent_settled" }, state.ctx);
  assert.equal(state.sent.length, 0);

  await state.events.get("session_compact")({
    type: "session_compact", compactionEntry: compaction, fromExtension: true, reason: "threshold", willRetry: false,
  }, state.ctx);
  await state.events.get("agent_settled")({ type: "agent_settled" }, state.ctx);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].message.customType, MEMORY_RESUME_MESSAGE);
  assert.equal(state.sent[0].options.deliverAs, "followUp");
  await state.events.get("agent_settled")({ type: "agent_settled" }, state.ctx);
  assert.equal(state.sent.length, 1);
});

test("blocked and complete checkpoints do not trigger terminal continuation", async () => {
  for (const checkpoint of [
    activeCheckpoint({ blockers: [{ id: "b", text: "Need user choice", sourceEntryIds: ["u1"], awaitingUser: true }] }),
    activeCheckpoint({ phase: "complete", requirements: [], currentAction: undefined }),
  ]) {
    const compaction = { type: "compaction", id: "c1", details: details(checkpoint), firstKeptEntryId: "u1" };
    const state = setup([
      { type: "message", id: "u1", message: { role: "user", content: "Task" } },
      compaction,
      { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
    ]);
    await start(state);
    await state.events.get("session_compact")({
      type: "session_compact", compactionEntry: compaction, fromExtension: true, reason: "threshold", willRetry: false,
    }, state.ctx);
    await state.events.get("agent_settled")({ type: "agent_settled" }, state.ctx);
    assert.equal(state.sent.length, 0);
  }
});

test("mid-tool context pressure compacts and resumes through the completion callback", async () => {
  const state = setup([
    { type: "custom", id: "enabled", customType: MEMORY_ENABLED_ENTRY, data: { enabled: true } },
  ]);
  state.ctx.getContextUsage = () => ({ tokens: 100_000, contextWindow: 128_000, percent: 78 });
  await start(state);
  await state.events.get("turn_end")({
    type: "turn_end",
    turnIndex: 1,
    message: { role: "assistant" },
    toolResults: [{ role: "toolResult" }],
  }, state.ctx);
  assert.ok(state.compactOptions());
  state.compactOptions().onComplete({});
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].message.customType, MEMORY_RESUME_MESSAGE);
  assert.equal(state.sent[0].options.triggerTurn, true);
});
