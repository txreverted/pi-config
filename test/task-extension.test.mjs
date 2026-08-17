import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import taskExtension from "../extensions/task.ts";
import { UI_PANEL_EVENT } from "../extensions/ui-core.ts";

function harness() {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const updates = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    events: { emit(name, data) { updates.push({ name, data }); }, on() {} },
  };
  taskExtension(pi);
  return { tool: tools.get("task"), commands, events, updates };
}

function context(notices) {
  return {
    mode: "tui",
    sessionManager: { getSessionId: () => "fixture-session" },
    ui: { notify: (message, level) => notices.push({ message, level }) },
  };
}

test("task extension registers one collaborative tool, /tasks, and a composite panel", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-task-extension-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousChild = process.env.PI_CONFIG_SUBAGENT_CHILD;
  const previousOwner = process.env.PI_CONFIG_TASK_OWNER;
  process.env.PI_CODING_AGENT_DIR = root;
  delete process.env.PI_CONFIG_SUBAGENT_CHILD;
  delete process.env.PI_CONFIG_TASK_OWNER;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousChild === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD;
    else process.env.PI_CONFIG_SUBAGENT_CHILD = previousChild;
    if (previousOwner === undefined) delete process.env.PI_CONFIG_TASK_OWNER;
    else process.env.PI_CONFIG_TASK_OWNER = previousOwner;
    await rm(root, { recursive: true, force: true });
  });

  const h = harness();
  const notices = [];
  const ctx = context(notices);
  await h.events.get("session_start")({}, ctx);
  const created = await h.tool.execute("call", { action: "create", subject: "Shared work" }, undefined, undefined, ctx);
  assert.equal(created.details.snapshot.tasks[0].owner, undefined);
  const claimed = await h.tool.execute("call", { action: "claim" }, undefined, undefined, ctx);
  assert.match(claimed.content[0].text, /Claimed .*#1 Shared work @main/);
  assert.equal(h.updates.at(-1).name, UI_PANEL_EVENT);
  assert.equal(h.updates.at(-1).data.id, "task");
  assert.match(h.updates.at(-1).data.render(80, { fg: (_color, text) => text })[0], /Tasks/);

  await h.commands.get("tasks").handler("", ctx);
  assert.match(notices.at(-1).message, /Tasks \(1\)/);
  assert.deepEqual([...h.commands.keys()], ["tasks"]);
});
