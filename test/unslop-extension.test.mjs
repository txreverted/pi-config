import test from "node:test";
import assert from "node:assert/strict";
import unslopExtension, { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

test("Unslop always injects the full writing policy", () => {
  const events = new Map();
  const commands = [];
  unslopExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = events.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${UNSLOP_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /UNSLOP MODE ACTIVE/);
  assert.match(result.systemPrompt, /Apply these instructions to all writing/);
  assert.match(result.systemPrompt, /What makes this obviously AI generated\?/);
  assert.match(result.systemPrompt, /Prefer the plain word/);
  assert.doesNotMatch(result.systemPrompt, /description: Cut AI tells/);
  assert.deepEqual(commands, []);
});
