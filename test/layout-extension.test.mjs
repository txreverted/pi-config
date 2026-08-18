import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import layoutExtension, {
  compactCwd,
  formatCompactFooter,
  formatElapsed,
  formatTokens,
  totalSessionCost,
} from "../extensions/layout.ts";

const values = {
  version: "0.84.2",
  cwd: "~/Documents/pi-config",
  branch: "main",
  elapsedSeconds: 90,
  statuses: [],
  cost: 0,
  contextPercent: 0,
  contextWindow: 272_000,
  autoCompact: true,
  model: "gpt-5.6-sol",
  thinking: "xhigh",
};

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
  assert.match(wide, /\$0\.000 0\.0%\/272k \(auto\) gpt-5\.6-sol \(xhigh\)$/);
  assert.match(formatCompactFooter({ ...values, contextPercent: null }, 120), /\?\/272k \(auto\)/);

  for (let width = 1; width <= 100; width++) {
    assert.ok(visibleWidth(formatCompactFooter(values, width)) <= width, String(width));
  }
});

test("compact footer prioritizes extension status and sanitizes it", () => {
  const line = formatCompactFooter({
    ...values,
    cwd: "~/a/very/long/project/directory/that/will/not/fit",
    statuses: ["goal:\nactive"],
  }, 60);

  assert.equal(visibleWidth(line), 60);
  assert.match(line, /goal: active/);
  assert.doesNotMatch(line, /pi v|1m30|\$0\.000/);
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

test("layout installs only in TUI mode and disposes footer resources", () => {
  const events = new Map();
  layoutExtension({ on(name, handler) { events.set(name, handler); } });
  const sessionStart = events.get("session_start");

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
    const context = {
      mode: "tui",
      cwd: agentDir,
      isProjectTrusted: () => false,
      getContextUsage: () => ({ percent: 2.5, contextWindow: 100_000, tokens: 2_500 }),
      model: { id: "model", contextWindow: 100_000, reasoning: true },
      thinkingLevel: "high",
      sessionManager: {
        getCwd: () => agentDir,
        getEntries: () => [],
      },
      ui: {
        setHeader(factory) { headerFactory = factory; },
        setFooter(factory) { footerFactory = factory; },
      },
    };
    sessionStart({}, context);

    assert.deepEqual(headerFactory().render(80), []);
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
    assert.equal(lines.length, 1);
    assert.equal(visibleWidth(lines[0]), 80);
    assert.match(lines[0], /goal: active/);
    footer.dispose();
    assert.equal(unsubscribed, true);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
