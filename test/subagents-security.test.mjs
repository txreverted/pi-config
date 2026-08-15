import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../subagents/registry.ts";
import subagentsExtension from "../extensions/subagents.ts";
import { MAX_SUBAGENT_TASKS } from "../extensions/subagents-core.ts";

const allowedTools = new Set([
  "read", "grep", "find", "ls", "web_search", "web_fetch", "git_status", "git_diff",
]);

test("expanded subagent output strips terminal control sequences", () => {
  let tool;
  subagentsExtension({ registerTool(value) { tool = value; } });
  const rendered = tool.renderResult({
    content: [{ type: "text", text: "safe\u001b]52;c;SGFja2Vk\u0007\u001b[31m red\u001b[0m\nnext" }],
  }, { expanded: true }, {}).render(120).join("\n");

  assert.match(rendered.split("\n").map((line) => line.trimEnd()).join("\n"), /safe red\nnext/);
  assert.doesNotMatch(rendered, /\u001b|\u0007|SGFja2Vk/);

  const plainTheme = {
    fg: (_color, value) => value,
    bold: (value) => value,
  };
  assert.equal(tool.renderShell, "self");
  assert.match(tool.renderCall({}, plainTheme).render(120).join("\n"), /^Agents/);

  const collapsed = tool.renderResult({
    content: [{ type: "text", text: "unused" }],
    details: { progress: [{
      id: "task-1", agent: "reviewer", thinking: "high", status: "running",
      startedAt: Date.now(), turns: 0, toolCalls: 1, text: "", usage: {},
      currentTool: "read\u001b]52;c;SGFja2Vk\u0007\nfake",
    }, {
      id: "task-2", agent: "researcher", thinking: "low", status: "queued",
      startedAt: Date.now(), turns: 0, toolCalls: 0, text: "", usage: {},
    }] },
  }, { expanded: false }, plainTheme, {
    args: { tasks: [
      { task: "Inspect the current diff" },
      { task: "Research the API" },
    ] },
  }).render(120).join("\n");
  assert.match(collapsed, /  ├─ Review  Inspect the current diff · \d+\.\d+s/);
  assert.match(collapsed, /  │   └ read fake…/);
  assert.match(collapsed, /  └─ 1 queued/);
  assert.doesNotMatch(collapsed, /reviewer\/high|task-1|\u001b|\u0007|SGFja2Vk|\nfake/);
});

test("agent registry contains only fixed read-only non-recursive roles", () => {
  const agents = createAgentRegistry();
  assert.equal(MAX_SUBAGENT_TASKS, 3);
  assert.deepEqual([...agents.keys()], ["reviewer", "researcher"]);

  for (const agent of agents.values()) {
    assert.ok(agent.prompt.length > 0, agent.name);
    assert.ok(agent.maxTurns > 0, agent.name);
    assert.ok(agent.maxToolCalls > 0, agent.name);
    assert.ok(agent.maxReportedTokens > 0, agent.name);
    assert.ok(agent.maxCostUsd > 0, agent.name);
    assert.equal(agent.extensions?.length, 1, agent.name);
    for (const tool of agent.tools) assert.ok(allowedTools.has(tool), `${agent.name}:${tool}`);
  }

  const reviewer = agents.get("reviewer");
  assert.deepEqual(reviewer.tools, ["read", "grep", "find", "ls", "git_status", "git_diff"]);
  assert.match(reviewer.extensions[0], /extensions[/\\]subagent-tools\.ts$/);
  assert.equal(reviewer.contextFiles, true);
  assert.equal(reviewer.thinking, "high");

  const researcher = agents.get("researcher");
  assert.deepEqual(researcher.tools, ["web_search", "web_fetch"]);
  assert.match(researcher.extensions[0], /extensions[/\\]web\.ts$/);
  assert.equal(researcher.contextFiles, false);
  assert.equal(researcher.thinking, "low");
});
