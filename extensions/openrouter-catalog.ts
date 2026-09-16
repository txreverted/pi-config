import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ORBIO_MODELS } from "./orbio-models.ts";
import { safeDisplayLine } from "./text-safety.ts";

const rate = Type.String({ pattern: "^-?[0-9]+(?:\\.[0-9]+)?$" });
const rates = {
  prompt: Type.Optional(rate),
  completion: Type.Optional(rate),
  input_cache_read: Type.Optional(rate),
  input_cache_write: Type.Optional(rate),
};
const positiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const catalogSchema = Type.Object({
  data: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, pattern: "^[^\\s\\x00-\\x1f\\x7f]+$" }),
    name: Type.Optional(Type.String()),
    context_length: positiveInteger,
    architecture: Type.Object({
      input_modalities: Type.Array(Type.String()),
      output_modalities: Type.Array(Type.String()),
    }),
    top_provider: Type.Object({
      max_completion_tokens: Type.Optional(Type.Union([positiveInteger, Type.Null()])),
    }),
    pricing: Type.Object({
      ...rates,
      overrides: Type.Optional(Type.Array(Type.Object({
        ...rates,
        min_prompt_tokens: Type.Optional(positiveInteger),
      }))),
    }),
    supported_parameters: Type.Array(Type.String()),
    reasoning: Type.Optional(Type.Object({
      mandatory: Type.Optional(Type.Boolean()),
      supported_efforts: Type.Optional(Type.Array(Type.String())),
    })),
  }), { minItems: 1 }),
});

const bundledModels = new Map(ORBIO_MODELS.map((model) => [model.id, model]));

function cost(pricing: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string }) {
  const perMillion = (value = "0") => {
    const converted = Number(value) * 1_000_000;
    if (!Number.isFinite(converted)) throw new Error("Invalid OpenRouter price");
    // Variable-pricing router entries publish -1; Pi cannot express that, so record zero.
    return Math.max(0, converted);
  };
  return {
    input: perMillion(pricing.prompt),
    output: perMillion(pricing.completion),
    cacheRead: perMillion(pricing.input_cache_read),
    cacheWrite: perMillion(pricing.input_cache_write),
  };
}

export function parseOpenRouterCatalog(payload: unknown): ProviderModelConfig[] {
  if (!Value.Check(catalogSchema, payload)) throw new Error("Invalid OpenRouter catalog");
  const ids = new Set<string>();
  const models: ProviderModelConfig[] = [];
  for (const entry of payload.data) {
    if (ids.has(entry.id)) throw new Error("Duplicate OpenRouter model ID");
    ids.add(entry.id);
    if (!entry.architecture.input_modalities.includes("text") ||
        !entry.architecture.output_modalities.includes("text")) continue;
    const bundled = bundledModels.get(entry.id);
    const reasoning = entry.supported_parameters.includes("reasoning") ||
      entry.supported_parameters.includes("reasoning_effort");
    const thinkingLevelMap: ProviderModelConfig["thinkingLevelMap"] = {};
    if (reasoning) {
      thinkingLevelMap.off = entry.reasoning?.mandatory ? null : "none";
      if (entry.reasoning?.supported_efforts) {
        for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
          thinkingLevelMap[level] = entry.reasoning.supported_efforts.includes(level) ? level : null;
        }
      }
    }
    const tiers = entry.pricing.overrides
      ?.filter((override) => override.min_prompt_tokens !== undefined)
      .map((override) => ({
        inputTokensAbove: override.min_prompt_tokens!,
        ...cost({ ...entry.pricing, ...override }),
      }));
    models.push({
      id: entry.id,
      name: safeDisplayLine(entry.name || entry.id),
      reasoning,
      ...(reasoning ? { thinkingLevelMap } : {}),
      input: entry.architecture.input_modalities.includes("image") ? ["text", "image"] : ["text"],
      contextWindow: entry.context_length,
      maxTokens: entry.top_provider.max_completion_tokens ?? Math.min(entry.context_length, bundled?.maxTokens ?? 16384),
      // Time-based and non-token charges are not represented by Pi's cost model.
      cost: { ...cost(entry.pricing), ...(tiers?.length ? { tiers } : {}) },
      compat: {
        ...bundled?.compat,
        ...(entry.id.replace(/^~/, "").startsWith("anthropic/")
          ? { supportsDeveloperRole: true, cacheControlFormat: "anthropic" as const }
          : entry.id.replace(/^~/, "").startsWith("openai/") ? { supportsDeveloperRole: true } : {}),
      },
    });
  }
  if (!models.length) throw new Error("OpenRouter returned no text models");
  return models;
}
