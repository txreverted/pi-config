import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentRegistry } from "../subagents/registry.ts";
import { runChildAgent } from "../extensions/subagents-core.ts";

if (process.env.PI_LIVE_SUBAGENT !== "1") {
  throw new Error("Live subagent smoke is opt-in because it consumes provider quota. Set PI_LIVE_SUBAGENT=1.");
}
const provider = process.env.PI_PROVIDER?.trim();
const modelId = process.env.PI_MODEL?.trim();
if (!provider || !modelId) throw new Error("PI_PROVIDER and PI_MODEL must identify the live smoke model");
const reviewer = createAgentRegistry().get("reviewer");
assert.ok(reviewer);

const result = await runChildAgent({
  definition: { ...reviewer, thinking: "off" },
  task: {
    id: "live-startup",
    agent: "reviewer",
    task: "Do not call tools. Respond exactly: LIVE_SUBAGENT_READY",
    cwd: resolve(process.cwd()),
  },
  model: `${provider}/${modelId}`,
  invocation: { command: "pi", argsPrefix: [] },
  timeoutMs: 20_000,
});
assert.equal(result.status, "completed", result.error ?? result.stderr);
assert.match(result.output, /LIVE_SUBAGENT_READY/);
console.log(`Live subagent passed in ${Math.round(result.durationMs)}ms.`);

if (process.env.PI_LIVE_SUBAGENT_WORKER === "1") {
  const worker = createAgentRegistry().get("worker");
  assert.ok(worker);
  const cwd = await mkdtemp(join(tmpdir(), "pi-live-subagent-worker-"));
  try {
    const workerResult = await runChildAgent({
      definition: { ...worker, thinking: "off" },
      task: {
        id: "live-worker",
        agent: "worker",
        task: "Create worker-proof.txt in the current working directory with exact content WORKER_READY followed by a newline. Then respond exactly: LIVE_WORKER_READY",
        cwd,
      },
      model: `${provider}/${modelId}`,
      invocation: { command: "pi", argsPrefix: [] },
      timeoutMs: 60_000,
    });
    assert.equal(workerResult.status, "completed", workerResult.error ?? workerResult.stderr);
    assert.match(workerResult.output, /LIVE_WORKER_READY/);
    assert.equal(await readFile(join(cwd, "worker-proof.txt"), "utf8"), "WORKER_READY\n");
    console.log(`Live worker passed in ${Math.round(workerResult.durationMs)}ms.`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
