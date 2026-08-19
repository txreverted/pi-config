import test from "node:test";
import assert from "node:assert/strict";
import ponytailExtension, { PONYTAIL_INSTRUCTIONS } from "../extensions/ponytail.ts";

test("Ponytail always injects the full policy without registering controls", () => {
  const events = new Map();
  const commands = [];
  ponytailExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = events.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${PONYTAIL_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /PONYTAIL MODE ACTIVE - level: full/);
  assert.match(result.systemPrompt, /smallest safe interpretation/);
  assert.match(result.systemPrompt, /Never remove or weaken/);
  assert.deepEqual(commands, []);
});
