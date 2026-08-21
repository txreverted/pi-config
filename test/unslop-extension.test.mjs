import test from "node:test";
import assert from "node:assert/strict";
import unslopExtension, { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

test("Unslop always injects the full writing checklist", () => {
  const events = new Map();
  const commands = [];
  unslopExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = events.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${UNSLOP_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /UNSLOP MODE ACTIVE/);
  assert.match(result.systemPrompt, /Apply the full checklist to generated chat and persisted prose/);
  assert.match(result.systemPrompt, /Repository style controls persisted text/);
  assert.match(result.systemPrompt, /Never invent facts or opinions/);
  assert.match(result.systemPrompt, /What makes this obviously AI generated\?/);
  assert.match(result.systemPrompt, /Let some mess in/);
  assert.match(result.systemPrompt, /Colon overuse/);
  assert.match(result.systemPrompt, /Say what it does, not how it feels/);
  assert.match(result.systemPrompt, /Prefer the plain word/);
  assert.match(result.systemPrompt, /Avoid em dashes entirely/);
  assert.doesNotMatch(result.systemPrompt, /description:|disable-model-invocation:|license:/);
  assert.deepEqual(commands, []);
});
