import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Container, Spacer, visibleWidth } from "@earendil-works/pi-tui";
import layoutExtension, {
  compactCwd,
  createAnswerTimer,
  formatCompactFooter,
  formatElapsed,
  formatTokens,
  getCostLabel,
  totalSessionCost,
} from "../extensions/layout.ts";

const values = {
  cwd: "~/Documents/pi-config",
  branch: "main",
  elapsedSeconds: 90,
  statuses: [],
  cost: 0,
  costLabel: "api",
  contextPercent: 0,
  contextWindow: 272_000,
  autoCompact: true,
  model: "gpt-5.6-sol",
  thinking: "xhigh",
  fast: false,
};

test("answer timer runs only for the current answer and resets for the next prompt", () => {
  let now = 1_000;
  const timer = createAnswerTimer(() => now);

  assert.equal(timer.elapsedSeconds(), 0);
  assert.equal(timer.isRunning(), false);
  timer.start();
  assert.equal(timer.isRunning(), true);
  now = 2_500;
  assert.equal(timer.elapsedSeconds(), 1.5);
  timer.stop();
  assert.equal(timer.isRunning(), false);
  now = 5_000;
  assert.equal(timer.elapsedSeconds(), 1.5);
  timer.start();
  assert.equal(timer.elapsedSeconds(), 0);
});

test("compact footer formats elapsed time, tokens, and home-relative paths", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(90), "1m30");
  assert.equal(formatElapsed(3_661), "1h01m");
  assert.equal(formatElapsed(90_000), "1d1h");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_250), "1.3k");
  assert.equal(formatTokens(272_000), "272k");

  const home = join(tmpdir(), "layout-home");
  assert.equal(compactCwd(join(home, "work"), home), `~${sep}work`);
  assert.equal(compactCwd(tmpdir(), home), tmpdir());
});

test("compact footer matches the wide layout and never exceeds narrow terminals", () => {
  const wide = formatCompactFooter(values, 120);
  assert.equal(wide.length, 2);
  assert.equal(wide[0], "~/Documents/pi-config(main)");
  assert.equal(visibleWidth(wide[1]), 120);
  assert.match(wide[1], /^\$0\.000 \(api\) 0\.0%\/272k \(auto\) 1m30/);
  assert.match(wide[1], /gpt-5\.6-sol \(xhigh\)$/);
  assert.doesNotMatch(wide.join("\n"), /pi v/);
  assert.match(formatCompactFooter({ ...values, contextPercent: null }, 120)[1], /\?\/272k \(auto\)/);

  for (let width = 1; width <= 100; width++) {
    const lines = formatCompactFooter(values, width);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), String(width));
  }
});

test("compact footer groups Fast mode with the model and thinking level", () => {
  const withThinking = formatCompactFooter({ ...values, fast: true }, 120)[1];
  assert.match(withThinking, /gpt-5\.6-sol \(xhigh\) fast$/);
  assert.doesNotMatch(withThinking, /1m30 fast/);

  const withoutThinking = formatCompactFooter({ ...values, thinking: undefined, fast: true }, 120)[1];
  assert.match(withoutThinking, /gpt-5\.6-sol fast$/);
});

test("compact footer prioritizes extension status and sanitizes it", () => {
  const prioritized = {
    ...values,
    cwd: "~/a/very/long/project/directory/that/will/not/fit",
    statuses: ["sync:\nactive"],
  };
  const lines = formatCompactFooter(prioritized, 60);

  assert.equal(visibleWidth(lines[1]), 60);
  assert.match(lines[1], /^sync: active/);
  assert.match(lines[1], /gpt-5\.6-sol \(xhigh\)$/);
  assert.doesNotMatch(lines.join("\n"), /pi v|1m30|\$0\.000/);
});

test("cost label distinguishes subscription-backed auth from API access", () => {
  const context = (provider, isSubscription, usingOAuth = true) => ({
    model: { provider },
    modelRegistry: {
      getProvider: () => ({ auth: { oauth: { isSubscription } } }),
      isUsingOAuth: () => usingOAuth,
    },
  });

  assert.equal(getCostLabel(context("anthropic", true)), "sub");
  assert.equal(getCostLabel(context("anthropic", true, false)), "api");
  assert.equal(getCostLabel(context("kimi-coding", false, false)), "sub");
});

test("session cost includes assistant, tool, compaction, and branch-summary usage", () => {
  const usage = (total) => ({ cost: { total } });
  const entries = [
    { type: "message", message: { role: "assistant", usage: usage(1.25) } },
    { type: "message", message: { role: "toolResult", usage: usage(0.5) } },
    { type: "message", message: { role: "user" } },
    { type: "compaction", usage: usage(0.2) },
    { type: "branch_summary", usage: usage(0.05) },
  ];
  assert.equal(totalSessionCost(entries), 2);
});

test("session cost ignores malformed unvalidated session entries", () => {
  assert.equal(totalSessionCost([
    true,
    { type: "message" },
    { type: "message", message: null },
    { type: "message", message: { role: "assistant", usage: { cost: { total: "invalid" } } } },
    { type: "compaction", usage: { cost: { total: 0.25 } } },
  ]), 0.25);
});

test("layout installs only in TUI mode, caches cost, and disposes footer resources", () => {
  const events = new Map();
  layoutExtension({ on(name, handler) { events.set(name, handler); } });
  const sessionStart = events.get("session_start");
  assert.equal(typeof events.get("before_agent_start"), "function");
  assert.equal(typeof events.get("agent_settled"), "function");

  let rpcHeader = false;
  sessionStart({}, {
    mode: "rpc",
    ui: { setHeader() { rpcHeader = true; } },
  });
  assert.equal(rpcHeader, false);

  const agentDir = mkdtempSync(join(tmpdir(), "pi-config-layout-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    let headerFactory;
    let footerFactory;
    let entryReads = 0;
    const entries = [
      { type: "message", message: { role: "assistant", usage: { cost: { total: 1 } } } },
    ];
    const context = {
      mode: "tui",
      cwd: agentDir,
      isProjectTrusted: () => false,
      getContextUsage: () => ({ percent: 2.5, contextWindow: 100_000, tokens: 2_500 }),
      model: { id: "model", provider: "provider", contextWindow: 100_000, reasoning: true },
      modelRegistry: {
        getProvider: () => ({ auth: { oauth: { isSubscription: false } } }),
        isUsingOAuth: () => false,
      },
      thinkingLevel: "high",
      sessionManager: {
        getCwd: () => agentDir,
        getEntries: () => { entryReads++; return entries; },
      },
      ui: {
        setHeader(factory) { headerFactory = factory; },
        setFooter(factory) { footerFactory = factory; },
      },
    };
    sessionStart({}, context);

    const builtInHeader = { render: () => ["header"], invalidate() {} };
    const headerLeading = new Spacer(1);
    const headerTrailing = new Spacer(1);
    const headerContainer = new Container();
    headerContainer.addChild(headerLeading);
    headerContainer.addChild(builtInHeader);
    headerContainer.addChild(headerTrailing);
    const resourceTrailing = new Spacer(1);
    const resourcesContainer = new Container();
    resourcesContainer.addChild(new Spacer(1));
    resourcesContainer.addChild({
      render: () => ["[Context]", "  AGENTS.md", "", "[Extensions]", "  layout.ts"],
      invalidate() {},
    });
    resourcesContainer.addChild(resourceTrailing);
    const chatContainer = new Container();
    const documentContainer = new Container();
    documentContainer.addChild(headerContainer);
    documentContainer.addChild(resourcesContainer);
    documentContainer.addChild(chatContainer);
    const widgetContainer = new Container();
    widgetContainer.addChild(new Spacer(1));
    const editor = { render: () => ["editor"], invalidate() {} };
    const headerIndex = headerContainer.children.indexOf(builtInHeader);
    const header = headerFactory({ children: [documentContainer], requestRender() {} });
    headerContainer.children[headerIndex] = header;

    assert.deepEqual([
      ...documentContainer.render(80),
      ...widgetContainer.render(80),
      ...editor.render(80),
    ], ["", "[Context]", "  AGENTS.md", "", "[Extensions]", "  layout.ts", "", "editor"]);
    chatContainer.addChild({ render: () => ["prompt"], invalidate() {} });
    assert.deepEqual(documentContainer.render(80), [
      "", "[Context]", "  AGENTS.md", "", "[Extensions]", "  layout.ts", "", "prompt",
    ]);
    header.dispose();
    assert.deepEqual(headerLeading.render(80), [""]);
    assert.deepEqual(headerTrailing.render(80), [""]);
    assert.deepEqual(resourceTrailing.render(80), [""]);
    let unsubscribed = false;
    const footer = footerFactory(
      { requestRender() {} },
      { fg: (_color, text) => text },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map([
          ["openai-fast", "fast"],
          ["sync", "sync: active"],
        ]),
        onBranchChange: () => () => { unsubscribed = true; },
      },
    );
    const lines = footer.render(80);
    footer.render(80);
    assert.equal(lines.length, 2);
    assert.ok(visibleWidth(lines[0]) <= 80);
    assert.match(lines[0], /\(main\)$/);
    assert.match(lines[1], /sync: active/);
    assert.match(lines[1], /model \(high\) fast$/);
    assert.doesNotMatch(lines[1], /0s fast/);
    assert.equal(entryReads, 1, "footer renders use the session-start cost snapshot");

    entries.push({ type: "message", message: { role: "toolResult", usage: { cost: { total: 0.5 } } } });
    events.get("turn_end")({}, context);
    events.get("agent_settled")({}, context);
    assert.equal(entryReads, 3);
    assert.match(footer.render(200)[1], /\$1\.500 \(api\)/);

    entries.length = 1;
    entries[0] = { type: "compaction", usage: { cost: { total: 0.25 } } };
    events.get("session_tree")({}, context);
    assert.match(footer.render(200)[1], /\$0\.250 \(api\)/);

    footer.dispose();
    assert.equal(unsubscribed, true);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("layout refreshes the auto-compaction indicator while the session is open", async () => {
  const events = new Map();
  layoutExtension({ on(name, handler) { events.set(name, handler); } });
  const agentDir = mkdtempSync(join(tmpdir(), "pi-config-layout-settings-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let footer;
  try {
    let footerFactory;
    const context = {
      mode: "tui",
      cwd: agentDir,
      isProjectTrusted: () => false,
      getContextUsage: () => ({ percent: 0, contextWindow: 100_000 }),
      model: undefined,
      modelRegistry: {},
      thinkingLevel: "off",
      sessionManager: { getCwd: () => agentDir, getEntries: () => [] },
      ui: {
        setHeader() {},
        setFooter(factory) { footerFactory = factory; },
      },
    };
    events.get("session_start")({}, context);
    footer = footerFactory(
      { requestRender() {} },
      { fg: (_color, text) => text },
      {
        getGitBranch: () => null,
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => {},
      },
    );
    assert.match(footer.render(160)[1], /\(auto\)/);

    writeFileSync(join(agentDir, "settings.json"), '{"compaction":{"enabled":false}}\n');
    const deadline = Date.now() + 5_000;
    while (/\(auto\)/.test(footer.render(160)[1]) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.doesNotMatch(footer.render(160)[1], /\(auto\)/);
  } finally {
    footer?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
