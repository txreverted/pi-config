import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import orbioExtension from "../extensions/orbio.ts";
import { ORBIO_MODELS } from "../extensions/orbio-models.ts";
import { parseOpenRouterCatalog } from "../extensions/openrouter-catalog.ts";

function catalogPayload() {
  return { data: [
    {
      id: "openai/gpt-test",
      name: "OpenAI: GPT Test",
      context_length: 200000,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      top_provider: { max_completion_tokens: 100000 },
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        input_cache_read: "0.0000001",
        input_cache_write: "0.0000002",
        overrides: [{ min_prompt_tokens: 100000, prompt: "0.000002", completion: "0.000004" }],
      },
      supported_parameters: ["tools", "reasoning", "reasoning_effort"],
      reasoning: { mandatory: false, supported_efforts: ["low", "medium", "high", "max"] },
    },
    {
      id: "openrouter/auto",
      name: "Auto Router",
      context_length: 1000,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      top_provider: {},
      pricing: { prompt: "-1", completion: "-1" },
      supported_parameters: [],
    },
    {
      id: "image-only",
      name: "Image Only",
      context_length: 100,
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      top_provider: {},
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: [],
    },
  ] };
}

async function loadExtension({ fetchImpl, offline = false, keepFetch = false } = {}) {
  const providers = [];
  const handlers = new Map();
  const previousFetch = globalThis.fetch;
  const originalOffline = process.env.PI_OFFLINE;
  if (!keepFetch) {
    if (fetchImpl) globalThis.fetch = fetchImpl;
    else delete globalThis.fetch;
  }
  if (offline) process.env.PI_OFFLINE = "1";
  else delete process.env.PI_OFFLINE;
  try {
    await orbioExtension({
      registerProvider: (id, config) => providers.push({ id, config }),
      on: (event, handler) => handlers.set(event, handler),
    });
  } finally {
    if (!keepFetch) globalThis.fetch = previousFetch;
    if (originalOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = originalOffline;
  }
  return { providers, handlers, previousFetch };
}

function jsonFetch(payload, counter = { calls: 0 }) {
  const impl = async () => {
    counter.calls += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  impl.counter = counter;
  return impl;
}

test("OpenRouter catalog conversion keeps supported models and skips non-text ones", () => {
  const models = parseOpenRouterCatalog(catalogPayload());
  assert.deepEqual(models.map((model) => model.id), ["openai/gpt-test", "openrouter/auto"]);

  const gpt = models[0];
  assert.equal(gpt.name, "OpenAI: GPT Test");
  assert.equal(gpt.reasoning, true);
  assert.deepEqual(gpt.thinkingLevelMap, {
    off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: "max",
  });
  assert.deepEqual(gpt.input, ["text", "image"]);
  assert.equal(gpt.contextWindow, 200000);
  assert.equal(gpt.maxTokens, 100000);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  close(gpt.cost.input, 1);
  close(gpt.cost.output, 2);
  close(gpt.cost.cacheRead, 0.1);
  close(gpt.cost.cacheWrite, 0.2);
  assert.equal(gpt.cost.tiers.length, 1);
  assert.equal(gpt.cost.tiers[0].inputTokensAbove, 100000);
  close(gpt.cost.tiers[0].input, 2);
  close(gpt.cost.tiers[0].output, 4);
  close(gpt.cost.tiers[0].cacheRead, 0.1);
  close(gpt.cost.tiers[0].cacheWrite, 0.2);

  const router = models[1];
  assert.equal(router.reasoning, false);
  assert.equal(router.thinkingLevelMap, undefined);
  assert.deepEqual(router.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(router.maxTokens, 1000);
});

test("OpenRouter catalog conversion rejects unusable payloads", () => {
  for (const payload of [null, {}, { data: [] }, { data: [{ id: "x" }] }]) {
    assert.throws(() => parseOpenRouterCatalog(payload), /Invalid OpenRouter catalog/);
  }
  const duplicated = catalogPayload();
  duplicated.data[1].id = "openai/gpt-test";
  assert.throws(() => parseOpenRouterCatalog(duplicated), /Duplicate OpenRouter model ID/);
  const missingName = catalogPayload();
  missingName.data[0].name = 42;
  assert.throws(() => parseOpenRouterCatalog(missingName), /Invalid OpenRouter catalog/);
});

test("startup registers the freshly fetched catalog and keeps transport settings", async (t) => {
  const fetchImpl = jsonFetch(catalogPayload());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.fetch = previousFetch; });
  const { providers } = await loadExtension({ keepFetch: true });
  const { id, config } = providers[0];
  assert.equal(id, "orbio");
  assert.equal(config.name, "Orbio");
  assert.equal(config.baseUrl, "https://api.orbio.so/api/v1");
  assert.equal(config.apiKey, "$ORBIO_API_KEY");
  assert.equal(config.api, "openai-completions");
  assert.deepEqual(config.models.map((model) => model.id), ["openai/gpt-test", "openrouter/auto"]);
  for (const model of config.models) {
    assert.equal(model.compat.thinkingFormat, "openrouter");
    assert.equal(model.compat.maxTokensField, "max_tokens");
    assert.equal(model.compat.supportsStore, false);
    assert.equal(model.compat.sessionAffinityFormat, "openrouter");
  }
  // OpenAI-routed models override the provider default; others keep it.
  assert.equal(config.models[0].compat.supportsDeveloperRole, true);
  assert.equal(config.models[1].compat.supportsDeveloperRole, false);

  // Pi's offline startup pass must not refetch and must return the current list.
  const offlineModels = await config.refreshModels({ signal: new AbortController().signal, allowNetwork: false });
  assert.equal(fetchImpl.counter.calls, 1);
  assert.deepEqual(offlineModels.map((model) => model.id), config.models.map((model) => model.id));

  // Pi's network refresh path (for example `pi update --models`) refetches.
  const refreshed = await config.refreshModels({ signal: new AbortController().signal, allowNetwork: true });
  assert.equal(fetchImpl.counter.calls, 2);
  assert.deepEqual(refreshed.map((model) => model.id), ["openai/gpt-test", "openrouter/auto"]);
});

test("startup falls back to the bundled catalog and warns once", async () => {
  const { providers, handlers } = await loadExtension({
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(providers[0].config.models.length, ORBIO_MODELS.length);
  const notifications = [];
  handlers.get("session_start")({ reason: "startup" }, {
    hasUI: true,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "warning");
  assert.match(notifications[0].message, /network down/);

  // A non-startup session and a UI-less mode stay quiet.
  handlers.get("session_start")({ reason: "new" }, { hasUI: true, ui: { notify: () => { throw new Error("unexpected"); } } });
  handlers.get("session_start")({ reason: "startup" }, { hasUI: false, ui: { notify: () => { throw new Error("unexpected"); } } });
});

test("PI_OFFLINE skips the startup request", async () => {
  const { providers } = await loadExtension({
    offline: true,
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  assert.equal(providers[0].config.models.length, ORBIO_MODELS.length);
});

test("Orbio supports private login, environment auth, logout, and local model overrides", async () => {
  const originalKey = process.env.ORBIO_API_KEY;
  delete process.env.ORBIO_API_KEY;
  const { providers } = await loadExtension({ offline: true });
  const directory = await mkdtemp(join(tmpdir(), "pi-config-orbio-"));
  try {
    const modelsPath = join(directory, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers: {
      orbio: { modelOverrides: { "stealth/union-alpha": { maxTokens: 2048 } } },
    } }));
    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath,
      modelsStorePath: join(directory, "models-store.json"),
      allowModelNetwork: false,
    });
    const otherModels = runtime.getModels("openai");
    for (const { id, config } of providers) runtime.registerProvider(id, config);
    assert.equal(runtime.getProvider("orbio").name, "Orbio");
    assert.deepEqual(await runtime.getAvailable("orbio"), []);
    assert.equal(runtime.getModel("orbio", "stealth/union-alpha").maxTokens, 2048);
    assert.deepEqual(runtime.getModels("openai"), otherModels);

    process.env.ORBIO_API_KEY = "environment-test-key";
    assert.equal((await runtime.getAvailable("orbio")).length, ORBIO_MODELS.length);
    assert.equal((await runtime.getAuth("orbio")).auth.apiKey, "environment-test-key");

    await runtime.login("orbio", "api_key", {
      async prompt(request) {
        assert.equal(request.type, "secret");
        return "stored-test-key";
      },
    });
    assert.equal((await runtime.getAuth("orbio")).auth.apiKey, "stored-test-key");
    delete process.env.ORBIO_API_KEY;
    assert.equal((await runtime.getAvailable("orbio")).length, ORBIO_MODELS.length);
    await runtime.logout("orbio");
    assert.deepEqual(await runtime.getAvailable("orbio"), []);
  } finally {
    if (originalKey === undefined) delete process.env.ORBIO_API_KEY;
    else process.env.ORBIO_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pi refreshes Orbio's catalog over the network through its own runtime", async () => {
  const originalKey = process.env.ORBIO_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ORBIO_API_KEY = "environment-test-key";
  globalThis.fetch = jsonFetch(catalogPayload());
  const { providers } = await loadExtension({ offline: true });
  const directory = await mkdtemp(join(tmpdir(), "pi-config-orbio-refresh-"));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: join(directory, "models.json"),
      modelsStorePath: join(directory, "models-store.json"),
      allowModelNetwork: false,
    });
    for (const { id, config } of providers) runtime.registerProvider(id, config);
    assert.equal(runtime.getModels("orbio").length, ORBIO_MODELS.length);

    const result = await runtime.refresh({ allowNetwork: true, providers: ["orbio"] });
    assert.deepEqual([...result.errors], []);
    assert.deepEqual(runtime.getModels("orbio").map((model) => model.id), ["openai/gpt-test", "openrouter/auto"]);
    assert.equal((await runtime.getAvailable("orbio")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ORBIO_API_KEY;
    else process.env.ORBIO_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  }
});
