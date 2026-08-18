import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ponytailExtension, { loadPonytailSkill } from "../extensions/ponytail.ts";
import { ponytailConfigPath } from "../extensions/ponytail-core.ts";

function createHarness() {
  const commands = new Map();
  const events = new Map();
  const entries = [];
  const messages = [];
  const statuses = [];
  const bus = new Map();
  const pi = {
    registerCommand(name, options) { commands.set(name, options); },
    on(name, handler) { events.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
    sendUserMessage(text, options) { messages.push({ text, options }); },
    events: {
      on(name, handler) { bus.set(name, handler); },
      emit(name, value) { bus.get(name)?.(value); },
    },
  };
  ponytailExtension(pi);
  return { commands, events, entries, messages, statuses };
}

function createContext(branch = [], statuses = [], idle = true) {
  const notices = [];
  return {
    notices,
    statuses,
    context: {
      mode: "tui",
      isIdle: () => idle,
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
  const names = ["XDG_CONFIG_HOME", "PONYTAIL_DEFAULT_MODE"];
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

test("extension registers only the Ponytail mode command", () => withEnvironment(() => {
  const { commands } = createHarness();
  assert.deepEqual([...commands.keys()], ["ponytail"]);
}));

test("Ponytail stays silent when the skill and settings load", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context, notices } = createContext([], harness.statuses);
  await harness.events.get("session_start")({}, context);
  assert.deepEqual(harness.statuses, []);
  assert.deepEqual(notices, []);
}));

test("skill load failures use the fallback and retain an error for the UI", () => {
  const skill = loadPonytailSkill(new URL("./missing-ponytail-skill.md", import.meta.url));
  assert.match(skill.body, /^# Ponytail/);
  assert.match(skill.error, /Could not load Ponytail skill; using fallback/);
});

test("session mode persists and injects isolated instructions without a status", () => withEnvironment(async () => {
  const harness = createHarness();
  const { context } = createContext([], harness.statuses);
  await harness.events.get("session_start")({}, context);
  await harness.commands.get("ponytail").handler("ultra", context);

  assert.deepEqual(harness.entries.at(-1), { customType: "ponytail-mode", data: { mode: "ultra" } });
  const injected = await harness.events.get("before_agent_start")({ systemPrompt: "BASE" }, context);
  assert.match(injected.systemPrompt, /^BASE\n\nPONYTAIL MODE ACTIVE - level: ultra/);
  assert.match(injected.systemPrompt, /challenge speculative requirements/i);
  assert.doesNotMatch(injected.systemPrompt, /Build the request, then mention/i);

  assert.deepEqual(harness.statuses, []);
  assert.equal(harness.events.has("agent_start"), false);
  assert.equal(harness.events.has("agent_settled"), false);
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

test("saving a default reports invalid environment overrides without claiming the write failed", () => withEnvironment(async () => {
  process.env.PONYTAIL_DEFAULT_MODE = "invalid";
  const harness = createHarness();
  const { context, notices } = createContext();
  await harness.commands.get("ponytail").handler("default lite", context);

  assert.equal(JSON.parse(readFileSync(ponytailConfigPath(), "utf8")).defaultMode, "lite");
  assert.equal(notices.at(-1).level, "warning");
  assert.match(notices.at(-1).message, /saved as lite.*effective default is invalid/i);
}));

test("command arguments provide mode completion", () => withEnvironment(() => {
  const harness = createHarness();
  const complete = harness.commands.get("ponytail").getArgumentCompletions;
  assert.deepEqual(complete("ult"), [{ value: "ultra", label: "ultra" }]);
  assert.deepEqual(complete("default f"), [{ value: "default full", label: "default full" }]);
  assert.equal(complete("missing"), null);
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
