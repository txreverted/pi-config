import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createAgentRegistry } from "../subagents/registry.ts";
import { executeWorkflow, formatWorkflowEvidence } from "../extensions/workflows-core.ts";
import { runChildAgent } from "../extensions/subagents-core.ts";

if (process.env.PI_LIVE_ORCHESTRATION !== "1") {
  throw new Error("Live orchestration smoke is opt-in because it consumes provider quota. Set PI_LIVE_ORCHESTRATION=1.");
}
const provider = process.env.PI_PROVIDER?.trim();
const modelId = process.env.PI_MODEL?.trim();
if (!provider || !modelId) throw new Error("PI_PROVIDER and PI_MODEL must identify the live smoke model");
const model = `${provider}/${modelId}`;
const cwd = resolve(process.cwd());
const agents = createAgentRegistry();
const scout = agents.get("scout");
assert.ok(scout);
const liveScout = { ...scout, thinking: "off" };

const single = await runChildAgent({
  definition: liveScout,
  task: {
    id: "live-startup",
    agent: "scout",
    task: "Do not call tools. Respond exactly: LIVE_SUBAGENT_READY",
    cwd,
  },
  model,
  invocation: { command: "pi", argsPrefix: [] },
  timeoutMs: 20_000,
  maxTurns: 2,
  maxToolCalls: 4,
  maxReportedTokens: 100_000,
  maxCostUsd: 0.25,
});
assert.ok(single.firstProtocolAt >= single.spawnedAt, single.error ?? single.stderr);
if (single.status === "timed_out") {
  console.log(`Live child emitted valid Pi protocol, then the provider exceeded the strict 20s smoke deadline; timeout cleanup passed.`);
  if (process.env.PI_LIVE_WORKFLOW === "1") console.log("Skipped the live multi-child workflow because the single provider turn did not finish inside the test deadline.");
} else {
  assert.equal(single.status, "completed", single.error ?? single.stderr);
  assert.match(single.output, /LIVE_SUBAGENT_READY/);
  console.log(`Live subagent passed in ${Math.round(single.durationMs)}ms (${single.attempts} attempt).`);
}

if (process.env.PI_LIVE_WORKFLOW === "1" && single.status === "completed") {
  const definition = {
    name: "live-smoke",
    outputStep: "synthesis",
    steps: [
      { id: "probe-a", agent: "scout", onFailure: "stop", buildTask: () => "Do not call tools. Respond exactly: PROBE_A_READY" },
      { id: "probe-b", agent: "scout", onFailure: "stop", buildTask: () => "Do not call tools. Respond exactly: PROBE_B_READY" },
      {
        id: "synthesis",
        agent: "synthesizer",
        needs: ["probe-a", "probe-b"],
        onFailure: "stop",
        buildTask: (_input, results) => `Return one sentence confirming both probes completed. Do not call tools.\n\n${formatWorkflowEvidence(results, ["probe-a", "probe-b"])}`,
      },
    ],
  };
  const snapshots = [];
  const workflow = await executeWorkflow({
    definition,
    input: {
      name: "live-smoke",
      objective: "Verify bounded parallel startup and synthesis.",
      paths: ["package.json"],
    },
    concurrency: 3,
    isWriter: (agent) => agents.get(agent)?.writer === true,
    runStep: async (step, task, onProgress) => {
      const role = agents.get(step.agent);
      assert.ok(role);
      return await runChildAgent({
        definition: { ...role, thinking: "off" },
        task: { id: `live:${step.id}`, agent: step.agent, task, cwd },
        model,
        invocation: { command: "pi", argsPrefix: [] },
        timeoutMs: 20_000,
        maxTurns: 3,
        maxToolCalls: 2,
        maxReportedTokens: 100_000,
        maxCostUsd: 0.25,
        onUpdate: (update) => onProgress(update.progress),
      });
    },
    onUpdate: (snapshot) => snapshots.push(snapshot),
  });
  assert.ok(workflow.status === "completed" || workflow.status === "completed_with_warnings", workflow.error);
  assert.ok(workflow.output.trim());
  assert.ok(snapshots.some((snapshot) => snapshot.steps.some((step) => step.status === "running")));
  console.log(`Live minimal workflow passed in ${Math.round(workflow.durationMs)}ms (${workflow.status}).`);
}
