import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ponytailExtension from "../extensions/ponytail.ts";
import { ponytailConfigPath } from "../extensions/ponytail-core.ts";

function createHarness() {
  const commands = new Map();
  const events = new Map();
  const entries = [];
  const messages = [];
  const pi = {
    registerCommand(name, options) { commands.set(name, options); },
    on(name, handler) { events.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
    sendUserMessage(text, options) { messages.push({ text, options }); },
  };
  ponytailExtension(pi);
  return { commands, events, entries, messages };
}

function createContext(branch = []) {
  const notices = [];
  const statuses = [];
  return {
    notices,
    statuses,
    context: {
      mode: "tui",
      isIdle: () => true,
      sessionManager: { getBranch: () => branch },
      ui: {
        notify: (message, level) => notices.push({ message, level }),
        setStatus: (name, value) => statuses.push({ name, value }),
        theme: { fg: (_color, value) => value },
      },
    },
  };
}

async function withEnvironment(run) {
  const root = mkdtempSync(join(tmpdir(), "pi-config-ponytail-extension-"));
  const names = ["XDG_CONFIG_HOME", "PONYTAIL_DEFAULT_MODE", "PONYTAIL_HIDE_STATUS", "PONYTAIL_QUIET_STARTUP"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.XDG_CONFIG_HOME = root;
  for (const name of names.slice(1)) delete process.env[name];
  try {
    return await run();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test("extension registers the complete local Ponytail command set", () => withEnvironment(() => {
  const { commands } = createHarness();
  assert.deepEqual([...commands.keys()].sort(), [
    "ponytail",
    "ponytail-audit",
    "ponytail-debt",
    "ponytail-gain",
    "ponytail-help",
    "ponytail-review",
  ]);
}));

test("session mode persists, injects filtered instructions, and updates internal status activity", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context, statuses } = createContext();
  await harness.events.get("session_start")({}, context);
  await harness.commands.get("ponytail").handler("ultra", context);

  assert.deepEqual(harness.entries.at(-1), { customType: "ponytail-mode", data: { mode: "ultra" } });
  const injected = await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context);
  assert.match(injected.systemPrompt, /^BASE\n\nPONYTAIL MODE ACTIVE — level: ultra/);
  assert.match(injected.systemPrompt, /challenge speculative requirements/i);
  assert.doesNotMatch(injected.systemPrompt, /Build the request, then mention/i);

  await harness.events.get("agent_start")({}, context);
  assert.match(statuses.at(-1).value, /^●.*ULTRA$/);
  assert.equal(harness.events.has("agent_end"), false);
  await harness.events.get("agent_settled")({}, context);
  assert.match(statuses.at(-1).value, /^○.*ULTRA$/);
}));

test("session tree navigation restores the selected branch mode", () => withEnvironment(async () => {
  const harness = createHarness();
  const branch = [{ type: "custom", customType: "ponytail-mode", data: { mode: "off" } }];
  const { context } = createContext(branch);
  await harness.events.get("session_start")({}, context);
  assert.equal(await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context), undefined);

  branch.length = 0;
  await harness.events.get("session_tree")({}, context);
  assert.match((await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context)).systemPrompt, /level: full/);

  branch.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await harness.events.get("session_tree")({}, context);
  assert.match((await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context)).systemPrompt, /level: ultra/);
}));

test("malformed optional config does not prevent extension registration", () => withEnvironment(async () => {
  const path = ponytailConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{broken");

  const harness = createHarness();
  const { context, notices } = createContext();
  await harness.events.get("session_start")({}, context);

  assert.ok(harness.commands.has("ponytail"));
  assert.match(notices.at(-1).message, /Could not load some Ponytail settings; using defaults/);
  assert.equal(notices.at(-1).level, "error");
  assert.match((await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context)).systemPrompt, /level: full/);

  process.env.PONYTAIL_DEFAULT_MODE = "off";
  const overridden = createHarness();
  const overriddenContext = createContext();
  await overridden.events.get("session_start")({}, overriddenContext.context);
  assert.equal(await overridden.events.get("before_agent_start")({ systemPrompt: "BASE" }, overriddenContext.context), undefined);
}));

test("standalone normal mode disables injection without matching ordinary prose", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context } = createContext();
  await harness.events.get("session_start")({}, context);
  const ordinary = await harness.events.get("input")({ source: "interactive", text: "add a normal mode toggle" }, context);
  assert.equal(ordinary, undefined);
  assert.ok(await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context));
  const deactivated = await harness.events.get("input")({ source: "interactive", text: "normal mode." }, context);
  assert.deepEqual(deactivated, { action: "handled" });
  assert.equal(await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context), undefined);
}));

test("active rules propagate into custom subagents", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context } = createContext();
  await harness.events.get("session_start")({}, context);

  const subagent = { toolName: "subagent", input: { tasks: [{ task: "Inspect the change" }] } };
  await harness.events.get("tool_call")(subagent, context);
  assert.match(subagent.input.tasks[0].task, /Active parent coding policy/);
  assert.match(subagent.input.tasks[0].task, /PONYTAIL MODE ACTIVE — level: full/);

  for (const tasks of [{}, [null], ["not-an-object"]]) {
    await assert.doesNotReject(async () => harness.events.get("tool_call")({ toolName: "subagent", input: { tasks } }, context));
  }

  await harness.commands.get("ponytail").handler("off", context);
  const disabled = { toolName: "subagent", input: { tasks: [{ task: "Leave unchanged" }] } };
  await harness.events.get("tool_call")(disabled, context);
  assert.equal(disabled.input.tasks[0].task, "Leave unchanged");
}));

test("skill aliases invoke local Pi skills with expansion enabled", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context } = createContext();
  await harness.commands.get("ponytail-review").handler("", context);
  assert.deepEqual(harness.messages, [{
    text: "/skill:ponytail-review",
    options: { expandPromptTemplates: true },
  }]);
}));
