import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import ponytailExtension, { PONYTAIL_INSTRUCTIONS } from "../extensions/ponytail.ts";
import unslopExtension, { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

const estimateText = (text) => estimateTokens({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

const composePolicies = () => {
  const handlers = [];
  const pi = {
    on(event, handler) {
      if (event === "before_agent_start") handlers.push(handler);
    },
  };
  ponytailExtension(pi);
  unslopExtension(pi);

  return handlers.reduce(
    (systemPrompt, handler) => handler({ systemPrompt }).systemPrompt,
    "BASE",
  );
};

test("fixed policies inject once in Ponytail then Unslop order", () => {
  const systemPrompt = composePolicies();
  assert.equal(systemPrompt, `BASE\n\n${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`);
  assert.equal(systemPrompt, composePolicies());
  assert.equal(systemPrompt.split("PONYTAIL").length - 1, 1);
  assert.equal(systemPrompt.split("UNSLOP").length - 1, 1);
});

test("Ponytail preserves minimal implementation and verification semantics", () => {
  assert.match(PONYTAIL_INSTRUCTIONS, /repo rules and nearby style/);
  assert.match(PONYTAIL_INSTRUCTIONS, /preserve unrelated changes/);
  assert.match(PONYTAIL_INSTRUCTIONS, /requirements, callers, owner, state, failures, and supported cases/);
  assert.match(PONYTAIL_INSTRUCTIONS, /no change, deletion, or project\/platform reuse/);
  assert.match(PONYTAIL_INSTRUCTIONS, /smallest complete root-cause fix at its owner/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Deliver full scope/);
  assert.match(PONYTAIL_INSTRUCTIONS, /correctness, security, accessibility, validation, data integrity, or detail/);
  assert.match(PONYTAIL_INSTRUCTIONS, /canonical check and focused tests for changed behavior/);
  assert.ok(estimateText(PONYTAIL_INSTRUCTIONS) <= 150);
});

test("Unslop preserves exact content while producing concise natural prose", () => {
  assert.match(UNSLOP_INSTRUCTIONS, /Repo style and requested formats win/);
  assert.match(UNSLOP_INSTRUCTIONS, /facts, literals, values, qualifiers, citations/);
  assert.match(UNSLOP_INSTRUCTIONS, /fix grammar, invent nothing/);
  assert.match(UNSLOP_INSTRUCTIONS, /Lead with result/);
  assert.match(UNSLOP_INSTRUCTIONS, /concise active prose with natural nuance/);
  assert.match(UNSLOP_INSTRUCTIONS, /filler, repetition, puffery, vague claims, generic conclusions/);
  assert.match(UNSLOP_INSTRUCTIONS, /sycophancy, chatbot ornament, self-reference, and tool narration/);
  assert.match(UNSLOP_INSTRUCTIONS, /Audit AI patterns/);
  assert.ok(estimateText(UNSLOP_INSTRUCTIONS) <= 90);
});

test("combined fixed policy estimate stays within budget", () => {
  const policy = composePolicies().slice("BASE\n\n".length);
  assert.ok(estimateText(policy) <= 250);
});
