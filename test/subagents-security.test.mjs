import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRegistry } from "../subagents/registry.ts";
import { createWorkflowRegistry } from "../subagents/workflows-registry.ts";
import { validateWorkflowDefinition } from "../extensions/workflows-core.ts";

const allowedTools = new Set([
  "read", "grep", "find", "ls", "bash", "edit", "write", "web_search", "web_fetch",
  "git_status", "git_diff",
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
    if (agent.writer) {
      assert.equal(agent.maxTurns, undefined);
      assert.equal(agent.maxToolCalls, undefined);
      assert.equal(agent.maxReportedTokens, undefined);
      assert.equal(agent.maxCostUsd, undefined);
    } else {
      assert.ok(agent.maxTurns > 0, agent.name);
      assert.ok(agent.maxToolCalls > 0, agent.name);
      assert.ok(agent.maxReportedTokens > 0, agent.name);
      assert.ok(agent.maxCostUsd > 0, agent.name);
    }
  }

  const reviewer = agents.get("reviewer");
  assert.equal(reviewer.maxToolCalls, 96);
  assert.equal(reviewer.maxReportedTokens, 2_000_000);
  assert.equal(reviewer.maxCostUsd, 2);
  assert.match(reviewer.prompt, /tool budget is finite/i);
  assert.doesNotMatch(reviewer.prompt, /No quota/i);

  const researcher = agents.get("researcher");
  assert.deepEqual(researcher.tools, ["web_search", "web_fetch"]);
  assert.equal(researcher.contextFiles, false);
  assert.equal(researcher.extensions.length, 1);
  assert.match(researcher.extensions[0], /extensions[/\\]web\.ts$/);
  assert.equal(agents.get("worker").extensions, undefined);
  assert.deepEqual(Object.fromEntries([...agents].map(([name, agent]) => [name, agent.thinking])), {
    scout: "low",
    reviewer: "high",
    worker: "high",
    researcher: "low",
    synthesizer: "high",
  });
  assert.equal([...agents.values()].some((agent) => agent.thinking === "xhigh" || agent.thinking === "max"), false);

  for (const name of ["scout", "reviewer", "synthesizer"]) {
    const agent = agents.get(name);
    assert.ok(agent.tools.includes("git_status"), name);
    assert.ok(agent.tools.includes("git_diff"), name);
    assert.equal(agent.extensions.length, 1, name);
    assert.match(agent.extensions[0], /extensions[/\\]subagent-tools\.ts$/, name);
  }
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

  const securitySteps = [...createWorkflowRegistry().values()]
    .flatMap((workflow) => workflow.steps)
    .filter((step) => step.id === "security-review");
  assert.equal(securitySteps.length, 2);
  assert.ok(securitySteps.every((step) => step.thinking === "high"));
  assert.equal([...createWorkflowRegistry().values()].flatMap((workflow) => workflow.steps).some((step) => step.thinking === "xhigh" || step.thinking === "max"), false);
});
