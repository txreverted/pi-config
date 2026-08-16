import test from "node:test";
import assert from "node:assert/strict";
import todoExtension from "../extensions/todo.ts";
import uiExtension from "../extensions/ui.ts";
import { STATUS_WIDGET_DOCK_EVENT } from "../extensions/ui-core.ts";

function theme() {
  return {
    fg: (color, value) => `<${color}>${value}</${color}>`,
    bold: (value) => value,
  };
}

test("status widget renders unknown context honestly and caches unchanged session cost", () => {
  const handlers = new Map();
  const busHandlers = new Map();
  const widgetCalls = [];
  let widgetFactory;
  let contextUsage;
  let entryReads = 0;
  const extensionStatuses = new Map();
  const entries = [{
    type: "message",
    message: { role: "assistant", usage: { cost: { total: 1.25 } } },
  }];
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    events: { on(event, handler) { busHandlers.set(event, handler); } },
  };
  uiExtension(pi);
  const ctx = {
    mode: "tui",
    cwd: "/tmp/project",
    model: { id: "model", provider: "fixture", contextWindow: 128_000 },
    thinkingLevel: "high",
    modelRegistry: {
      getProvider: () => undefined,
      isUsingOAuth: () => false,
    },
    sessionManager: {
      getSessionName: () => undefined,
      getEntries() { entryReads++; return entries; },
    },
    getContextUsage: () => contextUsage,
    ui: {
      setFooter(factory) {
        factory({}, theme(), {
          getGitBranch: () => "main",
          getExtensionStatuses: () => extensionStatuses,
          onBranchChange: () => () => {},
        });
      },
      setHeader() {},
      setWidget(name, factory, options) {
        widgetFactory = factory;
        widgetCalls.push({ name, factory, options });
      },
    },
  };

  handlers.get("session_start")({}, ctx);
  assert.deepEqual(widgetCalls.at(-1).options, { placement: "aboveEditor" });
  busHandlers.get(STATUS_WIDGET_DOCK_EVENT)();
  assert.equal(widgetCalls.length, 2);
  assert.equal(widgetCalls.at(-1).name, "minimal-status");
  assert.deepEqual(widgetCalls.at(-1).options, { placement: "aboveEditor" });
  const widget = widgetFactory({ requestRender() {} }, theme());
  const first = widget.render(200).join("\n");
  const second = widget.render(200).join("\n");
  assert.ok(first.startsWith("<accent>π</accent>"));
  assert.match(first, /<muted>\?%\/128k \(auto\)<\/muted>/);
  assert.equal(first.split("〉").length - 1, 4);
  assert.match(first, /<accent>\/tmp\/project\(main\)<\/accent>/);
  assert.match(first, /<syntaxType>model \(high\)<\/syntaxType>/);
  assert.match(first, /<syntaxNumber>\$1\.250<\/syntaxNumber>/);
  assert.equal(second, first);
  assert.equal(entryReads, 2);

  for (const [percent, color] of [[70, "success"], [70.1, "warning"], [90, "warning"], [90.1, "error"]]) {
    contextUsage = { percent, contextWindow: 128_000 };
    assert.ok(widget.render(200).join("\n").includes(`<${color}>${percent.toFixed(1)}%/128k (auto)</${color}>`));
  }

  entries.push({ type: "message", message: { role: "assistant", usage: { cost: { total: 0.75 } } } });
  assert.match(widget.render(200).join("\n"), /\$2\.000/);
  extensionStatuses.set("goal", "goal: paused · 4/25 auto");
  assert.match(widget.render(200).join("\n"), /<customMessageLabel>goal: paused · 4\/25 auto<\/customMessageLabel>/);

  handlers.get("agent_start")({}, ctx);
  assert.match(widget.render(200).join("\n"), /<customMessageLabel>0s<\/customMessageLabel>/);
  handlers.get("agent_settled")();
  widget.dispose();
  handlers.get("session_shutdown")();
});

test("todo updates stay above the status line and never below the input", async () => {
  const lifecycle = new Map();
  const bus = new Map();
  const tools = new Map();
  const widgetsAbove = new Map();
  const widgetsBelow = new Map();
  const pi = {
    on(event, handler) {
      const handlers = lifecycle.get(event) ?? [];
      handlers.push(handler);
      lifecycle.set(event, handlers);
    },
    events: {
      on(event, handler) { bus.set(event, handler); },
      emit(event, data) { bus.get(event)?.(data); },
    },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
  };
  uiExtension(pi);
  todoExtension(pi);

  const ctx = {
    mode: "tui",
    cwd: "/tmp/project",
    model: { id: "model", provider: "fixture", contextWindow: 128_000 },
    thinkingLevel: "high",
    modelRegistry: { getProvider: () => undefined, isUsingOAuth: () => false },
    sessionManager: {
      getBranch: () => [],
      getEntries: () => [],
      getSessionName: () => undefined,
    },
    getContextUsage: () => undefined,
    ui: {
      setFooter(factory) {
        factory({}, theme(), {
          getGitBranch: () => "main",
          getExtensionStatuses: () => new Map(),
          onBranchChange: () => () => {},
        });
      },
      setHeader() {},
      setWidget(name, content, options) {
        widgetsAbove.delete(name);
        widgetsBelow.delete(name);
        if (content !== undefined) {
          (options?.placement === "belowEditor" ? widgetsBelow : widgetsAbove).set(name, content);
        }
      },
      notify() {},
    },
  };

  for (const handler of lifecycle.get("session_start")) await handler({}, ctx);
  await tools.get("todo").execute("create", { action: "create", subject: "Sticky task" });
  assert.deepEqual([...widgetsAbove.keys()], ["todos", "minimal-status"]);
  assert.deepEqual([...widgetsBelow.keys()], []);

  for (const handler of lifecycle.get("session_shutdown")) await handler({}, ctx);
});
