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
  assert.match(result.systemPrompt, /smallest safe implementation that satisfies every explicit requirement/);
  assert.match(result.systemPrompt, /tiny diff in the wrong owner is not minimal/);
  assert.match(result.systemPrompt, /build it without repeating the simplification argument/);
  assert.match(result.systemPrompt, /Finish all planned edits, then run one canonical aggregate check/);
  assert.match(result.systemPrompt, /Do not run its parts separately or repeat a passing check/);
  assert.match(result.systemPrompt, /Rerun only after fixing a failure or making later edits/);
  assert.match(result.systemPrompt, /behavior and scope the user explicitly confirms/);
  assert.match(result.systemPrompt, /Never remove or weaken/);
  assert.deepEqual(commands, []);
});
