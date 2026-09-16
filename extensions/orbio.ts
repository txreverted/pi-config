import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { ORBIO_MODELS } from "./orbio-models.ts";
import { parseOpenRouterCatalog } from "./openrouter-catalog.ts";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
// Startup must not hang on an unreachable network; the bundled catalog is the fallback.
const CATALOG_TIMEOUT_MS = 4_000;

async function fetchCatalog(signal: AbortSignal): Promise<ProviderModelConfig[]> {
  const response = await fetch(CATALOG_URL, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)]),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OpenRouter returned status ${response.status}`);
  return parseOpenRouterCatalog(await response.json());
}

function withTransportCompat(models: readonly ProviderModelConfig[]): ProviderModelConfig[] {
  return models.map((model) => ({
    ...model,
    compat: {
      thinkingFormat: "openrouter",
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      sessionAffinityFormat: "openrouter",
      ...model.compat,
    },
  }));
}

export default async function orbioExtension(pi: ExtensionAPI) {
  let models: readonly ProviderModelConfig[] = ORBIO_MODELS;
  let startupFailure: string | undefined;
  if (process.env.PI_OFFLINE === undefined) {
    try {
      models = await fetchCatalog(new AbortController().signal);
    } catch (error) {
      startupFailure = error instanceof Error ? error.message : String(error);
    }
  }

  pi.registerProvider("orbio", {
    name: "Orbio",
    baseUrl: "https://api.orbio.so/api/v1",
    apiKey: "$ORBIO_API_KEY",
    api: "openai-completions",
    models: withTransportCompat(models),
    // Pi's own network refresh path, for example `pi update --models`.
    async refreshModels({ signal, allowNetwork }) {
      if (allowNetwork) models = await fetchCatalog(signal);
      return withTransportCompat(models);
    },
  });

  pi.on("session_start", (event, ctx) => {
    if (!startupFailure || event.reason !== "startup" || !ctx.hasUI) return;
    ctx.ui.notify(
      `Orbio: could not refresh OpenRouter's catalog (${startupFailure}); using the bundled list.`,
      "warning",
    );
  });
}
