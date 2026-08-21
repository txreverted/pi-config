import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FAST_MODE_STATUS_KEY = "openai-fast";

// ponytail: static allowlists prevent new models from using a higher-cost tier by surprise; update when OpenAI changes Fast support.
const OPENAI_API_MODELS = new Set([
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);
const OPENAI_CODEX_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);

export interface FastModelReference {
  provider: string;
  id: string;
}

export function supportsOpenAIFastMode(model: FastModelReference | undefined): boolean {
  if (!model) return false;
  if (model.provider === "openai") return OPENAI_API_MODELS.has(model.id);
  if (model.provider === "openai-codex") return OPENAI_CODEX_MODELS.has(model.id);
  return false;
}

export function withFastServiceTier(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...payload, service_tier: "priority" };
}

export default function fastExtension(pi: ExtensionAPI): void {
  let enabled = false;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(FAST_MODE_STATUS_KEY, enabled && supportsOpenAIFastMode(ctx.model) ? "fast" : undefined);
  };

  pi.registerFlag("fast", {
    description: "Start with OpenAI Fast mode enabled for supported models",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("fast", {
    description: "Toggle OpenAI Fast mode for supported models",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off", "status"].filter((value) => value.startsWith(prefix));
      return values.length ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action !== "" && action !== "on" && action !== "off" && action !== "status") {
        ctx.ui.notify("Usage: /fast [on|off|status]", "error");
        return;
      }

      if (action === "status") {
        const supported = supportsOpenAIFastMode(ctx.model);
        const message = enabled
          ? supported
            ? "Fast mode is on for the current model. Higher API prices or ChatGPT credit use apply."
            : "Fast mode is on, but the current model is unsupported."
          : "Fast mode is off.";
        ctx.ui.notify(message, "info");
        return;
      }

      enabled = action === "on" || (action === "" && !enabled);
      updateStatus(ctx);
      if (!enabled) {
        ctx.ui.notify("Fast mode off.", "info");
      } else if (supportsOpenAIFastMode(ctx.model)) {
        ctx.ui.notify("Fast mode on. Higher API prices or ChatGPT credit use apply.", "warning");
      } else {
        ctx.ui.notify("Fast mode on, but the current model is unsupported.", "warning");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = pi.getFlag("fast") === true;
    updateStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !supportsOpenAIFastMode(ctx.model)) return;
    return withFastServiceTier(event.payload);
  });
}
