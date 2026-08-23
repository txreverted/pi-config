import test from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  PROVIDER_FAST_STATE,
  PROVIDER_FAST_TIER,
  applyProviderFastTier,
  isProviderFastEnabled,
  supportsProviderFastMode,
} from "../extensions/fast-core.ts";
import { registerFastExtension, wrapProviderFastTier } from "../extensions/fast.ts";

initTheme("dark");

function createFooter(factory, footerData = {}) {
  assert.equal(typeof factory, "function");
  return factory(
    { requestRender() {} },
    { fg: (_color, text) => text },
    {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map(),
      getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
      ...footerData,
    },
  );
}

function renderFooterComponent(component, width) {
  const lines = component.render(width);
  for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${line}`);
  return lines.map(stripTerminalSequences);
}

function renderFooter(factory, width, footerData) {
  const component = createFooter(factory, footerData);
  try {
    return renderFooterComponent(component, width);
  } finally {
    component.dispose?.();
  }
}

function setup() {
  const commands = new Map();
  const events = new Map();
  const notices = [];
  const entries = [];
  const footers = [];
  const baseProvider = {
    id: "openai-codex",
    name: "Codex",
    auth: { apiKey: {} },
    getModels: () => [],
    stream: () => "stream",
    streamSimple: () => "simple",
  };
  let currentProvider = baseProvider;
  const pi = {
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  };
  registerFastExtension(pi);
  const ui = {
    notify(message, level) { notices.push({ message, level }); },
    setFooter(factory) { footers.push(factory); },
  };
  const model = {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    api: "openai-codex-responses",
    reasoning: true,
  };
  const sessionManager = {
    getBranch: () => [...entries],
    getEntries: () => [...entries],
    getCwd: () => "/tmp/project",
    getSessionName: () => undefined,
  };
  const context = {
    isIdle: () => true,
    cwd: "/tmp/project",
    model,
    modelRegistry: {
      isUsingOAuth: () => false,
      getProvider: (providerId) => providerId === currentProvider.id ? currentProvider : undefined,
      registerProvider(provider) { currentProvider = provider; },
    },
    sessionManager,
    thinkingLevel: "low",
    getContextUsage: () => ({ tokens: 0, contextWindow: 200_000, percent: 0 }),
    ui,
  };
  return {
    command: commands.get("fast"),
    commandNames: [...commands.keys()],
    events,
    notices,
    entries,
    footers,
    footer: () => footers.at(-1),
    provider: () => currentProvider,
    baseProvider,
    context,
    start() {
      events.get("session_start")(
        { type: "session_start", reason: "startup" },
        context,
      );
    },
  };
}

test("fast extension owns only the provider selector command", () => {
  const state = setup();
  assert.deepEqual(state.commandNames, ["fast"]);
  assert.equal(typeof state.command.handler, "function");
});

test("provider fast mode supports only OpenAI response providers and safely rewrites object payloads", () => {
  assert.equal(supportsProviderFastMode({ provider: "openai", api: "openai-responses" }), true);
  assert.equal(supportsProviderFastMode({ provider: "openai-codex", api: "openai-codex-responses" }), true);
  assert.equal(supportsProviderFastMode({ provider: "openai", api: "openai-completions" }), false);
  assert.equal(supportsProviderFastMode({ provider: "anthropic", api: "anthropic-messages" }), false);
  assert.equal(supportsProviderFastMode(undefined), false);

  const payload = { model: "gpt-test", service_tier: "default" };
  assert.deepEqual(applyProviderFastTier(payload), { model: "gpt-test", service_tier: PROVIDER_FAST_TIER });
  assert.deepEqual(payload, { model: "gpt-test", service_tier: "default" });
  assert.equal(applyProviderFastTier("payload"), "payload");
  assert.equal(applyProviderFastTier(null), null);
});

test("the latest branch entry is the provider fast source of truth", () => {
  assert.equal(isProviderFastEnabled([]), false);
  assert.equal(isProviderFastEnabled([
    { type: "custom", customType: PROVIDER_FAST_STATE, data: { enabled: true } },
    { type: "custom", customType: "unrelated", data: { enabled: false } },
  ]), true);
  assert.equal(isProviderFastEnabled([
    { type: "custom", customType: PROVIDER_FAST_STATE, data: { enabled: true } },
    { type: "custom", customType: PROVIDER_FAST_STATE, data: { enabled: false } },
  ]), false);
});

test("provider fast wrapping sets the request option used for tier-aware usage pricing", () => {
  let enabled = true;
  const calls = [];
  const provider = {
    id: "openai-codex",
    name: "Codex",
    auth: { apiKey: {} },
    getModels: () => [],
    stream(_model, _context, options) {
      calls.push(options);
      return "stream";
    },
    streamSimple(_model, _context, options) {
      calls.push(options);
      return "simple";
    },
  };
  const wrapped = wrapProviderFastTier(provider, () => enabled);
  const supported = { provider: "openai-codex", api: "openai-codex-responses" };
  const unsupported = { provider: "openai-codex", api: "openai-completions" };
  assert.equal(wrapped.streamSimple(supported, {}, { timeoutMs: 10 }), "simple");
  assert.equal(wrapped.stream(supported, {}, { maxTokens: 20 }), "stream");
  assert.equal(calls[0].serviceTier, PROVIDER_FAST_TIER);
  assert.equal(calls[1].serviceTier, PROVIDER_FAST_TIER);
  wrapped.streamSimple(unsupported, {}, { timeoutMs: 30 });
  assert.equal(calls[2].serviceTier, undefined);
  enabled = false;
  wrapped.streamSimple(supported, {}, { timeoutMs: 40 });
  assert.equal(calls[3].serviceTier, undefined);
});

test("the provider command persists per-branch state and rewrites only supported main requests", async () => {
  const state = setup();
  state.start();
  const request = state.events.get("before_provider_request");
  const event = { type: "before_provider_request", payload: { model: "gpt-test", service_tier: "default" } };

  assert.equal(await request(event, state.context), undefined);
  assert.equal(state.footer(), undefined);

  await state.command.handler("", state.context);
  assert.deepEqual(state.entries.at(-1), {
    type: "custom",
    customType: PROVIDER_FAST_STATE,
    data: { enabled: true },
  });
  assert.notEqual(state.provider(), state.baseProvider);
  assert.match(state.notices.at(-1).message, /main agent and \/r-fast scouts; pricing is higher/);
  for (const width of [120, 40]) {
    const lines = renderFooter(state.footer(), width);
    assert.equal(lines.some((line) => line.endsWith("gpt-5.6-sol (low) fast")), true);
    assert.equal(lines.some((line) => line.trim() === "fast"), false);
  }
  assert.deepEqual(await request(event, state.context), {
    model: "gpt-test",
    service_tier: PROVIDER_FAST_TIER,
  });
  assert.deepEqual(event.payload, { model: "gpt-test", service_tier: "default" });

  const unsupported = {
    ...state.context,
    model: { provider: "anthropic", id: "claude-test", api: "anthropic-messages" },
  };
  assert.equal(await request(event, unsupported), undefined);
  state.events.get("model_select")({ type: "model_select", model: unsupported.model }, unsupported);
  assert.equal(state.footer(), undefined);

  state.events.get("model_select")({ type: "model_select", model: state.context.model }, state.context);
  assert.equal(renderFooter(state.footer(), 120).some((line) => line.endsWith("gpt-5.6-sol (low) fast")), true);

  await state.command.handler("", state.context);
  assert.deepEqual(state.entries.at(-1).data, { enabled: false });
  assert.equal(state.provider(), state.baseProvider);
  assert.equal(state.footer(), undefined);
  assert.equal(await request(event, state.context), undefined);
});

test("the fast footer adapter preserves Pi footer data and reads live session state", async () => {
  const state = setup();
  state.entries.push({
    type: "message",
    message: {
      role: "assistant",
      content: [],
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 1_200,
        output: 80,
        cacheRead: 200,
        cacheWrite: 0,
        totalTokens: 1_480,
        cost: {
          input: 0.8,
          output: 0.234,
          cacheRead: 0.2,
          cacheWrite: 0,
          total: 1.234,
        },
      },
    },
  });
  state.start();
  await state.command.handler("", state.context);

  const component = createFooter(state.footer(), {
    getGitBranch: () => "feature/footer",
    getExtensionStatuses: () => new Map([["health", "ready"]]),
  });
  try {
    const initial = renderFooterComponent(component, 120);
    assert.match(initial[0], /project \(feature\/footer\)$/);
    assert.match(initial[1], /↑1\.2k/);
    assert.match(initial[1], /\$1\.234/);
    assert.equal(initial[1].endsWith("gpt-5.6-sol (low) fast"), true);
    assert.equal(initial[2], "ready");

    state.context.thinkingLevel = "high";
    state.context.model = { ...state.context.model, id: "gpt-5.6-terra" };
    const updated = renderFooterComponent(component, 120);
    assert.equal(updated[1].endsWith("gpt-5.6-terra (high) fast"), true);

    component.invalidate?.();
    for (const width of [80, 48, 32, 16, 4]) {
      const lines = renderFooterComponent(component, width);
      if (width >= 4) assert.equal(lines[1].endsWith("fast"), true);
    }
  } finally {
    component.dispose?.();
  }
});

test("provider fast mode restores from the branch and rejects unsupported activation", async () => {
  const state = setup();
  state.entries.push({
    type: "custom",
    customType: PROVIDER_FAST_STATE,
    data: { enabled: true },
  });
  state.start();
  assert.notEqual(state.provider(), state.baseProvider);
  assert.equal(renderFooter(state.footer(), 120).some((line) => line.endsWith("gpt-5.6-sol (low) fast")), true);

  state.entries.push({
    type: "custom",
    customType: PROVIDER_FAST_STATE,
    data: { enabled: false },
  });
  state.events.get("session_tree")({ type: "session_tree" }, state.context);
  assert.equal(state.provider(), state.baseProvider);
  assert.equal(state.footer(), undefined);

  const before = state.entries.length;
  const footersBefore = state.footers.length;
  await state.command.handler("", {
    ...state.context,
    model: { provider: "anthropic", id: "claude-test", api: "anthropic-messages" },
  });
  assert.equal(state.entries.length, before);
  assert.equal(state.footers.length, footersBefore);
  assert.deepEqual(state.notices.at(-1), {
    message: "Provider fast mode requires an OpenAI Responses or OpenAI Codex Responses model.",
    level: "warning",
  });

  const noticesBefore = state.notices.length;
  for (const args of ["on", "off", "status", "invalid"]) {
    await state.command.handler(args, state.context);
  }
  assert.deepEqual(
    state.notices.slice(noticesBefore),
    Array.from({ length: 4 }, () => ({ message: "Usage: /fast", level: "warning" })),
  );
  assert.equal(state.entries.length, before);
  assert.equal(state.footers.length, footersBefore);

  state.context.isIdle = () => false;
  await state.command.handler("", state.context);
  assert.deepEqual(state.notices.at(-1), {
    message: "Wait for the current task to finish before changing provider fast mode.",
    level: "warning",
  });
});
