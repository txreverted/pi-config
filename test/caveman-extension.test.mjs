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
  assert.match(result.systemPrompt, /Lead with result in fewest clear words/);
  assert.match(result.systemPrompt, /filler\/repetition\/hedging\/self\/tool narration/);
  assert.match(result.systemPrompt, /user language, clear fragments/);
  assert.match(result.systemPrompt, /exact artifacts\/values\/units\/errors\/negations\/qualifiers\/formats/);
  assert.match(result.systemPrompt, /Full prose for order\/cause\/ambiguity\/risk, security\/irreversible acts/);
  assert.match(result.systemPrompt, /clarification\/requests/);
  assert.match(result.systemPrompt, /No invented shorthand\/arrows\/recap theater/);
  assert.match(result.systemPrompt, /Files use repo format, not chat shorthand/);
  assert.match(result.systemPrompt, /User detail\/format wins/);
  assert.match(result.systemPrompt, /User\/repo\/correctness\/safety win/);
  assert.match(result.systemPrompt, /Ponytail scopes code, Unslop prose, Caveman chat/);
  assert.ok(estimateTokens({ role: "user", content: [{ type: "text", text: CAVEMAN_INSTRUCTIONS }], timestamp: 0 }) <= 130);
  assert.deepEqual(commands, []);
});

test("fixed policies compose once in Ponytail, Unslop, Caveman order", () => {
  const systemPrompt = composePolicies();
  const ponytail = systemPrompt.indexOf("PONYTAIL");
  const unslop = systemPrompt.indexOf("UNSLOP");
  const caveman = systemPrompt.indexOf("CAVEMAN");

  assert.ok(systemPrompt.startsWith("BASE\n\n"));
  assert.ok(ponytail > systemPrompt.indexOf("BASE"));
  assert.ok(unslop > ponytail);
  assert.ok(caveman > unslop);
  for (const marker of ["PONYTAIL", "UNSLOP", "CAVEMAN"]) {
    assert.equal(occurrences(systemPrompt, marker), 1, marker);
  }
  assert.equal(systemPrompt, composePolicies());

  const policy = systemPrompt.slice("BASE\n\n".length);
  const estimatedTokens = estimateTokens({
    role: "user",
    content: [{ type: "text", text: policy }],
    timestamp: 0,
  });
  assert.ok(estimatedTokens <= 500, `policy estimate ${estimatedTokens} exceeds 500-token target`);
  assert.ok(estimatedTokens <= 600, `policy estimate ${estimatedTokens} exceeds 600-token hard limit`);
});
