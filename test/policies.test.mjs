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

const loadPolicies = () => {
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
  return (base, prompt, ctx) => handlers.reduce(
    (systemPrompt, handler) => handler({ type: "before_agent_start", systemPrompt, prompt }, ctx).systemPrompt,
    base,
  );
};

test("loaded policies preserve each run's base and inject once regardless of mode or prompt", () => {
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

test("Unslop injects the policy file", async () => {
  const policy = await readFile(new URL("../policies/UNSLOP.md", import.meta.url), "utf8");
  assert.equal(UNSLOP_INSTRUCTIONS, `UNSLOP\n${policy.replace(/\r\n?/g, "\n").trim()}`);
});

// These assertions guard instruction requirements, not model compliance or output quality.
test("Ponytail retains scope, reuse, and correctness safeguards", () => {
  for (const requirement of [
    /Repo rules, user scope.*win/i,
    /Preserve unrelated work/i,
    /Always active at full strength/i,
    /No modes, toggles, or suspension/i,
    /Explicit user instructions override skill defaults within system and repository constraints/i,
    /If a loaded instruction blocks work, cite its file and exact clause/i,
    /Treat action requests.*as instructions to complete the work/i,
    /Complete independent authorized work before asking about blockers/i,
    /Get approval for destructive actions or external writes unless already authorized/i,
    /Search before writing/i,
    /Codebase already has.*Reuse it/s,
    /Standard library.*Use it/s,
    /Native platform.*Prefer/s,
    /Installed dependency.*Reuse it/s,
    /Choose the highest sound rung/i,
    /Minimize maintained code, files, dependencies, and moving parts, not just LOC/i,
    /Never compress readable logic into clever one-liners/i,
    /Choose algorithms for correct edge cases and supported workloads; optimize only for evidenced needs/i,
    /Shorten the solution, never the investigation/i,
    /smallest clear, complete diff/i,
    /Fix root cause at the shared owner/i,
    /Inspect every caller and sibling path/i,
    /ponytail: <ceiling>; upgrade when <measured trigger>/i,
    /Never omit confirmed scope/i,
    /Never simplify away.*security, accessibility, correctness, data integrity/s,
    /User chooses full implementation: build it/i,
    /focused regression check for changed nontrivial logic/i,
    /Remove unnecessary code introduced by the change/i,
    /Run required canonical checks/i,
    /After they pass, broaden or repeat only for new changes, failures, or unresolved concerns/i,
    /never claim an unrun check passed/i,
  ]) assert.match(PONYTAIL_INSTRUCTIONS, requirement);
});

test("Unslop balances brevity with grammar, factual fidelity, and required detail", () => {
  for (const requirement of [
    /Repo style.*requested format, tone, and depth win/i,
    /chat and every prose artifact/i,
    /concise, natural, grammatical/i,
    /short sentences/i,
    /Default to concise paragraphs/i,
    /Use lists for parallel items or steps, tables for comparisons/i,
    /Match the reader's technical background and requested format/i,
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
  assert.ok(estimateText(PONYTAIL_INSTRUCTIONS) <= 850);
  assert.ok(estimateText(UNSLOP_INSTRUCTIONS) <= 600);
  const tokens = estimateText(loadPolicies()("").trim());
  assert.ok(tokens <= 1_450, `policy estimate ${tokens} exceeds 1,450 tokens`);
});
