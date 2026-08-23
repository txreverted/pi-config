import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import unslopExtension, { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

test("Unslop always injects its compressed writing policy", () => {
  const events = new Map();
  const commands = [];
  unslopExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = events.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${UNSLOP_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /UNSLOP/);
  assert.match(result.systemPrompt, /Repo style wins files/);
  assert.match(result.systemPrompt, /Keep meaning\/tone\/facts\/literals\/citations\/data\/formats/);
  assert.match(result.systemPrompt, /invent no fact\/opinion\/mess/);
  assert.match(result.systemPrompt, /Plain\/concrete\/active\/specific; name actors\/sources\/mechanisms\/numbers/);
  assert.match(result.systemPrompt, /puffery\/promotion\/vague attribution, AI formulas/);
  assert.match(result.systemPrompt, /forced groups\/ranges, synonym churn, jargon, filler\/hedging/);
  assert.match(result.systemPrompt, /generic endings, chatbot\/sycophancy/);
  assert.match(result.systemPrompt, /Keep supported nuance\/natural rhythm; write grammatical prose/);
  assert.match(result.systemPrompt, /"I" only for real judgment\/act\/limit or supplied speaker/);
  assert.match(result.systemPrompt, /No em dash\/substitute/);
  assert.match(result.systemPrompt, /sparse parentheses; list\/example colons; useful bold/);
  assert.match(result.systemPrompt, /sentence case\/straight quotes; no emoji\/restated labels/);
  assert.match(result.systemPrompt, /Self-audit AI tells/);
  assert.match(result.systemPrompt, /specify\/cut generic\/feeling lines/);
  assert.doesNotMatch(result.systemPrompt, /description:|disable-model-invocation:|license:/);
  assert.ok(estimateTokens({ role: "user", content: [{ type: "text", text: UNSLOP_INSTRUCTIONS }], timestamp: 0 }) <= 165);
  assert.deepEqual(commands, []);
});
