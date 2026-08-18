import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Container, Spacer, Text, visibleWidth } from "@earendil-works/pi-tui";
import layoutExtension, {
  compactCwd,
  compactStartupSpacing,
  createAnswerTimer,
  formatCompactFooter,
  formatElapsed,
  formatTokens,
  getCostLabel,
  totalSessionCost,
} from "../extensions/layout.ts";

const values = {
  version: "0.84.2",
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
  assert.equal(visibleWidth(wide), 120);
  assert.match(wide, /^pi v0\.84\.2 ~\/Documents\/pi-config\(main\) 1m30/);
  assert.match(wide, /\$0\.000 \(api\) 0\.0%\/272k \(auto\) gpt-5\.6-sol \(xhigh\)$/);
  assert.match(formatCompactFooter({ ...values, contextPercent: null }, 120), /\?\/272k \(auto\)/);

  for (let width = 1; width <= 100; width++) {
    assert.ok(visibleWidth(formatCompactFooter(values, width)) <= width, String(width));
  }
});

test("compact footer prioritizes extension status and sanitizes it", () => {
  const prioritized = {
    ...values,
    cwd: "~/a/very/long/project/directory/that/will/not/fit",
    statuses: ["goal:\nactive"],
  };
  const line = formatCompactFooter(prioritized, 60);

  assert.equal(visibleWidth(line), 60);
  assert.match(line, /goal: active/);
  assert.doesNotMatch(line, /pi v|1m30|\$0\.000/);
  assert.equal(formatCompactFooter(prioritized, 20), "goal: active");
  assert.equal(formatCompactFooter(prioritized, 12), "goal: active");
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

test("startup layout moves context below extensions and collapses only redundant spacers", () => {
  const adjustedSpacers = new Set();
  const header = { render: () => [], invalidate() {} };
  const headerContainer = new Container();
  headerContainer.addChild(new Spacer(1));
  headerContainer.addChild(header);
  headerContainer.addChild(new Spacer(1));
  const resources = new Container();
  resources.addChild(new Text("[Context]\n  AGENTS.md", 0, 0));
  resources.addChild(new Spacer(1));
  resources.addChild(new Text("[Extensions]\n  layout.ts", 0, 0));
  resources.addChild(new Spacer(1));
  const chat = new Container();
  const document = new Container();
  document.addChild(headerContainer);
  document.addChild(resources);
  document.addChild(chat);
  const tui = { children: [document] };

  compactStartupSpacing(tui, header, adjustedSpacers);
  assert.deepEqual(headerContainer.render(80), []);
  assert.deepEqual(resources.render(80).map((line) => line.trimEnd()), [
    "[Extensions]",
    "  layout.ts",
    "",
    "[Context]",
    "  AGENTS.md",
  ]);

  chat.addChild(new Text("message", 0, 0));
  compactStartupSpacing(tui, header, adjustedSpacers);
  assert.equal(resources.render(80).at(-1), "");
  assert.equal(adjustedSpacers.size, 3);
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
        getEntries: () => { entryReads++; return []; },
      },
      ui: {
        setHeader(factory) { headerFactory = factory; },
        setFooter(factory) { footerFactory = factory; },
      },
    };
    sessionStart({}, context);

    const headerTui = { children: [], requestRender() {} };
    const header = headerFactory(headerTui);
    assert.deepEqual(header.render(80), []);
    let unsubscribed = false;
    const footer = footerFactory(
      { requestRender() {} },
      { fg: (_color, text) => text },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map([["goal", "goal: active"]]),
        onBranchChange: () => () => { unsubscribed = true; },
      },
    );
    const lines = footer.render(80);
    footer.render(80);
    assert.equal(lines.length, 1);
    assert.equal(visibleWidth(lines[0]), 80);
    assert.match(lines[0], /goal: active/);
    assert.equal(entryReads, 1, "footer renders use the session-start cost snapshot");
    footer.dispose();
    header.dispose();
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
    assert.match(footer.render(160)[0], /\(auto\)/);

    writeFileSync(join(agentDir, "settings.json"), '{"compaction":{"enabled":false}}\n');
    const deadline = Date.now() + 5_000;
    while (/\(auto\)/.test(footer.render(160)[0]) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.doesNotMatch(footer.render(160)[0], /\(auto\)/);
  } finally {
    footer?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
