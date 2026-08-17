import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import taskExtension from "../extensions/task.ts";
import { TASK_CHANGED_EVENT } from "../extensions/task-core.ts";
import { UI_PANEL_EVENT } from "../extensions/ui-core.ts";

function harness() {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const updates = [];
  const busEvents = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    events: { emit(name, data) { updates.push({ name, data }); }, on(name, handler) { busEvents.set(name, handler); } },
  };
  taskExtension(pi);
  return { tool: tools.get("task"), commands, events, updates, busEvents };
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
  assert.deepEqual(created.details, {
    action: "create", id: 1, version: 1, total: 1,
    counts: { pending: 1, inProgress: 0, completed: 0 },
  });
  assert.equal(h.tool.parameters.properties.owner.minLength, undefined);
  assert.match(h.tool.parameters.properties.owner.description, /empty string/);
  const claimed = await h.tool.execute("call", { action: "claim" }, undefined, undefined, ctx);
  assert.match(claimed.content[0].text, /Claimed .*#1 Shared work @main/);
  assert.equal(h.updates.at(-1).name, UI_PANEL_EVENT);
  assert.equal(h.updates.at(-1).data.id, "task");
  assert.match(h.updates.at(-1).data.render(80, { fg: (_color, text) => text })[0], /Tasks/);

  await h.commands.get("tasks").handler("", ctx);
  assert.match(notices.at(-1).message, /Tasks \(1\)/);
  assert.deepEqual([...h.commands.keys()], ["tasks"]);
});

test("task details and list output stay bounded at maximum metadata capacity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-task-bounds-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  const h = harness();
  const ctx = context([]);
  await h.events.get("session_start")({}, ctx);
  let last;
  for (let index = 0; index < 100; index++) {
    last = await h.tool.execute("create", {
      action: "create",
      subject: `Task ${index}`,
      owner: index === 0 ? "assigned-owner" : undefined,
      metadata: { value: "x".repeat(8_000) },
    }, undefined, undefined, ctx);
    assert.ok(Buffer.byteLength(JSON.stringify(last.details)) < 500);
  }
  const claimed = await h.tool.execute("claim", { action: "claim" }, undefined, undefined, ctx);
  assert.equal(claimed.details.id, 2, "main skips claim-next work assigned to another owner");
  const unassigned = await h.tool.execute("unassign", { action: "update", id: 1, owner: "" }, undefined, undefined, ctx);
  assert.equal(unassigned.details.id, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(unassigned.details)) < 500);

  const listed = await h.tool.execute("list", { action: "list" }, undefined, undefined, ctx);
  const output = listed.content[0].text;
  assert.ok(Buffer.byteLength(output) <= DEFAULT_MAX_BYTES);
  assert.ok(output.split("\n").length <= DEFAULT_MAX_LINES);
  assert.ok(Buffer.byteLength(JSON.stringify(listed.details)) < 500);

  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    await writeFile(join(root, "pi-config", "tasks", "fixture-session", "tasks.json"), "not json");
    assert.equal(h.busEvents.get(TASK_CHANGED_EVENT)(), undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
