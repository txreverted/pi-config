import test from "node:test";
import assert from "node:assert/strict";
import todoExtension from "../extensions/todo.ts";
import { STATUS_WIDGET_DOCK_EVENT } from "../extensions/ui-core.ts";

function setup() {
  const tools = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const events = new Map();
  const dockEvents = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); },
    on(name, handler) { events.set(name, handler); },
    events: { emit(name) { dockEvents.push(name); } },
  };
  todoExtension(pi);
  return { tool: tools.get("todo"), commands, shortcuts, events, dockEvents };
}

function context(branch = [], mode = "tui") {
  const widgets = [];
  const notices = [];
  return {
    widgets,
    notices,
    value: {
      mode,
      sessionManager: { getBranch: () => branch },
      ui: {
        setWidget: (name, widget, options) => widgets.push({ name, widget, options }),
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

test("widget stays above the status and input after all todos complete", async () => {
  const { tool, commands, shortcuts, events, dockEvents } = setup();
  const ctx = context();
  events.get("session_start")({}, ctx.value);
  for (let index = 0; index < 10; index++) await tool.execute("call", { action: "create", subject: `Task ${index}` });
  await tool.execute("call", { action: "update", id: 1, status: "completed" });
  await tool.execute("call", { action: "update", id: 2, status: "in_progress", activeForm: "Working" });
  const mixed = ctx.widgets.at(-1).widget({}, { fg: (_color, text) => text }).render(80);
  assert.deepEqual(mixed.slice(0, 4), [
    " Todos · 1/10 completed",
    " └─ ☒ #1 Task 0",
    "    ■ #2 Task 1 — Working",
    "    □ #3 Task 2",
  ]);

  for (let id = 1; id <= 10; id++) await tool.execute("call", { action: "update", id, status: "completed" });

  const expandedEntry = ctx.widgets.at(-1);
  const expanded = expandedEntry.widget({}, { fg: (_color, text) => text });
  assert.ok(expanded.render(80).length <= 8);
  assert.match(expanded.render(80)[0], /Todos · 10\/10 completed/);
  assert.deepEqual(expandedEntry.options, { placement: "aboveEditor" });
  assert.ok(dockEvents.length > 0);
  assert.ok(dockEvents.every((name) => name === STATUS_WIDGET_DOCK_EVENT));
  await shortcuts.get("ctrl+shift+t").handler(ctx.value);
  const collapsed = ctx.widgets.at(-1).widget({}, { fg: (_color, text) => text });
  assert.equal(collapsed.render(80).length, 1);
  await commands.get("todos").handler("", ctx.value);
  assert.match(ctx.notices.at(-1).message, /Todos \(10\)/);
  assert.match(ctx.notices.at(-1).message, /#10 Task 9/);
  assert.ok(ctx.widgets.filter((entry) => entry.widget).every((entry) => entry.options?.placement === "aboveEditor"));

  const headless = context([], "print");
  events.get("session_start")({}, headless.value);
  assert.equal(headless.widgets.length, 0);
});
