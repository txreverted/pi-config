import test from "node:test";
import assert from "node:assert/strict";
import goalExtension from "../extensions/goal.ts";
import { UI_MODE_STATUS_EVENT } from "../extensions/ui-core.ts";

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
    events: {
      emit(name, data) {
        if (name === UI_MODE_STATUS_EVENT) statuses.push({ name: data.id, value: data.text });
      },
    },
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

async function response(h, text, { tokens = 10, tool = false, toolError = false } = {}) {
  await startRun(h);
  if (tool || toolError) await h.events.get("tool_execution_end")({ isError: toolError }, h.context);
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

  await h.commands.get("goal").handler("Implement safely", h.context);
  assert.ok(["goal_complete", "goal_blocked", "goal_wait"].every((name) => !h.active().includes(name)));
  assert.match(h.statuses.at(-1).value, /goal: paused/);
  assert.match(h.messages[0], /untrusted task data/);
  assert.match(h.messages[0], /goal_id:/);
  const unrelated = await h.events.get("before_agent_start")({ prompt: "ordinary input", systemPrompt: "BASE" }, h.context);
  assert.equal(unrelated, undefined);
  assert.match(h.statuses.at(-1).value, /goal: paused/);
  const injected = await h.events.get("before_agent_start")({ prompt: h.messages[0], systemPrompt: "BASE" }, h.context);
  assert.match(injected.systemPrompt, /JSON string/);
  assert.ok(["goal_complete", "goal_blocked", "goal_wait"].every((name) => h.active().includes(name)));
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

test("failed tool calls do not bypass repeated automatic-run detection", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Stop failed loops", h.context);
  await response(h, "initial", { tool: true });
  for (let index = 0; index < 3; index++) await response(h, "same failed attempt", { toolError: true });
  assert.match(h.statuses.at(-1).value, /paused/);
  assert.equal(h.messages.length, 4);
});

test("harmless successful-tool loops pause at the automatic ceiling and resume renews it", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Bound the loop", h.context);
  await response(h, "initial", { tool: true });
  for (let index = 0; index < 20; index++) await response(h, `automatic ${index}`, { tool: true });
  assert.equal(h.messages.length, 21);
  assert.match(h.statuses.at(-1).value, /goal: paused · 20\/20 auto/);

  await h.commands.get("goal").handler("resume", h.context);
  assert.equal(h.messages.length, 22);
  assert.match(h.statuses.at(-1).value, /goal: paused · 0\/20 auto/);
  await startRun(h);
  assert.match(h.statuses.at(-1).value, /goal: active · 0\/20 auto/);

  const rejected = harness();
  await rejected.events.get("session_start")({}, rejected.context);
  await rejected.commands.get("goal").handler("Budgeted --tokens 100", rejected.context);
  assert.equal(rejected.messages.length, 0);
  assert.match(rejected.notices.at(-1).message, /no longer supported/);
});

test("blocker requires the same report on three separate automatic runs and rejects stale ids", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Hard goal", h.context);
  const id = h.entries.at(-1).data.goal.id;
  await h.events.get("before_agent_start")({ prompt: h.messages[0], systemPrompt: "BASE" }, h.context);
  const blockedTool = h.tools.get("goal_blocked");
  assert.equal("repeated_turns" in blockedTool.parameters.properties, false);
  assert.deepEqual(
    blockedTool.prepareArguments({ goal_id: id, reason: "claimed", evidence: "none", repeated_turns: 99 }),
    { goal_id: id, reason: "claimed", evidence: "none" },
  );
  await assert.rejects(
    blockedTool.execute("x", { goal_id: id, reason: "claimed", evidence: "none" }),
    /only during an automatic/,
  );
  for (const name of ["goal_complete", "goal_wait", "goal_blocked"]) {
    const params = name === "goal_complete"
      ? { goal_id: "stale", summary: "done", evidence: "checks passed" }
      : name === "goal_wait"
        ? { goal_id: "stale", reason: "wait" }
        : { goal_id: "stale", reason: "blocked", evidence: "proof" };
    await assert.rejects(h.tools.get(name).execute("x", params), /Stale goal_id; no state was changed/);
  }

  await response(h, "initial", { tool: true });
  const report = async (reason, expected) => {
    await startRun(h);
    const call = h.tools.get("goal_blocked").execute("x", {
      goal_id: id,
      reason,
      evidence: "verified",
    });
    if (expected === "complete") return call;
    await assert.rejects(call, new RegExp(`report ${expected}/3`, "i"));
    await h.events.get("message_end")({ message: assistant("still blocked") }, h.context);
    await h.events.get("agent_settled")({}, h.context);
  };

  await report("blocker A", 1);
  await report("blocker B", 1);
  await report("blocker B", 2);
  const result = await report("blocker B", "complete");
  assert.equal(result.terminate, true);
  assert.match(h.statuses.at(-1).value, /blocked/);
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

test("a waiting goal cannot wake past the automatic-run ceiling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  try {
    const h = harness([snapshotEntry({
      id: "goal-wait-limit",
      objective: "Stop after waiting",
      status: "waiting",
      automaticRuns: 20,
      repeatedToolFreeRuns: 0,
      waitingUntil: 1_010,
    })]);
    await h.events.get("session_start")({}, h.context);
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 0);
    assert.match(h.statuses.at(-1).value, /paused · 20\/20 auto/);
    assert.ok(!h.active().includes("goal_complete"));
    await h.events.get("session_shutdown")({}, h.context);
  } finally {
    t.mock.timers.reset();
  }
});

test("branch restore pauses active goals, preserves waiting goals, and clears timers on shutdown", async () => {
  const base = {
    id: "goal-restored", objective: "Restore me", status: "active", tokensUsed: 4, tokenBudget: 10,
    automaticResponses: 2, automaticRuns: 2, repeatedToolFreeRuns: 0,
  };
  const active = harness([snapshotEntry(base)]);
  await active.events.get("session_start")({}, active.context);
  assert.match(active.statuses.at(-1).value, /paused/);
  assert.ok(!active.active().includes("goal_complete"));
  assert.equal("tokenBudget" in active.entries.at(-1).data.goal, false);
  assert.equal("tokensUsed" in active.entries.at(-1).data.goal, false);
  assert.equal("automaticResponses" in active.entries.at(-1).data.goal, false);

  const waiting = harness([snapshotEntry({ ...base, status: "waiting", waitingUntil: Date.now() + 60_000 })]);
  await waiting.events.get("session_start")({}, waiting.context);
  assert.match(waiting.statuses.at(-1).value, /waiting/);
  await waiting.events.get("session_shutdown")({}, waiting.context);
  assert.equal(waiting.statuses.at(-1).value, undefined);
});

test("a malformed latest snapshot fails closed instead of restoring older waiting state", async () => {
  const validWaiting = {
    id: "goal-old", objective: "Do not resurrect", status: "waiting",
    automaticRuns: 2, repeatedToolFreeRuns: 0,
  };
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
