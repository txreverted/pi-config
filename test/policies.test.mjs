import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import ponytailExtension, { PONYTAIL_INSTRUCTIONS } from "../extensions/ponytail.ts";
import unslopExtension, { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

const estimateText = (text) => estimateTokens({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

const composePolicies = (base) => {
  const handlers = [];
  const pi = {
    on(event, handler) {
      assert.equal(event, "before_agent_start");
      handlers.push(handler);
    },
  };
  ponytailExtension(pi);
  unslopExtension(pi);
  assert.equal(handlers.length, 2);
  return handlers.reduce(
    (systemPrompt, handler) => handler({ systemPrompt }).systemPrompt,
    base,
  );
};

test("policies preserve the current base and inject Ponytail then Unslop once per run", () => {
  for (const base of ["BASE", "BASE\nOther extension guidance", "BASE"]) {
    const systemPrompt = composePolicies(base);
    assert.equal(systemPrompt, `${base}\n\n${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`);
    for (const marker of ["PONYTAIL", "UNSLOP"]) {
      assert.equal(systemPrompt.split(marker).length - 1, 1);
    }
  }
});

test("Unslop injects the policy file", async () => {
  const policy = await readFile(new URL("../policies/UNSLOP.md", import.meta.url), "utf8");
  assert.equal(UNSLOP_INSTRUCTIONS, `UNSLOP\n${policy.replace(/\r\n?/g, "\n").trim()}`);
});

// These assertions guard instruction requirements, not model writing quality.
test("Ponytail retains scope, reuse, and correctness safeguards", () => {
  for (const requirement of [
    /Repo rules, user scope.*win/i,
    /Preserve unrelated work/i,
    /Always active at full strength/i,
    /Search before writing/i,
    /Codebase already has.*Reuse it/s,
    /Standard library.*Use it/s,
    /Native platform.*Prefer/s,
    /Installed dependency.*Reuse it/s,
    /Fix root cause/i,
    /Never omit confirmed scope/i,
    /Never simplify away.*security, accessibility, correctness, data integrity/s,
    /User chooses full implementation: build it/i,
    /Run required canonical checks/i,
    /never claim an unrun check passed/i,
  ]) assert.match(PONYTAIL_INSTRUCTIONS, requirement);
});

test("Unslop balances brevity with grammar, factual fidelity, and required detail", () => {
  for (const requirement of [
    /Repo style.*requested format, tone, and depth win/i,
    /chat and every prose artifact/i,
    /concise, natural, grammatical/i,
    /short sentences/i,
    /Remove unnecessary words/i,
    /Preserve.*technical detail.*meaningful uncertainty.*citations/s,
    /Never invent/i,
    /preserve literal text, code/i,
    /Brevity must not remove/i,
    /security warnings.*irreversible actions.*accessibility requirements.*requested explanations/s,
    /required API documentation complete/i,
  ]) assert.match(UNSLOP_INSTRUCTIONS, requirement);
});

test("individual and combined fixed policy estimates stay within budget", () => {
  assert.ok(estimateText(PONYTAIL_INSTRUCTIONS) <= 750);
  assert.ok(estimateText(UNSLOP_INSTRUCTIONS) <= 600);
  const tokens = estimateText(composePolicies("").trim());
  assert.ok(tokens <= 1_350, `policy estimate ${tokens} exceeds 1,350 tokens`);
});
