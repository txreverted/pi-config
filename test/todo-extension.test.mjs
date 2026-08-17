import test from "node:test";
import assert from "node:assert/strict";
import todoExtension from "../extensions/todo.ts";
import { UI_PANEL_EVENT } from "../extensions/ui-core.ts";

function setup() {
  const tools = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const events = new Map();
  const panelUpdates = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); },
    on(name, handler) { events.set(name, handler); },
    events: { emit(name, data) { panelUpdates.push({ name, data }); } },
  };
  todoExtension(pi);
  return { tool: tools.get("todo"), commands, shortcuts, events, panelUpdates };
}

function context(branch = [], mode = "tui") {
  const notices = [];
  return {
    notices,
    value: {
      mode,
      sessionManager: { getBranch: () => branch },
      ui: {
        notify: (message, level) => notices.push({ message, level }),
      },
    },
  };
}

const resultEntry = (details) => ({
  type: "message",
  message: { role: "toolResult", toolName: "todo", details },
});

test("tool returns full snapshots and bounded list output in headless mode", async () => {
  const { tool, events } = setup();
  const headless = context([], "print");
  events.get("session_start")({}, headless.value);

  const created = await tool.execute("call", { action: "create", subject: "Write tests", status: "pending" });
  assert.equal(created.details.snapshot.tasks[0].subject, "Write tests");
  assert.equal(created.details.snapshot.nextId, 2);
  const listed = await tool.execute("call", { action: "list" });
  assert.match(listed.content[0].text, /#1 Write tests/);
  assert.ok(listed.content[0].text.length < 10_000);
  assert.deepEqual(listed.details.snapshot, created.details.snapshot);
});

test("session events restore the latest validated current-branch snapshot", async () => {
  const { tool, events } = setup();
  const first = { tasks: [{ id: 1, subject: "Old", status: "pending", blockedBy: [] }], nextId: 2 };
  const latest = { tasks: [{ id: 4, subject: "Current", status: "in_progress", blockedBy: [] }], nextId: 5 };
  const ctx = context([
    resultEntry({ action: "create", snapshot: first }),
    resultEntry({ action: "update", snapshot: { tasks: "invalid", nextId: 3 } }),
    resultEntry({ action: "update", snapshot: latest }),
  ]);

  for (const name of ["session_start", "session_tree", "session_compact"]) events.get(name)({}, ctx.value);
  const listed = await tool.execute("call", { action: "list" });
  assert.match(listed.content[0].text, /#4 Current/);
  assert.doesNotMatch(listed.content[0].text, /Old/);
});

test("a malformed final result retains the latest validated todo snapshot", async () => {
  const { tool, events } = setup();
  const valid = { tasks: [{ id: 1, subject: "Keep", status: "pending", blockedBy: [] }], nextId: 2 };
  const ctx = context([
    resultEntry({ action: "create", snapshot: valid }),
    resultEntry({ action: "update", snapshot: { tasks: "invalid", nextId: 3 } }),
  ]);

  events.get("session_start")({}, ctx.value);
  const listed = await tool.execute("call", { action: "list" });
  assert.match(listed.content[0].text, /#1 Keep/);
});

test("restoration keeps legacy blocked work by returning it to pending", async () => {
  const { tool, events } = setup();
  const legacy = {
    tasks: [
      { id: 1, subject: "Blocker", status: "pending", blockedBy: [] },
      { id: 2, subject: "Dependent", status: "in_progress", blockedBy: [1] },
    ],
    nextId: 3,
  };
  const ctx = context([resultEntry({ action: "update", snapshot: legacy })], "print");

  events.get("session_start")({}, ctx.value);
  const listed = await tool.execute("call", { action: "list" });
  assert.deepEqual(listed.details.snapshot.tasks.map(({ subject, status }) => ({ subject, status })), [
    { subject: "Blocker", status: "pending" },
    { subject: "Dependent", status: "pending" },
  ]);
});

test("todo publishes bounded logical panel content to the composite UI", async () => {
  const { tool, commands, shortcuts, events, panelUpdates } = setup();
  const ctx = context();
  events.get("session_start")({}, ctx.value);
  for (let index = 0; index < 10; index++) await tool.execute("call", { action: "create", subject: `Task ${index}` });
  await tool.execute("call", { action: "update", id: 1, status: "completed" });
  await tool.execute("call", { action: "update", id: 2, status: "in_progress", activeForm: "Working" });
  const mixedUpdate = panelUpdates.at(-1);
  assert.equal(mixedUpdate.name, UI_PANEL_EVENT);
  const mixed = mixedUpdate.data.render(80, { fg: (_color, text) => text });
  assert.deepEqual(mixed.slice(0, 4), [
    "Todos · 1/10 completed",
    " └─ ■ #2 Task 1 — Working",
    "    □ #3 Task 2",
    "    □ #4 Task 3",
  ]);

  await shortcuts.get("ctrl+shift+t").handler(ctx.value);
  const collapsed = panelUpdates.at(-1).data.render;
  assert.equal(collapsed(80, { fg: (_color, text) => text }).length, 1);
  await shortcuts.get("ctrl+shift+t").handler(ctx.value);

  for (let id = 1; id <= 10; id++) await tool.execute("call", { action: "update", id, status: "completed" });

  assert.deepEqual(panelUpdates.at(-1).data, { id: "todo" });
  assert.ok(panelUpdates.every((entry) => entry.name === UI_PANEL_EVENT));
  await commands.get("todos").handler("", ctx.value);
  assert.match(ctx.notices.at(-1).message, /Todos \(10\)/);
  assert.match(ctx.notices.at(-1).message, /#10 Task 9/);
  assert.equal(panelUpdates.at(-1).data.id, "todo");

  const headless = context([], "print");
  const beforeHeadless = panelUpdates.length;
  events.get("session_start")({}, headless.value);
  assert.equal(panelUpdates.length, beforeHeadless);
});
