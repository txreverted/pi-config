import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runChildAgent } from "../extensions/subagents/runner.ts";
import { ROLE_DEFINITIONS } from "../extensions/subagents/roles.ts";

if (process.env.PI_LIVE_SUBAGENT !== "1") {
  throw new Error("Live subagent smoke is opt-in because it consumes provider quota. Set PI_LIVE_SUBAGENT=1.");
}
const provider = process.env.PI_PROVIDER?.trim();
const model = process.env.PI_MODEL?.trim();
if (!provider || !model) throw new Error("PI_PROVIDER and PI_MODEL must identify the live smoke model");

const startedAt = Date.now();
const result = await runChildAgent({
  task: {
    id: "live-startup",
    role: "explorer",
    title: "Live startup",
    objective: "Return the required marker",
    contextFiles: [],
    acceptanceCriteria: ["Summary contains LIVE_SUBAGENT_READY"],
    writeScope: [],
  },
  workspace: resolve(process.cwd()),
  model: `${provider}/${model}`,
  thinking: "off",
  prompt: "Do not inspect files. Call agent_result alone with status succeeded, summary LIVE_SUBAGENT_READY, and empty evidence.",
  systemPrompt: ROLE_DEFINITIONS.explorer.prompt,
  trusted: false,
  runtimeMs: 60_000,
});
assert.equal(result.status, "succeeded", result.error ?? result.stderr);
assert.match(result.result?.summary ?? "", /LIVE_SUBAGENT_READY/);
console.log(`Live subagent passed in ${Date.now() - startedAt}ms using ${result.model}.`);
