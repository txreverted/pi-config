import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import cavemanExtension, { CAVEMAN_INSTRUCTIONS } from "../extensions/caveman.ts";
import ponytailExtension from "../extensions/ponytail.ts";
import unslopExtension from "../extensions/unslop.ts";

const composePolicies = () => {
  const handlers = [];
  const pi = {
    on(event, handler) {
      if (event === "before_agent_start") handlers.push(handler);
    },
  };
  ponytailExtension(pi);
  unslopExtension(pi);
  cavemanExtension(pi);

  let systemPrompt = "BASE";
  for (const handler of handlers) {
    systemPrompt = handler({ systemPrompt }).systemPrompt;
  }
  return systemPrompt;
};

const occurrences = (text, value) => text.split(value).length - 1;

test("Caveman always appends its fixed output policy", () => {
  const handlers = new Map();
  const commands = [];
  cavemanExtension({
    on(event, handler) { handlers.set(event, handler); },
    registerCommand(name) { commands.push(name); },
  });

  const result = handlers.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.equal(result.systemPrompt, `BASE\n\n${CAVEMAN_INSTRUCTIONS}`);
  assert.match(result.systemPrompt, /fewest words that keep the answer correct/);
  assert.match(result.systemPrompt, /Preserve exact code, commands, paths/);
  assert.match(result.systemPrompt, /Never add broken grammar, invented abbreviations/);
  assert.match(result.systemPrompt, /security warnings, irreversible actions/);
  assert.match(result.systemPrompt, /persisted artifacts/i);
  assert.match(result.systemPrompt, /Caveman controls chat length/);
  assert.match(result.systemPrompt, /Style rules never alter exact text or required formats/);
  assert.deepEqual(commands, []);
});

test("fixed policies compose once in Ponytail, Unslop, Caveman order", () => {
  const systemPrompt = composePolicies();
  const ponytail = systemPrompt.indexOf("PONYTAIL MODE ACTIVE");
  const unslop = systemPrompt.indexOf("UNSLOP MODE ACTIVE");
  const caveman = systemPrompt.indexOf("CAVEMAN OUTPUT POLICY");

  assert.ok(systemPrompt.startsWith("BASE\n\n"));
  assert.ok(ponytail > systemPrompt.indexOf("BASE"));
  assert.ok(unslop > ponytail);
  assert.ok(caveman > unslop);
  for (const marker of ["PONYTAIL MODE ACTIVE", "UNSLOP MODE ACTIVE", "CAVEMAN OUTPUT POLICY"]) {
    assert.equal(occurrences(systemPrompt, marker), 1, marker);
  }
  assert.equal(systemPrompt, composePolicies());

  const policy = systemPrompt.slice("BASE\n\n".length);
  const estimatedTokens = estimateTokens({
    role: "user",
    content: [{ type: "text", text: policy }],
    timestamp: 0,
  });
  assert.ok(estimatedTokens <= 2600, `policy estimate ${estimatedTokens} exceeds 2600 tokens`);
});
