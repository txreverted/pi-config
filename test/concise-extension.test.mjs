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

test("Caveman policy composes before Ponytail and remains when Ponytail is off", async () => {
  const handlers = new Map();
  const commands = new Map();
  const pi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name, options) { commands.set(name, options); },
    appendEntry() {},
    sendUserMessage() {},
    events: { emit() {} },
  };
  const compose = async () => {
    let systemPrompt = "BASE";
    for (const handler of handlers.get("before_agent_start") ?? []) {
      const result = await handler({ systemPrompt }, context);
      if (result?.systemPrompt) systemPrompt = result.systemPrompt;
    }
    return systemPrompt;
  };
  const context = {
    ui: {
      notify() {},
      setStatus() {},
      theme: { fg: (_color, value) => value },
    },
  };

  const previousDefault = process.env.PONYTAIL_DEFAULT_MODE;
  process.env.PONYTAIL_DEFAULT_MODE = "full";
  try {
    conciseExtension(pi);
    ponytailExtension(pi);

    const active = await compose();
    assert.ok(active.indexOf(CONCISE_RESPONSE_POLICY) > active.indexOf("BASE"));
    assert.ok(active.indexOf("PONYTAIL MODE ACTIVE") > active.indexOf(CONCISE_RESPONSE_POLICY));

    await commands.get("ponytail").handler("off", context);
    const disabled = await compose();
    assert.ok(disabled.includes(CONCISE_RESPONSE_POLICY));
    assert.doesNotMatch(disabled, /PONYTAIL MODE ACTIVE/);
  } finally {
    if (previousDefault === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
    else process.env.PONYTAIL_DEFAULT_MODE = previousDefault;
  }
});
