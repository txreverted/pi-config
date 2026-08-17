import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CURSOR_MARKER,
  KeybindingsManager,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import uiExtension, { UtilityEditor } from "../extensions/ui.ts";
import {
  UI_MODE_STATUS_EVENT,
  UI_PANEL_EVENT,
  UI_WIDGET_NAME,
  isVisuallyBlank,
} from "../extensions/ui-core.ts";

const plainTheme = {
  fg: (_color, value) => value,
  bold: (value) => value,
};

const editorTheme = {
  borderColor: (value) => value,
  selectList: {
    selectedPrefix: (value) => value,
    selectedText: (value) => value,
    description: (value) => value,
    scrollInfo: (value) => value,
    noMatch: (value) => value,
  },
};

function createHarness() {
  const lifecycle = new Map();
  const bus = new Map();
  const widgetCalls = [];
  const widgets = new Map();
  let editorFactory;
  let header;
  let footer;
  let branch = "branch";
  let branchListener = () => {};
  let contextUsage = { percent: 0, contextWindow: 272_000 };
  let subscription = true;
  let activeEntries = [];
  let renders = 0;

  const pi = {
    on(name, handler) {
      const handlers = lifecycle.get(name) ?? [];
      handlers.push(handler);
      lifecycle.set(name, handlers);
    },
    events: {
      on(name, handler) {
        const handlers = bus.get(name) ?? [];
        handlers.push(handler);
        bus.set(name, handlers);
      },
      emit(name, data) {
        for (const handler of bus.get(name) ?? []) handler(data);
      },
    },
  };
  const ctx = {
    mode: "tui",
    cwd: join(homedir(), "Documents", "pi-config"),
    model: { id: "gpt-5.6-sol", provider: "fixture", contextWindow: 272_000 },
    thinkingLevel: "xhigh",
    modelRegistry: {
      getProvider: () => ({ auth: { oauth: { isSubscription: subscription } } }),
      isUsingOAuth: () => subscription,
    },
    sessionManager: {
      getBranch: () => activeEntries,
    },
    getContextUsage: () => contextUsage,
    ui: {
      theme: plainTheme,
      setFooter(factory) {
        footer = factory({}, plainTheme, {
          getGitBranch: () => branch,
          getExtensionStatuses: () => new Map(),
          onBranchChange(callback) {
            branchListener = callback;
            return () => { branchListener = () => {}; };
          },
        });
      },
      setHeader(factory) { header = factory({}, plainTheme); },
      setEditorComponent(factory) { editorFactory = factory; },
      setWidget(name, factory, options) {
        widgetCalls.push({ name, factory, options });
        if (factory === undefined) widgets.delete(name);
        else widgets.set(name, { factory, options });
      },
    },
  };
  const tui = {
    terminal: { rows: 24, columns: 220 },
    requestRender() { renders++; },
  };

  return {
    pi,
    ctx,
    tui,
    lifecycle,
    widgetCalls,
    widgets,
    start() {
      for (const handler of lifecycle.get("session_start") ?? []) handler({}, ctx);
    },
    emit(name, event = {}) {
      for (const handler of lifecycle.get(name) ?? []) handler(event, ctx);
    },
    editor() {
      return editorFactory(tui, editorTheme, new KeybindingsManager({}));
    },
    header: () => header,
    footer: () => footer,
    setBranch(value) { branch = value; branchListener(); },
    setContextUsage(value) { contextUsage = value; },
    setSubscription(value) { subscription = value; },
    setEntries(value) { activeEntries = value; },
    renders: () => renders,
  };
}

test("editor utility follows the fixed schema, active branch, auth, context, and response timer", () => {
  const h = createHarness();
  uiExtension(h.pi);
  h.start();
  const editor = h.editor();

  assert.deepEqual(h.header().render(), []);
  assert.deepEqual(h.footer().render(), []);
  assert.equal(
    stripTerminalSequences(editor.render(220)[0]).trimEnd(),
    " π v0.84.2 〉~/Documents/pi-config(branch) 〉gpt-5.6-sol (xhigh) 〉0.0%/272k (auto) 〉$0.000 (sub) 〉0s",
  );

  h.setEntries([{ type: "message", message: { role: "assistant", usage: { cost: { total: 1.25 } } } }]);
  h.emit("message_end");
  assert.match(stripTerminalSequences(editor.render(220)[0]), /\$1\.250 \(sub\)/);
  h.setEntries([{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } }]);
  h.emit("session_tree");
  assert.match(stripTerminalSequences(editor.render(220)[0]), /\$0\.250 \(sub\)/);
  assert.doesNotMatch(stripTerminalSequences(editor.render(220)[0]), /\$1\.250/);

  h.setBranch("feature\u001b]52;c;bad\u0007\u202e");
  assert.match(stripTerminalSequences(editor.render(220)[0]), /pi-config\(feature\)/);
  assert.doesNotMatch(editor.render(220)[0], /bad|\u202e/);
  h.setContextUsage(undefined);
  h.setSubscription(false);
  const api = stripTerminalSequences(editor.render(220).join("\n"));
  assert.match(api, /\?%\/272k \(auto\)/);
  assert.match(api, /\$0\.250 \(api\)/);

  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    h.emit("agent_start");
    now += 90_000;
    assert.match(stripTerminalSequences(editor.render(220).join("\n")), /1m30/);
    h.emit("agent_settled");
    assert.match(stripTerminalSequences(editor.render(220).join("\n")), /0s/);
  } finally {
    Date.now = realNow;
    h.emit("session_shutdown");
  }
  assert.ok(h.renders() > 0);
});

test("one composite above-editor widget orders panels and modes with one blank row", () => {
  const h = createHarness();
  uiExtension(h.pi);
  h.start();

  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail", text: "○ ponytail\u001b]52;c;bad\u0007" });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "subagents", render: () => ["Agents", "  └─ Review"] });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "task", render: () => ["Tasks", " └─ Shared"] });
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "goal", text: "goal: active · 3 auto" });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "todo", render: () => ["Todos", "", "", " └─ Task"] });

  assert.deepEqual([...h.widgets.keys()], [UI_WIDGET_NAME]);
  assert.ok(h.widgetCalls.filter((call) => call.factory).every((call) => call.name === UI_WIDGET_NAME));
  assert.ok(h.widgetCalls.filter((call) => call.factory).every((call) => call.options?.placement === "aboveEditor"));
  assert.equal(h.widgetCalls.some((call) => call.options?.placement === "belowEditor"), false);

  const widget = h.widgets.get(UI_WIDGET_NAME);
  const lines = widget.factory(h.tui, plainTheme).render(100);
  assert.deepEqual(lines, [
    " Todos",
    " ",
    "  └─ Task",
    " ",
    " Tasks",
    "  └─ Shared",
    " ",
    " Agents",
    "   └─ Review",
    " ",
    " goal: active · 3 auto · ○ ponytail",
    " ",
  ]);
  assert.ok(lines.every((line) => line.startsWith(" ")));
  assert.ok(lines.every((line) => visibleWidth(line) <= 100));
  for (let index = 1; index < lines.length; index++) {
    assert.equal(isVisuallyBlank(lines[index - 1]) && isVisuallyBlank(lines[index]), false);
  }

  h.pi.events.emit(UI_PANEL_EVENT, { id: "todo" });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "task" });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "subagents" });
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "goal" });
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail" });
  assert.equal(h.widgets.size, 0);
  h.emit("session_shutdown");
});

test("custom editor delegates input, history, paste, shortcuts, IME cursor, and autocomplete", async () => {
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} };
  const editor = new UtilityEditor(
    tui,
    editorTheme,
    { matches: (data, action) => action === "app.interrupt" && data === "\u001b" },
    () => [" utility"],
  );
  editor.focused = true;
  editor.setText("first\nsecond");
  const multiline = editor.render(40);
  assert.ok(multiline.every((line) => line.startsWith(" ")));
  assert.ok(multiline.every((line) => visibleWidth(line) <= 40));
  assert.equal(multiline[0], " utility");
  assert.match(multiline[1], /─/);
  assert.match(multiline.join("\n"), new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(multiline.at(-1), /─/);

  let submitted;
  editor.onSubmit = (value) => { submitted = value; };
  editor.setText("ship");
  editor.handleInput("\r");
  assert.equal(submitted, "ship");
  assert.equal(editor.getText(), "");

  editor.addToHistory("older prompt");
  editor.handleInput("\u001b[A");
  assert.equal(editor.getText(), "older prompt");
  editor.setText("");
  editor.handleInput("\u001b[200~hello\nthere\u001b[201~");
  assert.equal(editor.getExpandedText(), "hello\nthere");

  let interrupted = false;
  editor.onAction("app.interrupt", () => { interrupted = true; });
  editor.handleInput("\u001b");
  assert.equal(interrupted, true);

  editor.setText("");
  editor.setAutocompleteProvider({
    async getSuggestions() {
      return { prefix: "/", items: [{ value: "/fixture", label: "/fixture", description: "test" }] };
    },
    applyCompletion() {},
    shouldTriggerFileCompletion() { return true; },
  });
  editor.handleInput("/");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(editor.render(40).join("\n"), /\/fixture/);
});
