import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import contextExtension, {
  createContextComponent,
  flattenContextRows,
  formatContextTokens,
  parseContextCommand,
} from "../extensions/context.ts";
import { buildContextSnapshot } from "../extensions/context-core.ts";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

const keybindings = {
  matches(data, action) {
    return (action === "tui.select.cancel" && data === "\x1b") ||
      (action === "tui.select.up" && data === "\x1b[A") ||
      (action === "tui.select.down" && data === "\x1b[B");
  },
};

function snapshot() {
  const prompt = [
    "BASE APPEND",
    '<project_context>\n<project_instructions path="/repo/AGENTS.md">rules</project_instructions>\n</project_context>',
    "The following skills provide specialized instructions\n<available_skills><skill>unslop</skill></available_skills>",
    "Current working directory: /repo",
    "",
    "PONYTAIL MODE ACTIVE",
  ].join("\n");
  return buildContextSnapshot({
    systemPrompt: prompt,
    options: {
      cwd: "/repo",
      appendSystemPrompt: "APPEND",
      contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
      skills: [],
    },
    tools: [
      { name: "read", description: "Read files", parameters: { type: "object" }, sourceInfo: { source: "builtin" } },
      { name: "todo", description: "Manage todos", parameters: { type: "object" }, sourceInfo: { source: "./extensions/todo.ts" } },
      { name: "inactive", description: "Not sent", parameters: {}, sourceInfo: { source: "builtin" } },
    ],
    activeToolNames: ["read", "todo"],
    messages: [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 },
      { role: "toolResult", toolCallId: "1", toolName: "read", content: [{ type: "text", text: "file" }], isError: false, timestamp: 3 },
      { role: "custom", customType: "goal", content: "continue", display: false, timestamp: 4 },
      { role: "bashExecution", command: "pwd", output: "/repo", excludeFromContext: false, timestamp: 5 },
      { role: "bashExecution", command: "secret", output: "not model context", excludeFromContext: true, timestamp: 6 },
      { role: "compactionSummary", summary: "summary", timestamp: 7 },
    ],
    reported: { tokens: 1_000, contextWindow: 10_000, percent: 10 },
    model: "test-model",
    reserveTokens: 1_500,
  });
}

test("context snapshot separates prompt, tools, and active session messages", () => {
  const result = snapshot();
  const byId = new Map(result.categories.map((category) => [category.id, category]));

  for (const id of [
    "system-prompt",
    "memory",
    "skills",
    "appended-prompt",
    "extension-policies",
    "system-tools",
    "custom-tools",
    "user-messages",
    "agent-messages",
    "tool-output",
    "shell-output",
    "extension-messages",
    "compacted-data",
  ]) assert.ok(byId.has(id), id);
  assert.deepEqual(byId.get("system-tools").children.map(({ label }) => label), ["read"]);
  assert.deepEqual(byId.get("custom-tools").children.map(({ label }) => label), ["todo"]);
  assert.deepEqual(byId.get("tool-output").children.map(({ label }) => label), ["read"]);
  assert.equal(byId.get("shell-output").tokens, estimateTokens({
    role: "bashExecution",
    command: "pwd",
    output: "/repo",
    excludeFromContext: false,
    timestamp: 5,
  }));
  assert.equal(byId.get("extension-policies").tokens > 0, true);
  assert.equal(result.estimatedTokens, result.categories.reduce((sum, category) => sum + category.tokens, 0));
  assert.equal(result.reportedTokens, 1_000);
  assert.equal(result.contextWindow, 10_000);
});

test("context snapshot preserves unknown post-compaction usage", () => {
  const result = buildContextSnapshot({
    systemPrompt: "prompt",
    options: { cwd: "/repo" },
    tools: [],
    activeToolNames: [],
    messages: [],
    reported: { tokens: null, contextWindow: 10_000, percent: null },
  });
  assert.equal(result.reportedTokens, null);
  assert.equal(result.reportedPercent, null);
  const component = createContextComponent(
    { terminal: { rows: 20, columns: 60 }, requestRender() {} },
    theme,
    keybindings,
    result,
    () => {},
  );
  assert.match(component.render(60).join("\n"), /Current usage unknown after compaction/);
});

test("context command grammar stays intentionally small", () => {
  assert.equal(parseContextCommand(""), true);
  assert.equal(parseContextCommand(" USAGE "), true);
  assert.equal(parseContextCommand("injections"), false);
  assert.equal(parseContextCommand("usage extra"), false);
  assert.equal(formatContextTokens(999), "999");
  assert.equal(formatContextTokens(1_250), "1.3k");
  assert.equal(formatContextTokens(20_000), "20k");
  assert.equal(formatContextTokens(1_250_000), "1.3M");
});

test("context view scrolls, closes, and fits narrow terminals", () => {
  const result = snapshot();
  assert.ok(flattenContextRows(result).length > result.categories.length);
  let renders = 0;
  let closed = false;
  const tui = { terminal: { rows: 16, columns: 80 }, requestRender() { renders++; } };
  const component = createContextComponent(tui, theme, keybindings, result, () => { closed = true; });

  const initial = component.render(80).join("\n");
  assert.match(initial, /Context usage \| test-model/);
  assert.match(initial, /1\.0k \/ 10k \(10\.0%\)/);
  assert.match(initial, /Estimated breakdown/);
  assert.match(initial, /more below/);
  component.handleInput("\x1b[B");
  assert.equal(renders, 1);
  component.handleInput("\x1b[6~");
  assert.equal(renders, 2);
  component.handleInput("q");
  assert.equal(closed, true);

  for (let width = 1; width <= 80; width++) {
    const lines = component.render(width);
    assert.ok(lines.length <= 14, String(width));
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
  }

  for (let terminalRows = 3; terminalRows <= 16; terminalRows++) {
    const shortTui = { terminal: { rows: terminalRows, columns: 40 }, requestRender() {} };
    const short = createContextComponent(shortTui, theme, keybindings, result, () => {}).render(40);
    assert.ok(short.length <= Math.max(1, terminalRows - 2), `height ${terminalRows}`);
    assert.ok(short.every((line) => visibleWidth(line) <= 40));
    if (terminalRows >= 5) {
      assert.match(short.join("\n"), /\[P\]|System prompt/);
      assert.match(short.join("\n"), /q\/esc close/);
    }
  }
});

test("context extension captures final turn policy and stays TUI-only", async () => {
  const events = new Map();
  let command;
  const pi = {
    on(name, handler) { events.set(name, handler); },
    registerCommand(name, definition) { command = { name, ...definition }; },
    getAllTools: () => [],
    getActiveTools: () => [],
  };
  contextExtension(pi);
  assert.equal(command.name, "context");
  assert.deepEqual(command.getArgumentCompletions("u").map(({ value }) => value), ["usage"]);
  assert.equal(command.getArgumentCompletions("x"), null);

  events.get("session_start")();
  events.get("before_agent_start")({ systemPrompt: "BASE\nCurrent working directory: /repo\n\nFINAL POLICY" });
  let rendered = "";
  const context = {
    mode: "tui",
    cwd: "/repo",
    isProjectTrusted: () => false,
    waitForIdle: async () => {},
    sessionManager: { getEntries: () => [], getLeafId: () => undefined },
    getSystemPrompt: () => "BASE",
    getSystemPromptOptions: () => ({ cwd: "/repo" }),
    getContextUsage: () => ({ tokens: 10, contextWindow: 1_000, percent: 1 }),
    model: { id: "model" },
    ui: {
      notify() {},
      async custom(factory) {
        const component = factory(
          { terminal: { rows: 30, columns: 80 }, requestRender() {} },
          theme,
          keybindings,
          () => {},
        );
        rendered = component.render(80).join("\n");
      },
    },
  };
  await command.handler("", context);
  assert.match(rendered, /Extension policies/);
  assert.doesNotMatch(rendered, /turn policies pending/);

  events.get("session_start")();
  await command.handler("", context);
  assert.match(rendered, /turn policies pending/);

  let warned = "";
  await command.handler("", {
    mode: "rpc",
    ui: { notify(message) { warned = message; }, custom() { throw new Error("must not open"); } },
  });
  assert.equal(warned, "/context requires TUI mode.");
});
