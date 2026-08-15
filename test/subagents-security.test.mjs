import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../subagents/registry.ts";

const allowedTools = new Set([
  "read", "grep", "find", "ls", "web_search", "web_fetch", "git_status", "git_diff",
]);

test("agent registry contains only fixed read-only non-recursive roles", () => {
  const agents = createAgentRegistry();
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
