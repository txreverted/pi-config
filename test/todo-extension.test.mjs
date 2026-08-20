import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import todoExtension from "../extensions/todo.ts";

function setup() {
  const tools = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const events = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); },
    on(name, handler) { events.set(name, handler); },
  };
  todoExtension(pi);
  return { tool: tools.get("todo"), commands, shortcuts, events };
}

function context(branch = [], mode = "tui") {
  const notices = [];
  const widgets = [];
  return {
    notices,
    widgets,
    value: {
      mode,
      sessionManager: { getBranch: () => branch },
      ui: {
        notify: (message, level) => notices.push({ message, level }),
        setWidget: (name, factory, options) => widgets.push({ name, factory, options }),
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

test("todo output labels dependencies without claiming completed tasks still block", async () => {
  const { tool, events } = setup();
  const headless = context([], "print");
  events.get("session_start")({}, headless.value);

  await tool.execute("call", { action: "create", subject: "Prepare" });
  await tool.execute("call", { action: "create", subject: "Use result", blockedBy: [1] });
  await tool.execute("call", { action: "update", id: 1, status: "completed" });
  await tool.execute("call", { action: "update", id: 2, status: "in_progress" });
  const listed = await tool.execute("call", { action: "list" });
  assert.match(listed.content[0].text, /☒ #1 Prepare/);
  assert.match(listed.content[0].text, /■ #2 Use result depends on #1/);
  assert.doesNotMatch(listed.content[0].text, /blocked by #1/);
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

test("todo publishes a bounded native Pi widget", async () => {
  const { tool, commands, shortcuts, events } = setup();
  assert.equal(shortcuts.size, 0);
  const ctx = context();
  events.get("session_start")({}, ctx.value);
  for (let index = 0; index < 10; index++) await tool.execute("call", { action: "create", subject: `Task ${index}` });
  await tool.execute("call", { action: "update", id: 1, status: "completed" });
  await tool.execute("call", { action: "update", id: 10, status: "in_progress", activeForm: "Working" });
  const mixedUpdate = ctx.widgets.at(-1);
  assert.equal(mixedUpdate.name, "pi-config-todo");
  assert.equal(mixedUpdate.options.placement, "aboveEditor");
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const mixed = mixedUpdate.factory({ terminal: { rows: 30 } }, theme).render(80);
  assert.deepEqual(mixed.slice(0, 4), [
    " Todos: 1/10 completed",
    "  ├─ ■ #10 Task 9 · Working",
    "  ├─ □ #2 Task 1",
    "  ├─ □ #3 Task 2",
  ]);
  assert.equal(mixed.at(-1), "  └─ 3 more");

  for (const rows of [4, 9, 12]) {
    for (const width of [1, 12, 80]) {
      const short = mixedUpdate.factory({ terminal: { rows } }, theme).render(width);
      assert.ok(short.length <= Math.max(1, rows - 8));
      assert.ok(short.every((line) => visibleWidth(line) <= width));
    }
  }

  for (let id = 1; id <= 10; id++) await tool.execute("call", { action: "update", id, status: "completed" });
  assert.deepEqual(ctx.widgets.at(-1), { name: "pi-config-todo", factory: undefined, options: undefined });
  await commands.get("todos").handler("", ctx.value);
  assert.match(ctx.notices.at(-1).message, /Todos \(10\)/);
  assert.match(ctx.notices.at(-1).message, /#10 Task 9/);

  const headless = context([], "print");
  events.get("session_start")({}, headless.value);
  assert.equal(headless.widgets.length, 0);
});
