import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import ponytailExtension, { PONYTAIL_INSTRUCTIONS } from "../extensions/ponytail.ts";

test("Ponytail always injects its compressed policy without registering controls", () => {
  const events = new Map();
  const commands = [];
  ponytailExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = events.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${PONYTAIL_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /Smallest safe code meeting explicit requirements/);
  assert.match(result.systemPrompt, /Before edits trace callers\/owner\/failures/);
  assert.match(result.systemPrompt, /working\/no change, project reuse, platform\/stdlib, deletion/);
  assert.match(result.systemPrompt, /No dependency for a small local need/);
  assert.match(result.systemPrompt, /Cut code, not investigation/);
  assert.match(result.systemPrompt, /fix shared root at its owner/);
  assert.match(result.systemPrompt, /Reject speculative behavior\/APIs\/abstractions\/dependencies\/factories\/wrappers\/config\/extensions\/scaffolds/);
  assert.match(result.systemPrompt, /Build confirmed scope, including requested larger work/);
  assert.match(result.systemPrompt, /ponytail: <ceiling>; upgrade when <trigger>/);
  assert.match(result.systemPrompt, /one required canonical repo check; rerun only after relevant change/);
  assert.match(result.systemPrompt, /Reuse tests; cover nontrivial behavior or money\/security/);
  assert.match(result.systemPrompt, /Never weaken correctness\/understanding, boundary security\/validation/);
  assert.match(result.systemPrompt, /data integrity\/loss, accessibility, or stated scope\/detail/);
  assert.ok(estimateTokens({ role: "user", content: [{ type: "text", text: PONYTAIL_INSTRUCTIONS }], timestamp: 0 }) <= 210);
  assert.deepEqual(commands, []);
});
