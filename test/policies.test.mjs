import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import cavemanExtension, { CAVEMAN_INSTRUCTIONS } from "../extensions/caveman.ts";
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
  cavemanExtension(pi);

  return handlers.reduce(
    (systemPrompt, handler) => handler({ systemPrompt }).systemPrompt,
    "BASE",
  );
};

test("fixed policies inject once in Ponytail, Unslop, then Caveman order", () => {
  const systemPrompt = composePolicies();
  assert.equal(systemPrompt, `BASE\n\n${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}\n\n${CAVEMAN_INSTRUCTIONS}`);
  assert.equal(systemPrompt, composePolicies());
  for (const marker of ["PONYTAIL", "UNSLOP", "CAVEMAN"]) {
    assert.equal(systemPrompt.split(marker).length - 1, 1);
  }
});

test("Ponytail retains the upstream implementation ladder and safety boundaries", () => {
  assert.match(PONYTAIL_INSTRUCTIONS, /Lazy senior developer\. Efficient, not careless/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Repo rules, user scope, and nearby style win/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Always active at full strength/);
  assert.match(PONYTAIL_INSTRUCTIONS, /No modes, toggles, or suspension/);
  assert.doesNotMatch(PONYTAIL_INSTRUCTIONS, /User may request lite|Ultra:|Stop ponytail|normal mode/);
  assert.match(PONYTAIL_INSTRUCTIONS, /requirements, callers, owner, inputs, state, outputs, failures, and supported cases/);
  for (const rung of [
    /Need exists\? Skip speculative work/,
    /Codebase already has helper, type, or pattern\? Reuse it/,
    /Standard library covers it\? Use it/,
    /Native platform covers it/,
    /Installed dependency covers it/,
    /One clear line works/,
    /minimum complete code/,
  ]) assert.match(PONYTAIL_INSTRUCTIONS, rung);
  assert.match(PONYTAIL_INSTRUCTIONS, /Fix root cause, not reported symptom/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Inspect every caller and sibling path/);
  assert.match(PONYTAIL_INSTRUCTIONS, /No unrequested interface with one implementation, factory for one product/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Deletion over addition\. Boring over clever/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Never omit confirmed scope/);
  assert.match(PONYTAIL_INSTRUCTIONS, /ponytail: <ceiling>; upgrade when <measured trigger>/);
  assert.match(PONYTAIL_INSTRUCTIONS, /validation at trust boundaries/);
  assert.match(PONYTAIL_INSTRUCTIONS, /security, accessibility, correctness, data integrity/);
  assert.match(PONYTAIL_INSTRUCTIONS, /Real clocks drift and sensors vary/);
  assert.match(PONYTAIL_INSTRUCTIONS, /User chooses full implementation: build it without rearguing/);
  assert.match(PONYTAIL_INSTRUCTIONS, /smallest focused check that fails for changed nontrivial logic/);
  assert.doesNotMatch(PONYTAIL_INSTRUCTIONS, /chat response|fewest words|unrequested explanation/);
  assert.match(PONYTAIL_INSTRUCTIONS, /review the final diff and touched flow for root cause, correctness, duplication, scope, unrelated edits, missing safeguards, and unsupported claims/);
  assert.match(PONYTAIL_INSTRUCTIONS, /never claim an unrun check passed/);
  assert.ok(estimateText(PONYTAIL_INSTRUCTIONS) <= 750);
});

test("Unslop retains the upstream audit in compact operational form", () => {
  assert.match(UNSLOP_INSTRUCTIONS, /Repo style and requested format win/);
  assert.match(UNSLOP_INSTRUCTIONS, /facts, literals, values, qualifiers, citations, data, code/);
  assert.match(UNSLOP_INSTRUCTIONS, /identifiers, APIs, commands, paths, URLs, exact errors or logs, SQL, regex, fixtures, snapshots/);
  assert.match(UNSLOP_INSTRUCTIONS, /quoted or legal text, numbers, negation, or user wording/);
  assert.match(UNSLOP_INSTRUCTIONS, /every human-readable artifact/);
  for (const artifact of [
    /Markdown and MDX/,
    /README files, docs, changelogs, and release notes/,
    /code comments and docstrings/,
    /JSDoc and TSDoc/,
    /commit, PR, and issue text/,
    /TODOs; user-facing copy/,
  ]) assert.match(UNSLOP_INSTRUCTIONS, artifact);
  assert.match(UNSLOP_INSTRUCTIONS, /Invent no fact, opinion, source, quote, certainty, or personality/);
  assert.match(UNSLOP_INSTRUCTIONS, /plain, concrete, active, specific language/);
  assert.match(UNSLOP_INSTRUCTIONS, /Keep human voice\. Vary rhythm naturally/);
  assert.match(UNSLOP_INSTRUCTIONS, /Acknowledge supported complexity\. Be specific/);
  assert.match(UNSLOP_INSTRUCTIONS, /evidence-backed judgment instead of mechanical pros and cons/);
  assert.doesNotMatch(UNSLOP_INSTRUCTIONS, /Maximum safe compression|fewest words that keep/);
  assert.match(UNSLOP_INSTRUCTIONS, /What makes this obviously AI-generated/);
  for (const pattern of [
    /Puffery/,
    /Name-dropping/,
    /Superficial -ing tails/,
    /Promotional copy/,
    /Vague attribution/,
    /Stock AI words/,
    /Forced groups of three/,
    /Synonym cycling/,
    /False .* ranges/,
    /Avoid em dashes/,
    /inline-header bullets/,
    /Chat artifacts/,
    /stacked hedges/,
    /ornamental abstraction/,
    /Prefer active voice/,
  ]) assert.match(UNSLOP_INSTRUCTIONS, pattern);
  assert.match(UNSLOP_INSTRUCTIONS, /Comments and docstrings explain intent, constraints, invariants, or non-obvious behavior/);
  assert.match(UNSLOP_INSTRUCTIONS, /Do not narrate visible code/);
  assert.match(UNSLOP_INSTRUCTIONS, /Keep complete grammar for security warnings, destructive actions, migration order, legal or accessibility requirements, and ambiguous product copy/);
  assert.match(UNSLOP_INSTRUCTIONS, /Final pass every chat response and prose artifact, including comments and docs/);
  assert.match(UNSLOP_INSTRUCTIONS, /Technical substance stays/);
  assert.match(UNSLOP_INSTRUCTIONS, /Do not force personality/);
  assert.ok(estimateText(UNSLOP_INSTRUCTIONS) <= 1_200);
});

test("Caveman limits all non-code output without changing required detail", () => {
  assert.match(CAVEMAN_INSTRUCTIONS, /Apply to all human-readable non-code output/);
  for (const artifact of [
    /chat, docs, comments and docstrings/,
    /commit and PR text, issues, TODOs, and user-facing copy/,
  ]) assert.match(CAVEMAN_INSTRUCTIONS, artifact);
  assert.match(CAVEMAN_INSTRUCTIONS, /Respond terse like smart caveman/);
  assert.match(CAVEMAN_INSTRUCTIONS, /All technical substance stays\. Only fluff dies/);
  assert.match(CAVEMAN_INSTRUCTIONS, /requested format and detail win/);
  assert.match(CAVEMAN_INSTRUCTIONS, /Drop articles, filler, pleasantries/);
  assert.match(CAVEMAN_INSTRUCTIONS, /Fragments are OK\. Prefer short words\. Keep technical terms exact\. Code unchanged/);
  assert.match(CAVEMAN_INSTRUCTIONS, /Lead with result\. State cause, effect, and action directly/);
  assert.match(CAVEMAN_INSTRUCTIONS, /\[thing\] \[action\] \[reason\]\. \[next step\]\./);
  assert.match(CAVEMAN_INSTRUCTIONS, /Preserve exact commands, paths, names, numbers, units, errors, negations, qualifiers, citations, and formats/);
  assert.match(CAVEMAN_INSTRUCTIONS, /Auto-clarity: use complete prose and normal detail for security warnings, irreversible actions, user confusion, clarification, and requested explanations/);
  assert.doesNotMatch(CAVEMAN_INSTRUCTIONS, /implementation scope|AI-generated|Puffery/);
  assert.ok(estimateText(CAVEMAN_INSTRUCTIONS) <= 240);
});

test("combined fixed policy estimate stays within budget", () => {
  const policy = composePolicies().slice("BASE\n\n".length);
  assert.ok(estimateText(policy) <= 2_200);
});
