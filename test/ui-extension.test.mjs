import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { Container, Text, visibleWidth } from "@earendil-works/pi-tui";
import ui, { formatElapsed, formatExtensionStatuses } from "../extensions/ui.ts";

function baseTheme() {
  const indexes = { mdHeading: 4, thinkingHigh: 2, thinkingLow: 3 };
  const getFgAnsi = (color) => `\x1b[38;5;${indexes[color] ?? 1}m`;
  return {
    getFgAnsi,
    fg: (color, text) => `${getFgAnsi(color)}${text}\x1b[39m`,
  };
}

test("response durations hide zero and use compact units", () => {
  assert.equal(formatElapsed(999), "");
  assert.equal(formatElapsed(1_000), "1s");
  assert.equal(formatElapsed(61_000), "1m 1s");
  assert.equal(formatElapsed(3_661_000), "1h 1m 1s");
});

test("extension statuses omit memory and stay safe for the single-line editor border", () => {
  assert.equal(formatExtensionStatuses(new Map([
    ["web", "web\tready"],
    ["memory", "mem:1\nworking"],
    ["empty", "  "],
  ])), "web ready");
});

test("the custom editor keeps status and scrolling inside its frame", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const handlers = new Map();
  let footerFactory;
  let editorFactory;
  ui({
    on: (event, handler) => handlers.set(event, handler),
  });

  const theme = { ...baseTheme(), borderColor: (text) => `\x1b[38;5;8m${text}\x1b[39m` };
  const ctx = {
    mode: "tui",
    cwd: "/project",
    thinkingLevel: "off",
    sessionManager: {
      getEntries: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.1 } } } }],
      getLeafId: () => null,
    },
    getContextUsage: () => ({ contextWindow: 128_000, percent: 10 }),
    ui: {
      theme,
      setWorkingIndicator() {},
      setFooter: (factory) => { footerFactory = factory; },
      setEditorComponent: (factory) => { editorFactory = factory; },
    },
  };
  handlers.get("session_start")({}, ctx);
  const tui = { requestRender() {}, terminal: { rows: 20 } };
  footerFactory(tui, theme, {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map([["memory", "mem:1"]]),
    onBranchChange: () => () => {},
  });
  const editor = editorFactory(tui, theme, {});
  editor.borderColor = (text) => `\x1b[38;5;2m${text}\x1b[39m`;
  handlers.get("before_agent_start")({}, ctx);
  now = 61_000;
  handlers.get("agent_settled")({}, ctx);
  assert.match(stripVTControlCharacters(editor.status()), /^no-model ❯ \/project \(main\).*\$0\.100$/);

  editor.setText(Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"));
  editor.state.cursorLine = 0;
  editor.state.cursorCol = 0;
  const lines = editor.render(80);
  assert.match(stripVTControlCharacters(lines[0]), /^╭─ 𝛑 \(1m 1s\) ❯ no-model/);
  assert.match(lines[0], /\x1b\[38;5;8m\(1m 1s\)\x1b\[39m/);
  assert.doesNotMatch(lines[0], /mem/);
  assert.ok(lines.some((line) => line.includes("↓14 ─╯")));
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));
});

test("thinking changes recolor the startup logo and resource headings without rebuilding the transcript", async () => {
  const handlers = new Map();
  let footerFactory;
  ui({
    on: (event, handler) => handlers.set(event, handler),
  });

  const indicators = [];
  const theme = baseTheme();
  const containerRender = Container.prototype.render;
  const textInvalidate = Text.prototype.invalidate;
  let expanded = false;
  let headingUpdates = 0;
  const logoText = () => `\x1b[1m${theme.fg("accent", "pi")}\x1b[22m${theme.fg("dim", " v0.84.3")}`;
  const logo = {
    text: logoText(),
    getCollapsedText: logoText,
    getExpandedText: logoText,
    setText(text) {
      this.text = text;
    },
  };
  const heading = {
    text: theme.fg("mdHeading", "[Context]") + "\n  AGENTS.md",
    getCollapsedText: () => theme.fg("mdHeading", "[Context]") + "\n  AGENTS.md",
    getExpandedText: () => theme.fg("mdHeading", "[Context]") + "\n  /project/AGENTS.md",
    setText(text) {
      headingUpdates++;
      this.text = text;
    },
  };
  const header = { children: [{}, logo, {}] };
  const loadedResources = { children: [heading] };
  let renders = 0;
  const tui = {
    children: [{ children: [header, loadedResources, {}] }],
    requestRender: () => { renders++; },
  };
  const ctx = {
    mode: "tui",
    cwd: "/project",
    thinkingLevel: "low",
    sessionManager: { getBranch: () => [] },
    ui: {
      theme,
      getToolsExpanded: () => expanded,
      setTheme() {
        assert.fail("thinking changes must not invalidate the transcript theme");
      },
      setWorkingIndicator: (next) => indicators.push(next),
      setFooter: (factory) => { footerFactory = factory; },
      setEditorComponent() {},
    },
  };

  handlers.get("session_start")({}, ctx);
  const footer = footerFactory(tui, theme, {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    onBranchChange: () => () => {},
  });
  footer.render();
  await Promise.resolve();
  assert.ok(logo.text.includes(`${theme.getFgAnsi("thinkingLow")}pi`));
  assert.ok(heading.text.startsWith(theme.getFgAnsi("thinkingLow") + "[Context]"));

  handlers.get("thinking_level_select")({ level: "high" }, ctx);
  const updatesAfterHigh = headingUpdates;
  handlers.get("thinking_level_select")({ level: "high" }, ctx);
  assert.ok(logo.text.includes(`${theme.getFgAnsi("thinkingHigh")}pi`));
  assert.ok(heading.text.startsWith(theme.getFgAnsi("thinkingHigh") + "[Context]"));
  assert.equal(headingUpdates, updatesAfterHigh);

  expanded = true;
  heading.setText(heading.getExpandedText());
  footer.render();
  await Promise.resolve();
  assert.ok(heading.text.startsWith(theme.getFgAnsi("thinkingHigh") + "[Context]"));
  assert.match(heading.text, /\/project\/AGENTS\.md/);

  const switchedTheme = {
    getFgAnsi: (color) => color === "thinkingHigh" ? "\x1b[38;5;6m" : theme.getFgAnsi(color),
  };
  ctx.ui.theme = switchedTheme;
  footer.render();
  await Promise.resolve();
  assert.ok(logo.text.includes(`${switchedTheme.getFgAnsi("thinkingHigh")}pi`));
  assert.ok(heading.text.startsWith(switchedTheme.getFgAnsi("thinkingHigh") + "[Context]"));

  assert.equal(Container.prototype.render, containerRender);
  assert.equal(Text.prototype.invalidate, textInvalidate);
  assert.ok(renders >= 3);
  assert.equal(indicators.length, 2);
  assert.equal(indicators[1].intervalMs, 120);
  assert.equal(indicators[1].frames.length, 10);
  assert.equal(indicators[1].frames[0], theme.fg("thinkingHigh", "⠋"));
});
