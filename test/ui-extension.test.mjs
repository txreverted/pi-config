import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import todoExtension from "../extensions/todo.ts";
import uiExtension from "../extensions/ui.ts";
import ponytailExtension from "../extensions/ponytail.ts";
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
  let branchReads = 0;
  const extensionStatuses = new Map();
  const entries = [{
    type: "message",
    message: { role: "assistant", usage: { cost: { total: 1.25 } } },
  }];
  let activeEntries = entries;
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    events: { on(event, handler) { busHandlers.set(event, handler); } },
  };
  uiExtension(pi);
  const ctx = {
    mode: "tui",
    cwd: "/tmp/project\u202e",
    model: { id: "model\u001b]0;unsafe\u0007", provider: "fixture", contextWindow: 128_000 },
    thinkingLevel: "high",
    modelRegistry: {
      getProvider: () => undefined,
      isUsingOAuth: () => false,
    },
    sessionManager: {
      getSessionName: () => undefined,
      getBranch() { branchReads++; return activeEntries; },
    },
    getContextUsage: () => contextUsage,
    ui: {
      setFooter(factory) {
        factory({}, theme(), {
          getGitBranch: () => "main\u001b[31m\u001b[0m",
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
  assert.ok(first.startsWith("\n<accent>π</accent>"));
  assert.match(first, /<muted>\?%\/128k \(auto\)<\/muted>/);
  assert.equal(first.split("〉").length - 1, 4);
  assert.match(first, /<accent>\/tmp\/project\(main\)<\/accent>/);
  assert.match(first, /<syntaxType>model \(high\)<\/syntaxType>/);
  assert.match(first, /<syntaxNumber>\$1\.250<\/syntaxNumber>/);
  assert.equal(second, first);
  assert.equal(branchReads, 2);

  for (const [percent, color] of [[70, "success"], [70.1, "warning"], [90, "warning"], [90.1, "error"]]) {
    contextUsage = { percent, contextWindow: 128_000 };
    assert.ok(widget.render(200).join("\n").includes(`<${color}>${percent.toFixed(1)}%/128k (auto)</${color}>`));
  }

  entries.push({ type: "message", message: { role: "assistant", usage: { cost: { total: 0.75 } } } });
  assert.match(widget.render(200).join("\n"), /\$2\.000/);
  extensionStatuses.set("goal", "goal: paused · 4/25 auto");
  extensionStatuses.set("ponytail", "\u001b]52;c;SGFja2Vk\u0007○ 🐴 ponytail: ⚡ FULL\u202e");
  assert.match(widget.render(200).join("\n"), /<customMessageLabel>goal: paused · 4\/25 auto<\/customMessageLabel>/);
  assert.match(widget.render(200).join("\n"), /<customMessageLabel>○ 🐴 ponytail: ⚡ FULL<\/customMessageLabel>/);
  assert.doesNotMatch(widget.render(200).join("\n"), /[\u001b\u0007\u202e]/);

  entries[0].message.usage.cost.total = 2.25;
  handlers.get("message_end")({}, ctx);
  assert.match(widget.render(200).join("\n"), /\$3\.000/);

  entries[0].message.usage.cost.total = 3.25;
  handlers.get("session_compact")({}, ctx);
  assert.match(widget.render(200).join("\n"), /\$4\.000/);

  activeEntries = [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } }];
  handlers.get("session_tree")({}, ctx);
  assert.match(widget.render(200).join("\n"), /\$0\.250/);
  assert.doesNotMatch(widget.render(200).join("\n"), /\$3\.000/);

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

test("custom UI and Ponytail compose in the complete extension order", async () => {
  const configRoot = mkdtempSync(join(tmpdir(), "pi-ui-ponytail-"));
  const previous = process.env.XDG_CONFIG_HOME;
  const previousHideStatus = process.env.PONYTAIL_HIDE_STATUS;
  const previousDefaultMode = process.env.PONYTAIL_DEFAULT_MODE;
  const previousQuietStartup = process.env.PONYTAIL_QUIET_STARTUP;
  process.env.XDG_CONFIG_HOME = configRoot;
  delete process.env.PONYTAIL_HIDE_STATUS;
  delete process.env.PONYTAIL_DEFAULT_MODE;
  delete process.env.PONYTAIL_QUIET_STARTUP;
  const lifecycle = new Map();
  const bus = new Map();
  const commands = new Map();
  const statuses = new Map();
  let statusWidget;
  const pi = {
    on(name, handler) {
      const handlers = lifecycle.get(name) ?? [];
      handlers.push(handler);
      lifecycle.set(name, handlers);
    },
    events: {
      on(name, handler) { bus.set(name, handler); },
      emit(name, value) { bus.get(name)?.(value); },
    },
    registerCommand(name, command) { commands.set(name, command); },
    appendEntry() {},
    sendUserMessage() {},
  };
  uiExtension(pi);
  ponytailExtension(pi);
  const ctx = {
    mode: "tui",
    cwd: "/tmp/project",
    model: { id: "model", provider: "fixture", contextWindow: 128_000 },
    thinkingLevel: "high",
    isIdle: () => true,
    getContextUsage: () => undefined,
    modelRegistry: { getProvider: () => undefined, isUsingOAuth: () => false },
    sessionManager: { getBranch: () => [], getSessionName: () => undefined },
    ui: {
      setFooter(factory) {
        factory({}, theme(), {
          getGitBranch: () => "main",
          getExtensionStatuses: () => statuses,
          onBranchChange: () => () => {},
        });
      },
      setHeader() {},
      setWidget(name, factory) { if (name === "minimal-status") statusWidget = factory?.({ requestRender() {} }, theme()); },
      setStatus(name, value) { if (value === undefined) statuses.delete(name); else statuses.set(name, value); },
      notify() {},
    },
  };

  try {
    for (const handler of lifecycle.get("session_start")) await handler({}, ctx);
    assert.match(statusWidget.render(200).join("\n"), /○ 🐴 ponytail: ⚡ FULL/);
    for (const handler of lifecycle.get("agent_start")) await handler({}, ctx);
    assert.match(statusWidget.render(200).join("\n"), /● 🐴 ponytail: ⚡ FULL/);
    statuses.set("unsafe", "safe\u001b]52;c;SGFja2Vk\u0007 status\u202e");
    const sanitized = statusWidget.render(200).join("\n");
    assert.match(sanitized, /safe status/);
    assert.doesNotMatch(sanitized, /[\u001b\u0007\u202e]|SGFja2Vk/);
    statuses.delete("unsafe");
    await commands.get("ponytail").handler("off", ctx);
    assert.doesNotMatch(statusWidget.render(200).join("\n"), /ponytail/);
    for (const handler of lifecycle.get("session_shutdown")) await handler({}, ctx);
    assert.equal(statuses.size, 0);

    process.env.PONYTAIL_HIDE_STATUS = "true";
    for (const handler of lifecycle.get("session_start")) await handler({}, ctx);
    assert.doesNotMatch(statusWidget.render(200).join("\n"), /ponytail/);
    for (const handler of lifecycle.get("session_shutdown")) await handler({}, ctx);
    assert.equal(statuses.size, 0);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousHideStatus === undefined) delete process.env.PONYTAIL_HIDE_STATUS;
    else process.env.PONYTAIL_HIDE_STATUS = previousHideStatus;
    if (previousDefaultMode === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
    else process.env.PONYTAIL_DEFAULT_MODE = previousDefaultMode;
    if (previousQuietStartup === undefined) delete process.env.PONYTAIL_QUIET_STARTUP;
    else process.env.PONYTAIL_QUIET_STARTUP = previousQuietStartup;
    rmSync(configRoot, { recursive: true, force: true });
  }
});
