import test from "node:test";
import assert from "node:assert/strict";
import conciseExtension, { CONCISE_RESPONSE_POLICY } from "../extensions/concise.ts";
import ponytailExtension from "../extensions/ponytail.ts";

test("Caveman policy is always appended without replacing the base prompt", () => {
  const handlers = new Map();
  conciseExtension({ on(event, handler) { handlers.set(event, handler); } });

  const result = handlers.get("before_agent_start")({ systemPrompt: "BASE" });
  assert.match(result.systemPrompt, /^BASE\n\nCAVEMAN OUTPUT POLICY/);
  assert.match(result.systemPrompt, /Prefer short words and fragments when clear/);
  assert.match(result.systemPrompt, /Preserve exact code, commands, paths/);
  assert.match(result.systemPrompt, /security warnings, irreversible actions/);
  assert.match(result.systemPrompt, /documentation that is short, direct, concrete/i);
  assert.match(result.systemPrompt, /persisted artifacts/i);
  assert.match(result.systemPrompt, /user's requested format and level of detail win/i);
  assert.equal(result.systemPrompt.endsWith(CONCISE_RESPONSE_POLICY), true);
});

test("Caveman policy composes before permanent full Ponytail", () => {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
  conciseExtension(pi);
  ponytailExtension(pi);

  let systemPrompt = "BASE";
  for (const handler of handlers.get("before_agent_start") ?? []) {
    systemPrompt = handler({ systemPrompt }).systemPrompt;
  }
  assert.ok(systemPrompt.indexOf(CONCISE_RESPONSE_POLICY) > systemPrompt.indexOf("BASE"));
  assert.ok(systemPrompt.indexOf("PONYTAIL MODE ACTIVE - level: full") > systemPrompt.indexOf(CONCISE_RESPONSE_POLICY));
});
