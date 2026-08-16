import test from "node:test";
import assert from "node:assert/strict";
import goalExtension from "../extensions/goal.ts";

function harness(branch = []) {
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
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    abort: () => { aborts++; },
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus: (name, value) => statuses.push({ name, value }),
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

async function response(h, text, { tokens = 10, tool = false } = {}) {
  await h.events.get("agent_start")({}, h.context);
  if (tool) await h.events.get("tool_execution_start")({}, h.context);
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

  await h.commands.get("goal").handler("Implement safely --tokens 100k", h.context);
  assert.ok(["goal_complete", "goal_blocked", "goal_wait"].every((name) => h.active().includes(name)));
  assert.match(h.messages[0], /untrusted task data/);
  assert.match(h.messages[0], /goal_id:/);
  const injected = await h.events.get("before_agent_start")({ systemPrompt: "BASE" }, h.context);
  assert.match(injected.systemPrompt, /JSON string/);
  assert.match(h.statuses.at(-1).value, /goal: active/);
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
    await h.events.get("agent_start")({}, h.context);
    await h.events.get("message_end")({ message: { ...assistant("stopped"), stopReason } }, h.context);
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 1);
    assert.match(h.statuses.at(-1).value, /paused/);
    assert.ok(!h.active().includes("goal_complete"));
  }
});

test("token budget permits one-response overshoot and response 26 is never dispatched", async () => {
  const budget = harness();
  await budget.events.get("session_start")({}, budget.context);
  await budget.commands.get("goal").handler("Budgeted --tokens 100", budget.context);
  await response(budget, "initial", { tokens: 10, tool: true });
  assert.equal(budget.messages.length, 2);
  await response(budget, "overshoot", { tokens: 120, tool: true });
  assert.equal(budget.messages.length, 2);
  assert.match(budget.statuses.at(-1).value, /paused/);

  const capped = harness();
  await capped.events.get("session_start")({}, capped.context);
  await capped.commands.get("goal").handler("Bounded", capped.context);
  await response(capped, "initial", { tool: true });
  for (let index = 0; index < 25; index++) await response(capped, `automatic ${index}`, { tool: true });
  assert.equal(capped.messages.length, 26, "one kickoff plus exactly 25 automatic prompts");
  assert.match(capped.statuses.at(-1).value, /paused/);
  await capped.commands.get("goal").handler("resume", capped.context);
  assert.equal(capped.messages.length, 27, "resume starts a user-confirmed fresh safety epoch");
  assert.equal(capped.entries.at(-1).data.goal.automaticResponses, 0);
});

test("blocker requires the same report on three separate automatic runs and rejects stale ids", async () => {
  const h = harness();
  await h.events.get("session_start")({}, h.context);
  await h.commands.get("goal").handler("Hard goal", h.context);
  const id = h.entries.at(-1).data.goal.id;
  await assert.rejects(
    h.tools.get("goal_blocked").execute("x", { goal_id: id, reason: "claimed", evidence: "none", repeated_turns: 99 }),
    /only during an automatic/,
  );
  for (const name of ["goal_complete", "goal_wait", "goal_blocked"]) {
    const params = name === "goal_complete"
      ? { goal_id: "stale", summary: "done" }
      : name === "goal_wait"
        ? { goal_id: "stale", reason: "wait" }
        : { goal_id: "stale", reason: "blocked", evidence: "proof", repeated_turns: 3 };
    await assert.rejects(h.tools.get(name).execute("x", params), /Stale goal_id; no state was changed/);
  }

  await response(h, "initial", { tool: true });
  const report = async (reason, expected) => {
    await h.events.get("agent_start")({}, h.context);
    await h.events.get("tool_execution_start")({}, h.context);
    const call = h.tools.get("goal_blocked").execute("x", {
      goal_id: id,
      reason,
      evidence: "verified",
      repeated_turns: 3,
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
    paused.tools.get("goal_complete").execute("x", { goal_id: pausedId, summary: "done" }),
    /not active/,
  );

  const waiting = harness();
  await waiting.events.get("session_start")({}, waiting.context);
  await waiting.commands.get("goal").handler("Wait safely", waiting.context);
  const waitingId = waiting.entries.at(-1).data.goal.id;
  await waiting.events.get("agent_start")({}, waiting.context);
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
    await h.events.get("agent_start")({}, h.context);
    await h.tools.get("goal_wait").execute("x", { goal_id: id, reason: "timer", resume_after_ms: 10 });
    await h.events.get("agent_settled")({}, h.context);
    assert.equal(h.messages.length, 1);
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 2);
    assert.match(h.statuses.at(-1).value, /active/);
    assert.ok(h.active().includes("goal_complete"));
    t.mock.timers.tick(10);
    assert.equal(h.messages.length, 2, "deadline is single-shot");
    await h.events.get("session_shutdown")({}, h.context);
  } finally {
    t.mock.timers.reset();
  }
});

test("branch restore pauses active goals, preserves waiting goals, and clears timers on shutdown", async () => {
  const base = {
    id: "goal-restored", objective: "Restore me", status: "active", tokensUsed: 4,
    automaticResponses: 2, automaticRuns: 2, repeatedToolFreeRuns: 0,
  };
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
