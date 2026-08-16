import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentRegistry } from "../subagents/registry.ts";
import subagentsExtension, { safeSubagentDisplay, untrustedOutput } from "../extensions/subagents.ts";
import { MAX_SUBAGENT_TASKS } from "../extensions/subagents-core.ts";

const allowedTools = new Set([
  "read", "bash", "edit", "write", "grep", "find", "ls", "jq",
  "web_search", "web_fetch", "git_status", "git_diff",
]);

test("expanded subagent output strips terminal control sequences", () => {
  const tools = new Map();
  subagentsExtension({
    registerTool(value) { tools.set(value.name, value); },
    on() {},
  });
  assert.deepEqual([...tools.keys()], ["subagent", "get_subagent_result", "cancel_subagent"]);
  const tool = tools.get("subagent");
  const rendered = tool.renderResult({
    content: [{ type: "text", text: "safe\u001b]52;c;SGFja2Vk\u0007\u001b[31m red\u001b[0m\nnext" }],
  }, { expanded: true }, {}).render(120).join("\n");

  assert.match(rendered.split("\n").map((line) => line.trimEnd()).join("\n"), /safe red\nnext/);
  assert.doesNotMatch(rendered, /\u001b|\u0007|SGFja2Vk/);

  const plainTheme = {
    fg: (_color, value) => value,
    bold: (value) => value,
  };
  assert.equal(tool.renderShell, undefined);
  assert.match(tool.renderCall({}, plainTheme).render(120).join("\n"), /^Agents/);

  const collapsed = tool.renderResult({
    content: [{ type: "text", text: "unused" }],
    details: { progress: [{
      id: "task-1", agent: "reviewer", thinking: "high", status: "starting",
      startedAt: Date.now(), turns: 0, toolCalls: 0, text: "", usage: {},
      currentTool: "read\u001b]52;c;SGFja2Vk\u0007\nfake",
    }, {
      id: "task-2", agent: "researcher", thinking: "low", status: "queued",
      startedAt: Date.now(), turns: 0, toolCalls: 0, text: "", usage: {},
    }] },
  }, { expanded: false }, plainTheme, {
    args: { tasks: [
      { name: "Inspect current diff" },
      { name: "Research API" },
    ] },
  }).render(120).join("\n");
  assert.match(collapsed, / ├─ Review  Inspect current diff · 0 tool uses · 0 token · 0s/);
  assert.match(collapsed, / │   └ starting…/);
  assert.match(collapsed, / └─ 1 queued/);
  assert.doesNotMatch(collapsed, /reviewer\/high|task-1|\u001b|\u0007|SGFja2Vk|\nfake/);

  const now = Date.now();
  const live = tool.renderResult({
    content: [{ type: "text", text: "unused" }],
    details: { progress: [{
      id: "review", agent: "reviewer", thinking: "high", status: "done",
      startedAt: now - 360_000, endedAt: now, turns: 3, toolCalls: 49, text: "",
      usage: { totalTokens: 1_500_000 },
    }, {
      id: "research", agent: "researcher", thinking: "low", status: "running",
      startedAt: now - 82_000, turns: 2, toolCalls: 2, text: "",
      usage: { totalTokens: 13_100 }, activity: "searching",
    }, ...[1, 2, 3].map((id) => ({
      id: `queued-${id}`, agent: "reviewer", thinking: "high", status: "queued",
      startedAt: now, turns: 0, toolCalls: 0, text: "", usage: { totalTokens: 0 },
    }))] },
  }, { expanded: false }, plainTheme, {
    args: { tasks: [
      { name: "Review subagents" },
      { name: "Inspect repository" },
      { name: "Queued one" },
      { name: "Queued two" },
      { name: "Queued three" },
    ] },
  }).render(160).join("\n");
  assert.match(live, / ├─ Review  Review subagents · 49 tool uses · 1\.5M token · 6m00s/);
  assert.match(live, / │   └ done/);
  assert.match(live, / ├─ Research  Inspect repository · 2 tool uses · 13\.1k token · 1m2[12]s/);
  assert.match(live, / │   └ searching…/);
  assert.match(live, / └─ 3 queued/);

  const terminals = tool.renderResult({
    content: [{ type: "text", text: "unused" }],
    details: { progress: ["done", "stale", "bugged", "error"].map((status, index) => ({
      id: status, agent: "reviewer", thinking: "high", status,
      startedAt: now - 1_000, endedAt: now, turns: 1, toolCalls: index, text: "",
      usage: { totalTokens: 10 },
    })) },
  }, { expanded: false }, plainTheme, {
    args: { tasks: [
      { name: "Done task" },
      { name: "Stale task" },
      { name: "Bugged task" },
      { name: "Error task" },
    ] },
  }).render(120).join("\n");
  for (const status of ["done", "stale", "bugged", "error"]) {
    assert.match(terminals, new RegExp(`└ ${status}`));
  }

  const collected = tools.get("get_subagent_result").renderResult({
    content: [{ type: "text", text: "safe\u001b]52;c;SGFja2Vk\u0007 result" }],
  }).render(120).join("\n");
  assert.match(collected, /safe result/);
  assert.doesNotMatch(collected, /\u001b|\u0007|SGFja2Vk/);
  assert.equal(safeSubagentDisplay("left\u202eright\u2066end\u2069"), "leftrightend");
});

test("errored child stderr is returned as untrusted evidence", () => {
  const output = untrustedOutput([{
    id: "failed", agent: "reviewer", thinking: "high", status: "error",
    startedAt: 0, endedAt: 10, durationMs: 10, turns: 0, toolCalls: 0, text: "",
    task: "Review", cwd: process.cwd(), output: "partial result", stderr: "provider authentication failed",
    error: "Subagent exited with code 1", exitCode: 1, truncated: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }]);
  assert.match(output, /partial result/);
  assert.match(output, /\[stderr\]\nprovider authentication failed/);
  assert.match(output, /Subagent exited with code 1/);
});

test("writable workers require trust and exclusive foreground execution", async () => {
  const tools = new Map();
  subagentsExtension({
    registerTool(value) { tools.set(value.name, value); },
    on() {},
  });
  const tool = tools.get("subagent");
  const context = {
    cwd: process.cwd(),
    mode: "tui",
    model: { provider: "test", id: "model", reasoning: true },
  };

  await assert.rejects(() => tool.execute("call", {
    tasks: [{ name: "Too many words here", agent: "reviewer", task: "Review" }],
  }, undefined, undefined, {
    ...context,
    isProjectTrusted: () => true,
  }), /one to three words/);

  await assert.rejects(() => tool.execute("call", {
    tasks: [{ name: "Implement change", agent: "worker", task: "Implement the change" }],
  }, undefined, undefined, {
    ...context,
    isProjectTrusted: () => false,
  }), /trusted project/);

  await assert.rejects(() => tool.execute("call", {
    tasks: [{ name: "Implement change", agent: "worker", task: "Implement the change" }],
    background: true,
  }, undefined, undefined, {
    ...context,
    isProjectTrusted: () => true,
  }), /foreground only/);

  await assert.rejects(() => tool.execute("call", {
    tasks: [
      { name: "Implement change", agent: "worker", task: "Implement the change" },
      { name: "Review change", agent: "reviewer", task: "Review the change" },
    ],
  }, undefined, undefined, {
    ...context,
    isProjectTrusted: () => true,
  }), /only task in its batch/);

  await assert.rejects(() => tool.execute("call", {
    tasks: [{ name: "Review change", agent: "reviewer", task: "Review the change" }],
    background: true,
  }, undefined, undefined, {
    ...context,
    mode: "json",
    isProjectTrusted: () => true,
  }), /persistent TUI or RPC session/);
});

test("agent registry keeps specialist roles read-only and scopes the worker", () => {
  const agents = createAgentRegistry();
  assert.equal(MAX_SUBAGENT_TASKS, 3);
  assert.deepEqual([...agents.keys()], ["reviewer", "researcher", "worker"]);

  for (const agent of agents.values()) {
    assert.ok(agent.prompt.length > 0, agent.name);
    for (const budget of ["maxTurns", "maxToolCalls", "maxReportedTokens", "maxCostUsd", "timeoutMs"]) {
      assert.equal(budget in agent, false, `${agent.name}:${budget}`);
    }
    assert.ok((agent.extensions?.length ?? 0) > 0, agent.name);
    assert.equal(typeof agent.mutatesWorkspace, "boolean", agent.name);
    for (const tool of agent.tools) assert.ok(allowedTools.has(tool), `${agent.name}:${tool}`);
  }

  const reviewer = agents.get("reviewer");
  assert.deepEqual(reviewer.tools, ["read", "grep", "find", "ls", "git_status", "git_diff"]);
  assert.match(reviewer.extensions[0], /extensions[/\\]subagent-tools\.ts$/);
  assert.equal(reviewer.contextFiles, true);
  assert.equal(reviewer.thinking, "high");
  assert.equal(reviewer.mutatesWorkspace, false);

  const researcher = agents.get("researcher");
  assert.deepEqual(researcher.tools, ["web_search", "web_fetch"]);
  assert.match(researcher.extensions[0], /extensions[/\\]web\.ts$/);
  assert.equal(researcher.contextFiles, false);
  assert.equal(researcher.thinking, "low");
  assert.equal(researcher.mutatesWorkspace, false);

  const worker = agents.get("worker");
  assert.deepEqual(worker.tools, [
    "read", "bash", "edit", "write", "grep", "find", "ls", "jq", "web_search", "web_fetch",
  ]);
  assert.match(worker.extensions[0], /extensions[/\\]tools\.ts$/);
  assert.match(worker.extensions[1], /extensions[/\\]web\.ts$/);
  assert.equal(worker.contextFiles, true);
  assert.equal(worker.thinking, "medium");
  assert.equal(worker.mutatesWorkspace, true);
});

test("subagent tools are disabled in descendant Pi processes", () => {
  const original = process.env.PI_CONFIG_SUBAGENT_CHILD;
  const tools = [];
  try {
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    subagentsExtension({ registerTool(tool) { tools.push(tool.name); } });
    assert.deepEqual(tools, []);
  } finally {
    if (original === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD;
    else process.env.PI_CONFIG_SUBAGENT_CHILD = original;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for background subagent");
    await sleep(10);
  }
}

test("background extension launches, renders, notifies, collects, and evicts", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagent-extension-"));
  const executable = join(root, "pi");
  const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
  const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
  const originalPath = process.env.PATH;
  const originalMode = process.env.FAKE_PI_MODE;
  const originalDelay = process.env.FAKE_PI_DELAY_MS;
  let shutdown;

  try {
    await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
    await chmod(executable, 0o700);
    process.env.PATH = `${root}${delimiter}${originalPath ?? ""}`;
    process.env.FAKE_PI_MODE = "tool";
    process.env.FAKE_PI_DELAY_MS = "120";

    const tools = new Map();
    const events = new Map();
    const messages = [];
    const widgetFactories = [];
    const dockEvents = [];
    subagentsExtension({
      registerTool(value) { tools.set(value.name, value); },
      on(event, handler) { events.set(event, handler); },
      sendMessage(message, options) { messages.push({ message, options }); },
      events: { emit(name) { dockEvents.push(name); } },
    });
    shutdown = () => events.get("session_shutdown")?.();

    const context = {
      cwd: root,
      mode: "tui",
      model: { provider: "fixture", id: "test-model", reasoning: true },
      isProjectTrusted: () => true,
      ui: {
        setWidget(_name, factory, options) {
          if (factory) widgetFactories.push({ factory, options });
        },
      },
    };
    events.get("session_start")({}, context);

    const started = await tools.get("subagent").execute("call", {
      tasks: [
        { name: "Review lifecycle", agent: "reviewer", task: "Review background lifecycle integration now" },
        { name: "Review cleanup", agent: "reviewer", task: "Review background cleanup integration now" },
      ],
      background: true,
    }, undefined, undefined, context);
    const ids = started.details.progress.map((entry) => entry.id);
    assert.equal(ids.length, 2);
    assert.ok(ids.every(Boolean));
    assert.ok(widgetFactories.length > 0);

    const plainTheme = { fg: (_color, value) => value, bold: (value) => value };
    assert.deepEqual(widgetFactories.at(-1).options, { placement: "aboveEditor" });
    assert.ok(dockEvents.length > 0);
    const widget = widgetFactories.at(-1).factory({}, plainTheme).render(160)
      .map((line) => line.trimEnd()).join("\n");
    assert.match(widget, /^ Agents\n  ├─ Review  Review lifecycle · 0 tool uses · 0 token · 0s/);

    await waitFor(() => messages.length > 0);
    await sleep(150);
    assert.equal(messages.length, 1);
    for (const id of ids) assert.match(messages[0].message.content, new RegExp(id));
    assert.deepEqual(messages[0].message.details.results.map((result) => result.status), ["done", "done"]);
    assert.deepEqual(messages[0].options, { deliverAs: "followUp", triggerTurn: true });

    for (const id of ids) {
      const collected = await tools.get("get_subagent_result").execute("collect", { id }, undefined);
      assert.match(collected.content[0].text, /fixture completed/);
      assert.equal(collected.usage.totalTokens, 17);
      await assert.rejects(
        () => tools.get("get_subagent_result").execute("collect-again", { id }, undefined),
        /Unknown background subagent id/,
      );
    }
  } finally {
    await shutdown?.();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalMode === undefined) delete process.env.FAKE_PI_MODE;
    else process.env.FAKE_PI_MODE = originalMode;
    if (originalDelay === undefined) delete process.env.FAKE_PI_DELAY_MS;
    else process.env.FAKE_PI_DELAY_MS = originalDelay;
    await rm(root, { recursive: true, force: true });
  }
});
