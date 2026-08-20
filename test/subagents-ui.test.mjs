import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { emptyUsage } from "../extensions/subagents/core.ts";
import { renderAgents } from "../extensions/subagents/ui.ts";
import { emptyTodoSnapshot } from "../extensions/todo-core.ts";

const theme = {
  bold: (text) => text,
  fg: (_color, text) => text,
};

const ansiTheme = {
  bold: (text) => text,
  fg: (color, text) => `\x1b[${{ success: 32, error: 31, warning: 33, muted: 90, dim: 2 }[color]}m${text}\x1b[0m`,
};

function details() {
  const usage = { ...emptyUsage(), totalTokens: 12_400 };
  return {
    runId: "run",
    title: "Parallel work",
    usage,
    todoSnapshot: emptyTodoSnapshot(),
    progress: [
      { id: "explore", role: "explorer", title: "Map auth", status: "running", activity: "searching", toolCalls: 3, turns: 1, startedAt: Date.now() - 4_100, usage, model: "test/model", thinking: "low" },
      { id: "worker", role: "worker", title: "Refactor refresh", status: "succeeded", activity: "succeeded", toolCalls: 5, turns: 2, startedAt: Date.now() - 12_300, endedAt: Date.now(), usage, model: "test/model", thinking: "medium" },
      { id: "review", role: "reviewer", title: "Inspect API", status: "queued", toolCalls: 0, turns: 0, usage: emptyUsage(), model: "test/model", thinking: "high" },
    ],
    results: [{
      id: "worker", role: "worker", title: "Refactor refresh", status: "succeeded", activity: "succeeded", toolCalls: 5, turns: 2,
      startedAt: Date.now() - 12_300, endedAt: Date.now(), usage, model: "test/model", thinking: "medium", objective: "Change it",
      result: { status: "succeeded", summary: "Done", evidence: ["src/a.ts"] }, changedFiles: ["src/a.ts"], patchState: "ready", patchHash: "a".repeat(64), patchBytes: 100,
    }],
  };
}

test("agent tree rendering is Claude-like, sanitized, and width bounded", () => {
  for (const width of [20, 40, 80, 120]) {
    const lines = renderAgents(details(), theme, false).render(width);
    assert.ok(lines.length >= 6);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  const text = renderAgents(details(), theme, false).render(120).join("\n");
  assert.match(text, /^1\/3 completed │ 12k tokens/m);
  assert.doesNotMatch(text, /^Agents(?: │|$)/m);
  assert.match(text, /├─ Explorer/);
  assert.match(text, /└─ Reviewer/);
  assert.match(text, /⎿ searching/);
});

test("agent row colors exclude tree connectors", () => {
  const colored = details();
  colored.progress[2] = {
    ...colored.progress[2],
    status: "failed",
    activity: "failed",
    startedAt: Date.now() - 1_000,
    endedAt: Date.now(),
  };
  const lines = renderAgents(colored, ansiTheme, false).render(160);
  const activity = lines.find((line) => line.includes("searching"));
  const succeeded = lines.find((line) => line.includes("Worker"));
  const failed = lines.find((line) => line.includes("Reviewer"));

  assert.ok(activity?.startsWith("\x1b[90m│  ⎿ \x1b[0m\x1b[2msearching"));
  assert.ok(succeeded?.startsWith("\x1b[90m├─ \x1b[0m\x1b[32mWorker"));
  assert.ok(failed?.startsWith("\x1b[90m└─ \x1b[0m\x1b[31mReviewer"));
});

test("expanded agent rendering shows measured patch state", () => {
  const text = renderAgents(details(), theme, true).render(120).join("\n");
  assert.match(text, /files: src\/a\.ts/);
  assert.match(text, /patch: a{12}/);
});

test("agent rendering falls back when stale nested details are malformed", () => {
  const stale = {
    ...details(),
    progress: [{ id: "old", status: "running" }],
  };
  assert.equal(
    renderAgents(stale, theme, true, "Stored agent result is unavailable.").render(80).join("\n").trimEnd(),
    "Stored agent result is unavailable.",
  );
});
