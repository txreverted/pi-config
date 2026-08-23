import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PROVIDER_FAST_STATE = "pi-config-provider-fast";
export const PROVIDER_FAST_TIER = "priority";

export interface ProviderModelRef {
  api: string;
  provider: string;
}

export interface FooterModelRef {
  id: string;
  reasoning?: boolean;
}

export function supportsProviderFastMode(model: ProviderModelRef | undefined): boolean {
  return (model?.provider === "openai-codex" && model.api === "openai-codex-responses")
    || (model?.provider === "openai" && model.api === "openai-responses");
}

export function applyProviderFastTier(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...payload, service_tier: PROVIDER_FAST_TIER };
}

export function registerProviderFastHook(pi: ExtensionAPI, enabled: () => boolean): void {
  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled() || !supportsProviderFastMode(ctx.model)) return;
    return applyProviderFastTier(event.payload);
  });
}

export function providerFastFooterLabel(
  model: FooterModelRef | undefined,
  thinking: ModelThinkingLevel = "off",
): string | undefined {
  if (!model) return undefined;
  return model.reasoning ? `${model.id} (${thinking}) fast` : `${model.id} fast`;
}

export function isProviderFastEnabled(entries: readonly unknown[]): boolean {
  const saved = [...entries].reverse().find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as { type?: unknown; customType?: unknown };
    return candidate.type === "custom" && candidate.customType === PROVIDER_FAST_STATE;
  }) as { data?: { enabled?: unknown } } | undefined;
  return saved?.data?.enabled === true;
}
