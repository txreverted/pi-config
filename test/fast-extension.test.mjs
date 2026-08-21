import test from "node:test";
import assert from "node:assert/strict";
import fastExtension, {
  supportsOpenAIFastMode,
  withFastServiceTier,
} from "../extensions/fast.ts";

const supportedCodexModel = { provider: "openai-codex", id: "gpt-5.6-sol" };

function loadExtension(flag = false) {
  const events = new Map();
  const commands = new Map();
  const flags = new Map();
  fastExtension({
    on(name, handler) { events.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    registerFlag(name, options) { flags.set(name, options); },
    getFlag() { return flag; },
  });
  return { events, commands, flags };
}

function createContext(model = supportedCodexModel) {
  const notifications = [];
  const statuses = [];
  return {
    context: {
      model,
      ui: {
        notify(message, level) { notifications.push({ message, level }); },
        setStatus(key, value) { statuses.push({ key, value }); },
      },
    },
    notifications,
    statuses,
  };
}

test("Fast mode uses provider-specific model allowlists", () => {
  for (const model of [
    { provider: "openai", id: "gpt-5" },
    { provider: "openai", id: "gpt-5.4-mini" },
    { provider: "openai", id: "gpt-5.6-terra" },
    { provider: "openai-codex", id: "gpt-5.4" },
    supportedCodexModel,
  ]) assert.equal(supportsOpenAIFastMode(model), true, `${model.provider}/${model.id}`);

  for (const model of [
    undefined,
    { provider: "anthropic", id: "gpt-5.6-sol" },
    { provider: "openai", id: "gpt-5.5-pro" },
    { provider: "openai-codex", id: "gpt-5.4-mini" },
  ]) assert.equal(supportsOpenAIFastMode(model), false, model && `${model.provider}/${model.id}`);
});

test("Fast mode adds priority without mutating the provider payload", () => {
  const payload = { model: "gpt-5.6-sol", input: [] };
  assert.deepEqual(withFastServiceTier(payload), {
    model: "gpt-5.6-sol",
    input: [],
    service_tier: "priority",
  });
  assert.deepEqual(payload, { model: "gpt-5.6-sol", input: [] });
  assert.equal(withFastServiceTier(null), null);
});

test("/fast toggles an off-by-default priority request and footer status", async () => {
  const { events, commands, flags } = loadExtension();
  const { context, notifications, statuses } = createContext();

  assert.deepEqual(flags.get("fast"), {
    description: "Start with OpenAI Fast mode enabled for supported models",
    type: "boolean",
    default: false,
  });
  events.get("session_start")({}, context);
  assert.deepEqual(statuses.at(-1), { key: "openai-fast", value: undefined });
  assert.equal(events.get("before_provider_request")({ payload: { model: "gpt-5.6-sol" } }, context), undefined);

  await commands.get("fast").handler("on", context);
  assert.deepEqual(statuses.at(-1), { key: "openai-fast", value: "fast" });
  assert.deepEqual(notifications.at(-1), {
    message: "Fast mode on. Higher API prices or ChatGPT credit use apply.",
    level: "warning",
  });
  assert.deepEqual(events.get("before_provider_request")({ payload: { model: "gpt-5.6-sol" } }, context), {
    model: "gpt-5.6-sol",
    service_tier: "priority",
  });

  await commands.get("fast").handler("status", context);
  assert.match(notifications.at(-1).message, /Fast mode is on/);
  await commands.get("fast").handler("off", context);
  assert.deepEqual(statuses.at(-1), { key: "openai-fast", value: undefined });
  assert.equal(events.get("before_provider_request")({ payload: {} }, context), undefined);
});

test("--fast enables requests while unsupported models remain untouched", () => {
  const { events } = loadExtension(true);
  const supported = createContext();
  events.get("session_start")({}, supported.context);
  assert.deepEqual(events.get("before_provider_request")({ payload: {} }, supported.context), {
    service_tier: "priority",
  });

  const unsupported = createContext({ provider: "openai-codex", id: "gpt-5.4-mini" });
  events.get("model_select")({}, unsupported.context);
  assert.deepEqual(unsupported.statuses.at(-1), { key: "openai-fast", value: undefined });
  assert.equal(events.get("before_provider_request")({ payload: {} }, unsupported.context), undefined);
});

test("/fast rejects unknown arguments", async () => {
  const { commands } = loadExtension();
  const { context, notifications } = createContext();
  await commands.get("fast").handler("turbo", context);
  assert.deepEqual(notifications, [{ message: "Usage: /fast [on|off|status]", level: "error" }]);
});
