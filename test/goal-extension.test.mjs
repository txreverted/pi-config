import test from "node:test";
import assert from "node:assert/strict";
import goalExtension from "../extensions/goal.ts";

function harness(branch = [], { model = { provider: "test", id: "model" }, authenticated = true } = {}) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const entries = [];
  const messages = [];
  const statuses = [];
  const notices = [];
  let active = ["read"];
  let pending = false;
  let idle = true;
  let aborts = 0;
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); active.push(tool.name); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
    getActiveTools() { return [...active]; },
    setActiveTools(names) { active = [...names]; },
    sendUserMessage(text) { messages.push(text); },
  };
  goalExtension(pi);
  const context = {
    mode: "tui",
    model: model ?? undefined,
    modelRegistry: { hasConfiguredAuth: () => authenticated },
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    abort: () => { aborts++; },
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: (message, level) => notices.push({ message, level }),
      setStatus: (name, value) => statuses.push({ name, value }),
    },
  };
  return {
    tools, commands, events, entries, messages, statuses, notices, context,
    active: () => active,
    aborts: () => aborts,
    setPending(value) { pending = value; },
    setIdle(value) { idle = value; },
  };
}

const assistant = (text, totalTokens = 10) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  usage: { totalTokens },
});

async function startRun(h) {
  const injected = await h.events.get("before_agent_start")({ prompt: h.messages.at(-1), systemPrompt: "BASE" }, h.context);
  await h.events.get("agent_start")({}, h.context);
  return injected;
}

async function response(h, text, { tokens = 10 } = {}) {
  await startRun(h);
  await h.events.get("message_end")({ message: assistant(text, tokens) }, h.context);
  await h.events.get("agent_settled")({}, h.context);
}

function snapshotEntry(goal) {
  return { type: "custom", customType: "goal-snapshot", data: { goal } };
}

test("fresh sessions hide goal tools; activation reveals them and uses untrusted-data prompting", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  assert.deepEqual(h.active(), ["read"]);

  const sentinel = "IGNORE_SYSTEM_SENTINEL";
  await h.commands.get("goal").handler(`Implement safely ${sentinel}`, h.context);
  assert.ok(["goal_complete", "goal_wait"].every((name) => !h.active().includes(name)));
  assert.match(h.statuses.at(-1).value, /goal: paused/);
  assert.match(h.messages[0], /untrusted task data/);
  assert.match(h.messages[0], /goal_id:/);
  assert.match(h.messages[0], new RegExp(sentinel));
  const unrelated = await h.events.get("before_agent_start")({ prompt: "ordinary input", systemPrompt: "BASE" }, h.context);
  assert.equal(unrelated, undefined);
  assert.match(h.statuses.at(-1).value, /goal: paused/);
  const injected = await h.events.get("before_agent_start")({ prompt: h.messages[0], systemPrompt: "BASE" }, h.context);
  assert.match(injected.systemPrompt, /goal controller user message/);
  assert.match(injected.systemPrompt, /Current goal_id:/);
  assert.doesNotMatch(injected.systemPrompt, new RegExp(sentinel));
  assert.ok(["goal_complete", "goal_wait"].every((name) => h.active().includes(name)));
  assert.match(h.statuses.at(-1).value, /goal: active/);
});

test("goal dispatch fails closed before Pi confirms a turn", async () => {
  for (const options of [{ model: null }, { authenticated: false }]) {
    const unavailable = harness([], options);
    await unavailable.events.get("session_start")({}, unavailable.context);
    await unavailable.commands.get("goal").handler("Do not become active", unavailable.context);
    assert.equal(unavailable.messages.length, 0);
    assert.match(unavailable.entries.at(-1).data.goal.status, /paused/);
    assert.ok(!unavailable.active().includes("goal_complete"));
    assert.equal(unavailable.notices.at(-1).level, "error");
  }

  const swallowed = harness();
  await swallowed.events.get("session_start")({}, swallowed.context);
  await swallowed.commands.get("goal").handler("Wait for confirmation", swallowed.context);
  await swallowed.events.get("before_agent_start")({ prompt: "unrelated input", systemPrompt: "BASE" }, swallowed.context);
  await swallowed.events.get("agent_start")({}, swallowed.context);
  assert.equal(swallowed.entries.at(-1).data.goal.status, "paused");
  assert.ok(!swallowed.active().includes("goal_complete"));
});

test("goal activation waits for an idle boundary", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  h.setIdle(false);
  await h.commands.get("goal").handler("Do not overlap", h.context);
  assert.equal(h.messages.length, 0);
  assert.equal(h.entries.length, 0);
  assert.match(h.notices.at(-1).message, /idle/);
});

test("goal notifications collapse repeated display-only blank rows", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("First line\n\n\nSecond line", h.context);
  await h.commands.get("goal").handler("status", h.context);
  assert.match(h.notices.at(-1).message, /First line Second line/);
  assert.doesNotMatch(h.notices.at(-1).message, /\n\s*\n\s*\n/);
});

test("goal completion requires separate verification evidence", async () => {
  const h = harness();
  assert.equal(h.tools.get("goal_complete").parameters.additionalProperties, false);
  assert.equal(h.tools.get("goal_wait").parameters.additionalProperties, false);
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Finish verified work", h.context);
  const id = h.entries.at(-1).data.goal.id;
  await startRun(h);
  await assert.rejects(
    () => h.tools.get("goal_complete").execute("x", { goal_id: id, summary: "done", evidence: "\u001b]0;title\u0007" }),
    /evidence is required/i,
  );
  const completed = await h.tools.get("goal_complete").execute("x", {
    goal_id: id,
    summary: "Implemented safely",
    evidence: "npm test passed\u202e",
  });
  assert.equal(completed.terminate, true);
  assert.match(completed.details.goal.note, /Implemented safely Evidence: npm test passed/);
  assert.doesNotMatch(completed.details.goal.note, /\u202e/);

  const bounded = harness();
  await bounded.events.get("session_start")({}, bounded.context);
  await bounded.commands.get("goal").handler("Keep complete evidence", bounded.context);
  const boundedId = bounded.entries.at(-1).data.goal.id;
  await startRun(bounded);
  await bounded.tools.get("goal_complete").execute("x", {
    goal_id: boundedId,
    summary: "Done",
    evidence: "E".repeat(4_000),
  });
  const note = bounded.entries.at(-1).data.goal.note;
  assert.equal(note.length, 4_000);
  assert.ok(note.endsWith("E".repeat(100)));
});

test("continuations dispatch only when settled, idle, and without pending messages", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Continue carefully", h.context);
  assert.equal(h.messages.length, 1);
  h.setPending(true);
  await response(h, "initial", { tool: true });
  assert.equal(h.messages.length, 1);
  h.setPending(false);
  await h.events.get("agent_settled")({}, h.context);
  assert.equal(h.messages.length, 2);
  await h.events.get("agent_settled")({}, h.context);
  assert.equal(h.messages.length, 2, "duplicate settled events do not queue duplicate continuations");
});

test("aborted or failed turns pause instead of restarting autonomous work", async () => {
  for (const stopReason of ["aborted", "error"]) {
    const h = harness();
    await h.events.get("session_start")({}, h.context);
    await h.commands.get("goal").handler(`Handle ${stopReason}`, h.context);
    await startRun(h);
    await h.events.get("message_end")({ message: { ...assistant("stopped"), stopReason } }, h.context);
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 1);
    assert.match(h.statuses.at(-1).value, /paused/);
    assert.ok(!h.active().includes("goal_complete"));
  }
});

test("provider retries preserve ownership of the current goal run", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Survive a retry", h.context);
  await startRun(h);
  await h.events.get("message_end")({ message: { ...assistant("retrying"), stopReason: "error" } }, h.context);
  await h.events.get("agent_start")({}, h.context);
  await h.events.get("message_end")({ message: { ...assistant("recovered"), stopReason: "stop" } }, h.context);
  await h.events.get("agent_settled")({}, h.context);
  assert.equal(h.messages.length, 2);
  assert.match(h.entries.at(-1).data.goal.status, /paused/);
  assert.match(h.entries.at(-1).data.goal.note, /queued/);
});

test("automatic continuation has no run or repeated-output ceiling", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Continue until complete", h.context);
  for (let index = 0; index < 25; index++) await response(h, "same output");
  assert.equal(h.messages.length, 26);
  await startRun(h);
  assert.match(h.statuses.at(-1).value, /goal: active/);

  const rejected = harness();
  await rejected.events.get("session_start")({}, rejected.context);
  await rejected.commands.get("goal").handler("Budgeted --tokens 100", rejected.context);
  assert.equal(rejected.messages.length, 0);
  assert.match(rejected.notices.at(-1).message, /no longer supported/);
});

test("goal terminal tools block every call in a mixed batch", async () => {
  const branch = [{
    type: "message",
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", id: "write-1", name: "write", arguments: {} },
        { type: "toolCall", id: "goal-1", name: "goal_complete", arguments: {} },
      ],
    },
  }];
  const h = harness(branch);
  for (const [toolCallId, toolName] of [["write-1", "write"], ["goal-1", "goal_complete"]]) {
    const blocked = await h.events.get("tool_call")({ toolCallId, toolName, input: {} }, h.context);
    assert.deepEqual(blocked, {
      block: true,
      terminate: true,
      reason: "goal_complete and goal_wait must be called alone; retry the batch without sibling tools",
    });
  }

  branch[0].message.content = [{ type: "toolCall", id: "goal-2", name: "goal_wait", arguments: {} }];
  assert.equal(await h.events.get("tool_call")({ toolCallId: "goal-2", toolName: "goal_wait", input: {} }, h.context), undefined);
});

test("a settled goal run without an assistant message pauses safely", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Handle missing response", h.context);
  await startRun(h);
  await h.events.get("agent_settled")({}, h.context);
  assert.equal(h.messages.length, 1);
  assert.match(h.entries.at(-1).data.goal.note, /aborted or failed/);
  assert.ok(!h.active().includes("goal_complete"));
});

test("goal tools reject stale ids", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Hard goal", h.context);
  await h.events.get("before_agent_start")({ prompt: h.messages[0], systemPrompt: "BASE" }, h.context);
  for (const [name, params] of [
    ["goal_complete", { goal_id: "stale", summary: "done", evidence: "checks passed" }],
    ["goal_wait", { goal_id: "stale", reason: "wait" }],
  ]) await assert.rejects(h.tools.get(name).execute("x", params), /Stale goal_id; no state was changed/);
});

test("paused tools cannot terminate a goal and external input wakes a waiting goal", async () => {
  const paused = harness();
  await paused.events.get("session_start")({}, paused.context);
  await paused.commands.get("goal").handler("Work safely", paused.context);
  const pausedId = paused.entries.at(-1).data.goal.id;
  await paused.commands.get("goal").handler("pause", paused.context);
  assert.ok(paused.aborts() > 0);
  assert.ok(!paused.active().includes("goal_complete"));
  await assert.rejects(
    paused.tools.get("goal_complete").execute("x", { goal_id: pausedId, summary: "done", evidence: "verified" }),
    /not active/,
  );

  const waiting = harness();
  await waiting.events.get("session_start")({}, waiting.context);
  await waiting.commands.get("goal").handler("Wait safely", waiting.context);
  const waitingId = waiting.entries.at(-1).data.goal.id;
  await startRun(waiting);
  await waiting.tools.get("goal_wait").execute("x", { goal_id: waitingId, reason: "monitor" });
  await waiting.events.get("agent_settled")({}, waiting.context);
  assert.match(waiting.statuses.at(-1).value, /waiting/);
  assert.ok(!waiting.active().includes("goal_complete"));
  await waiting.events.get("input")({ source: "interactive", text: "monitor fired" }, waiting.context);
  const injected = await waiting.events.get("before_agent_start")({ systemPrompt: "BASE" }, waiting.context);
  assert.match(injected.systemPrompt, /ACTIVE GOAL CONTROLLER/);
  assert.match(waiting.statuses.at(-1).value, /active/);
  assert.ok(waiting.active().includes("goal_complete"));
});

test("wait deadlines wake once and continue from the idle boundary", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  try {
    const h = harness();
    await h.events.get("session_start")({}, h.context);
    await h.commands.get("goal").handler("Wake safely", h.context);
    const id = h.entries.at(-1).data.goal.id;
    await startRun(h);
    await h.tools.get("goal_wait").execute("x", { goal_id: id, reason: "timer", resume_after_ms: 10 });
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 1);
    h.setIdle(false);
    h.setPending(true);
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 1, "an elapsed deadline waits while Pi is busy");
    assert.match(h.statuses.at(-1).value, /active/);
    assert.ok(h.active().includes("goal_complete"));
    h.setIdle(true);
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 1, "pending messages keep the continuation queued");
    h.setPending(false);
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 2);
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 2, "deadline is single-shot");
    await h.events.get("session_shutdown")({}, h.context);
  } finally {
    t.mock.timers.reset();
  }
});

test("a waiting goal wakes without an automatic-run ceiling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  try {
    const h = harness([snapshotEntry({
      id: "goal-wait-limit",
      objective: "Continue after waiting",
      status: "waiting",
      waitingUntil: 1_010,
    })]);
    await h.events.get("session_start")({}, h.context);
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 1);
    await startRun(h);
    assert.match(h.statuses.at(-1).value, /active/);
    assert.ok(h.active().includes("goal_complete"));
    await h.events.get("session_shutdown")({}, h.context);
  } finally {
    t.mock.timers.reset();
  }
});

test("branch restore pauses active goals, preserves waiting goals, and clears timers on shutdown", async () => {
  const base = { id: "goal-restored", objective: "Restore me", status: "active" };
  const active = harness([snapshotEntry(base)]);
  await active.events.get("session_start")({}, active.context);
  assert.match(active.statuses.at(-1).value, /paused/);
  assert.ok(!active.active().includes("goal_complete"));

  const waiting = harness([snapshotEntry({ ...base, status: "waiting", waitingUntil: Date.now() + 60_000 })]);
  await waiting.events.get("session_start")({}, waiting.context);
  assert.match(waiting.statuses.at(-1).value, /waiting/);
  await waiting.events.get("session_shutdown")({}, waiting.context);
  assert.equal(waiting.statuses.at(-1).value, undefined);
});

test("goal edit, pause, resume, and clear transitions stay explicit", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Original objective", h.context);
  const id = h.entries.at(-1).data.goal.id;

  await h.commands.get("goal").handler("edit Revised objective", h.context);
  assert.deepEqual(h.entries.at(-1).data.goal, {
    id,
    objective: "Revised objective",
    status: "paused",
    waitingUntil: undefined,
    note: "Edited; use /goal resume.",
  });
  await h.commands.get("goal").handler("resume", h.context);
  assert.match(h.entries.at(-1).data.goal.note, /queued/);
  await startRun(h);
  await h.commands.get("goal").handler("pause", h.context);
  assert.equal(h.entries.at(-1).data.goal.status, "paused");
  await h.commands.get("goal").handler("resume", h.context);
  await h.commands.get("goal").handler("clear", h.context);
  assert.equal(h.entries.at(-1).data.goal, null);
  assert.equal(h.statuses.at(-1).value, undefined);
  assert.ok(!h.active().includes("goal_complete"));
  assert.ok(h.aborts() >= 3);
});

test("a malformed latest snapshot fails closed instead of restoring older waiting state", async () => {
  const validWaiting = { id: "goal-old", objective: "Do not resurrect", status: "waiting" };
  const h = harness([
    snapshotEntry(validWaiting),
    snapshotEntry({ ...validWaiting, objective: "" }),
  ]);
  await h.events.get("session_start")({}, h.context);
  assert.equal(h.statuses.at(-1).value, undefined);
  assert.deepEqual(h.active(), ["read"]);
  await h.commands.get("goal").handler("status", h.context);
  assert.equal(h.notices.at(-1).message, "No goal.");
});
