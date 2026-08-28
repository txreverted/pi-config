import test from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import uiExtension, {
  formatCwd,
  formatDuration,
  formatTokens,
  renderFooter,
  summarizeUsage,
} from "../extensions/ui.ts";

const usage = (overrides = {}) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...overrides,
});

const theme = {
  fg: (_color, text) => text,
  getThinkingBorderColor: (level) => (text) => `<${level}>${text}</${level}>`,
};

const footerState = (overrides = {}) => ({
  cwd: "/home/alice/project",
  home: "/home/alice",
  branch: "main",
  usage: summarizeUsage([]),
  contextUsage: { tokens: 0, contextWindow: 272_000, percent: 0 },
  model: { id: "gpt-5.6-sol", reasoning: true, contextWindow: 272_000 },
  thinkingLevel: "low",
  usingSubscription: true,
  extensionStatuses: new Map(),
  ...overrides,
});

test("UI footer helpers stay compact", () => {
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(85_900), "1m25s");
  assert.equal(formatDuration(3_720_000), "1h2m");
  assert.equal(formatDuration(183_600_000), "2d3h");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_250), "1.3k");
  assert.equal(formatTokens(272_000), "272k");
  assert.equal(formatCwd("/home/alice/project", "/home/alice"), `~${sep}project`);
  assert.equal(formatCwd("/srv/project", "/home/alice"), "/srv/project");
});

test("UI footer matches the requested idle layout and terminal width", () => {
  const lines = renderFooter(100, footerState(), theme);
  assert.equal(lines[0], `~${sep}project (main)`);
  assert.match(lines[1], /^\$0\.000 \(sub\) 0\.0%\/272k \(auto\) +gpt-5\.6-sol \(low\)$/);

  const statuses = new Map([
    ["z", "last\nline"],
    ["a", "first\tline"],
  ]);
  const narrow = renderFooter(28, footerState({ extensionStatuses: statuses }), theme);
  assert.equal(narrow[2], "first line last line");
  for (const line of narrow) assert.ok(visibleWidth(line) <= 28, `${visibleWidth(line)} > 28: ${line}`);
});

test("usage is scanned once, then updated from lifecycle events", async () => {
  const existing = usage({
    input: 100,
    cacheRead: 300,
    totalTokens: 400,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
  });
  let entryReads = 0;
  let contextReads = 0;
  const events = new Map();
  let footer;
  let widget;
  const tui = { requestRender() {} };
  const footerData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map(),
    onBranchChange: () => () => {},
  };
  const ui = {
    theme,
    setWorkingVisible(visible) {
      assert.equal(visible, false);
    },
    setFooter(factory) {
      footer = factory(tui, theme, footerData);
    },
    setWidget(_key, content) {
      widget?.dispose?.();
      widget = typeof content === "function" ? content(tui, theme) : undefined;
    },
  };
  const ctx = {
    mode: "tui",
    ui,
    model: footerState().model,
    thinkingLevel: "low",
    modelRegistry: {
      isUsingOAuth: () => true,
      getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
    },
    sessionManager: {
      getEntries() {
        entryReads++;
        return [{ type: "message", message: { role: "assistant", usage: existing } }];
      },
      getCwd: () => "/home/alice/project",
      getSessionName: () => undefined,
    },
    getContextUsage: () => {
      contextReads++;
      return { tokens: 0, contextWindow: 272_000, percent: 0 };
    },
  };
  const pi = {
    on(name, handler) {
      events.set(name, handler);
    },
  };

  uiExtension(pi);
  await events.get("session_start")({}, ctx);
  assert.equal(entryReads, 1);
  assert.equal(contextReads, 1);
  footer.render(100);
  footer.render(100);
  assert.equal(entryReads, 1, "footer render rescanned the session");
  assert.equal(contextReads, 1, "footer render re-estimated the context");
  assert.match(footer.render(100)[1], /↑100 R300 CH75\.0% \$0\.250 \(sub\)/);

  const added = usage({ input: 20, output: 5, totalTokens: 25 });
  await events.get("message_end")({ message: { role: "assistant", usage: added } }, ctx);
  assert.equal(contextReads, 2);
  assert.match(footer.render(100)[1], /↑120 ↓5 R300 CH0\.0%/);
  await events.get("session_info_changed")({ name: "footer test" }, ctx);
  assert.match(footer.render(100)[0], /project \(main\) • footer test$/);

  await events.get("agent_start")({}, ctx);
  assert.deepEqual(widget.render(100).slice(1), [""], "working loader leaves a row before the editor");
  await events.get("thinking_level_select")({ level: "high" }, ctx);
  assert.match(widget.render(100)[0], /<high>/);
  assert.doesNotMatch(widget.render(100)[0], /<high>Working/);
  await events.get("agent_end")({}, ctx);
  assert.equal(widget, undefined);
  await events.get("agent_settled")({}, ctx);
  assert.doesNotMatch(footer.render(100)[1], /\(0s\)/);

  await events.get("session_shutdown")({}, ctx);
  footer.dispose();
});
