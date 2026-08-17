import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { AgentsView, formatRecentTranscript } from "../extensions/subagents-ui.ts";

const theme = { fg: (_color, text) => text, bold: (text) => text };
const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: .125 } };
function record(id, depth = 1, parentId) {
  return {
    id, name: `Agent ${id}`, agent: "reviewer", task: "test", cwd: process.cwd(), parentId, depth,
    status: "running", createdAt: 1_000, updatedAt: 2_000,
    progress: { id, agent: "reviewer", thinking: "high", status: "running", startedAt: 1_000, activity: "Reading unsafe\u001b]52;c;payload\u0007 files", turns: 1, toolCalls: 2, text: "", usage },
  };
}

function fixture(records = [record("one"), record("two", 2, "one")]) {
  let action;
  let renders = 0;
  const tui = { terminal: { rows: 30, columns: 100 }, requestRender() { renders++; } };
  const state = { claimedTasks: new Map([["two", "7 Running tests"]]), transcript: "assistant: safe output" };
  const view = new AgentsView(tui, theme, records, state, (value) => { action = value; });
  view.focused = true;
  return { view, state, action: () => action, renders: () => renders };
}

test("agents view renders deterministic ancestry and bounded lines at widths 20-200", () => {
  const { view } = fixture();
  for (let width = 20; width <= 200; width++) {
    const lines = view.render(width);
    assert.ok(lines.length > 5);
    assert.ok(lines.length <= 28);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}: ${JSON.stringify(lines)}`);
    assert.doesNotMatch(stripTerminalSequences(lines.join("\n")), /payload/);
  }
  assert.match(view.render(100).join("\n"), /└─ Agent two/);
  assert.match(view.render(100).join("\n"), /#7 Running tests/);
});

test("agents view selection, active message editor, IME focus, and actions are deterministic", () => {
  const h = fixture();
  h.view.handleInput("\u001b[B");
  h.view.handleInput("m");
  assert.match(h.view.render(80).join("\n"), new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  h.view.handleInput("こんにちは");
  h.view.handleInput("\r");
  assert.deepEqual(h.action(), { type: "message", id: "two", message: "こんにちは" });
  assert.ok(h.renders() >= 2);

  const done = { ...record("done"), status: "done", result: { ...record("done").progress, status: "done", task: "test", cwd: process.cwd(), output: "", exitCode: 0, endedAt: 3_000, durationMs: 2_000, truncated: false } };
  const idle = fixture([done]);
  idle.view.handleInput("r"); idle.view.handleInput("continue"); idle.view.handleInput("\r");
  assert.deepEqual(idle.action(), { type: "resume", id: "done", message: "continue" });
});

test("native transcript formatting parses known text only and sanitizes terminal data", () => {
  const raw = [
    JSON.stringify({ type: "session", secret: "do-not-render" }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "hello\u001b]52;c;stolen\u0007" }] } }),
    "not-json",
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "image", data: "PRIVATE" }, { type: "text", text: "world\u202e" }] } }),
  ].join("\n");
  const formatted = formatRecentTranscript(raw);
  assert.equal(formatted, "user: hello\n\nassistant: world");
  assert.doesNotMatch(formatted, /secret|PRIVATE|stolen|\\u001b/);
});
