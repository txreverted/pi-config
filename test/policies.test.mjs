import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import policiesExtension, {
  POLICY_INSTRUCTIONS,
  PONYTAIL_INSTRUCTIONS,
  UNSLOP_INSTRUCTIONS,
} from "../extensions/policies.ts";

const estimateText = (text) => estimateTokens({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

const loadPolicies = () => {
  const handlers = [];
  policiesExtension({
    on(event, handler) {
      assert.equal(event, "before_agent_start");
      handlers.push(handler);
    },
  });
  assert.equal(handlers.length, 1);
  return (base, prompt, ctx) => handlers[0]({ type: "before_agent_start", systemPrompt: base, prompt }, ctx).systemPrompt;
};

test("policies preserve each run's base and inject once regardless of mode or prompt", () => {
  const composePolicies = loadPolicies();
  for (const mode of ["tui", "rpc", "json", "print"]) {
    for (const prompt of ["Fix the bug", "ponytail lite", "stop ponytail", "Explain this code"]) {
      for (const base of ["", "BASE\nOther extension guidance", "BASE"]) {
        const systemPrompt = composePolicies(base, prompt, { mode, hasUI: mode === "tui" || mode === "rpc" });
        assert.equal(systemPrompt, `${base}\n\n${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`);
        for (const marker of ["PONYTAIL", "UNSLOP"]) {
          assert.equal(systemPrompt.split(marker).length - 1, 1);
        }
      }
    }
  }
});

test("each policy injects its named file", async () => {
  for (const [name, instructions] of [["PONYTAIL", PONYTAIL_INSTRUCTIONS], ["UNSLOP", UNSLOP_INSTRUCTIONS]]) {
    const policy = await readFile(new URL(`../policies/${name}.md`, import.meta.url), "utf8");
    assert.equal(instructions, `${name}\n${policy.replace(/\r\n?/g, "\n").trim()}`);
  }
});

// These assertions guard safety clauses, not model compliance or output quality.
test("Ponytail retains scope, authorization, and correctness safeguards", () => {
  for (const requirement of [
    /Repo rules, user scope.*win/i,
    /Preserve unrelated work/i,
    /full reuse ladder/i,
    /no intensity modes or stop commands/i,
    /User requirements override policy defaults/i,
    /without rearguing or substituting a reduced version/i,
    /Get approval for destructive actions or external writes unless already authorized/i,
    /External writes change remote or shared systems/i,
    /Ordinary authorized local edits need no extra approval/i,
    /Never simplify away.*security, accessibility, correctness, data integrity/s,
    /Never omit confirmed scope/i,
    /retain required tuning controls/i,
    /Reuse the repo test stack/i,
    /never claim an unrun check passed/i,
  ]) assert.match(PONYTAIL_INSTRUCTIONS, requirement);
});

test("Unslop retains factual fidelity and required detail", () => {
  for (const requirement of [
    /Repo style.*requested format, tone, and depth win/i,
    /Style preferences are defaults, not mechanical substitutions/i,
    /Preserve.*technical detail.*meaningful uncertainty.*citations/s,
    /Never invent/i,
    /preserve literal text, code/i,
    /Brevity must not remove/i,
  ]) assert.match(UNSLOP_INSTRUCTIONS, requirement);
});

test("manual comparison fixtures load with bounded inputs and separate review criteria", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/policy-cases.json", import.meta.url), "utf8"));
  assert.ok(cases.length > 0);
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
  for (const entry of cases) {
    assert.match(entry.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(typeof entry.prompt, "string");
    assert.ok(entry.prompt.trim());
    assert.ok(Object.keys(entry.files).length > 0);
    for (const [path, text] of Object.entries(entry.files)) {
      assert.match(path, /^[a-zA-Z0-9_.-]+\.(?:mjs|json|md)$/);
      assert.equal(typeof text, "string");
      assert.ok(text.trim());
    }
    assert.ok(Array.isArray(entry.review) && entry.review.length > 0);
    for (const criterion of entry.review) {
      assert.equal(typeof criterion, "string");
      assert.ok(criterion.trim());
    }
    if (entry.clarification !== undefined) {
      assert.equal(typeof entry.clarification, "string");
      assert.ok(entry.clarification.trim());
    }
    const tokens = estimateText(JSON.stringify({
      files: entry.files, prompt: entry.prompt, clarification: entry.clarification,
    }));
    assert.ok(tokens <= 2_000, `${entry.id} input estimate ${tokens} exceeds 2,000 tokens`);
  }
});

test("combined fixed policy estimate stays within budget", () => {
  const tokens = estimateText(POLICY_INSTRUCTIONS);
  assert.ok(tokens <= 1_450, `policy estimate ${tokens} exceeds 1,450 tokens`);
});
