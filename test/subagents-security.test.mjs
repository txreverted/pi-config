import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry, createWorkflowRegistry } from "../subagents/registry.ts";
import { validateWorkflowDefinition } from "../extensions/workflows-core.ts";

const allowedTools = new Set([
  "read", "grep", "find", "ls", "bash", "edit", "write", "web_search", "web_fetch",
]);

test("agent registry is fixed, minimal, and non-recursive", () => {
  const agents = createAgentRegistry();
  assert.deepEqual([...agents.keys()], ["scout", "reviewer", "worker", "researcher", "synthesizer"]);
  assert.deepEqual([...agents.values()].filter((agent) => agent.writer).map((agent) => agent.name), ["worker"]);

  for (const agent of agents.values()) {
    assert.ok(agent.prompt.length > 0, agent.name);
    assert.equal(agent.tools.includes("subagent"), false, agent.name);
    assert.equal(agent.tools.includes("workflow"), false, agent.name);
    for (const tool of agent.tools) assert.ok(allowedTools.has(tool), `${agent.name}:${tool}`);
    assert.ok((agent.extensions?.length ?? 0) <= 1, agent.name);
  }

  const researcher = agents.get("researcher");
  assert.deepEqual(researcher.tools, ["read", "web_search", "web_fetch"]);
  assert.equal(researcher.contextFiles, false);
  assert.equal(researcher.extensions.length, 1);
  assert.match(researcher.extensions[0], /extensions[/\\]web\.ts$/);
  assert.equal(agents.get("worker").extensions, undefined);
});

test("all registered workflows are valid and have at most one static writer", () => {
  const agents = createAgentRegistry();
  const workflows = createWorkflowRegistry();
  assert.deepEqual([...workflows.keys()], ["review", "implement-review", "research"]);
  for (const workflow of workflows.values()) {
    validateWorkflowDefinition(workflow, (agent) => agents.get(agent)?.writer === true);
    const writers = workflow.steps.filter((step) => agents.get(step.agent)?.writer);
    assert.ok(writers.length <= 1, workflow.name);
  }
  assert.equal(createWorkflowRegistry().get("review").steps.some((step) => step.agent === "worker"), false);
  assert.equal(createWorkflowRegistry().get("research").steps.some((step) => step.agent === "worker"), false);
  assert.equal(createWorkflowRegistry().get("implement-review").steps.filter((step) => step.agent === "worker").length, 1);
});
