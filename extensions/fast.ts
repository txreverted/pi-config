import type {
  Context,
  Model,
  Provider,
  ProviderStreamOptions,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  FooterComponent,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  PROVIDER_FAST_STATE,
  PROVIDER_FAST_TIER,
  isProviderFastEnabled,
  providerFastFooterLabel,
  registerProviderFastHook,
  supportsProviderFastMode,
} from "./fast-core.ts";

function renderFastFooterLine(
  line: string,
  label: string,
  width: number,
  dim: (text: string) => string,
): string {
  if (width <= 0) return "";
  const suffix = " fast";
  const fittedLabel = visibleWidth(label) <= width
    ? label
    : width <= visibleWidth(suffix.trimStart())
      ? truncateToWidth(suffix.trimStart(), width, "")
      : truncateToWidth(label.slice(0, -suffix.length), width - visibleWidth(suffix), "") + suffix;
  const labelWidth = visibleWidth(fittedLabel);
  const gap = / {2,}/.exec(stripTerminalSequences(line));
  const availableStats = Math.max(0, width - labelWidth - (labelWidth < width ? 2 : 0));
  const stats = gap ? truncateToWidth(line, Math.min(gap.index, availableStats), "") : "";
  const padding = " ".repeat(Math.max(0, width - visibleWidth(stats) - labelWidth));
  return stats + padding + dim(fittedLabel);
}

/** Keep the Pi footer's internal AgentSession dependency behind one compatibility boundary. */
function createFastFooterAdapter(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  dim: (text: string) => string,
) {
  const footer = new FooterComponent({
    get state() {
      return { model: ctx.model, thinkingLevel: ctx.thinkingLevel };
    },
    sessionManager: ctx.sessionManager,
    getContextUsage: () => ctx.getContextUsage(),
    modelRuntime: {
      isUsingSubscription(providerId: string) {
        const model = ctx.model;
        return Boolean(
          model
          && model.provider === providerId
          && ctx.modelRegistry.isUsingOAuth(model)
          && ctx.modelRegistry.getProvider(providerId)?.auth.oauth?.isSubscription === true,
        );
      },
    },
  } as unknown as AgentSession, footerData);

  return {
    dispose: () => footer.dispose(),
    invalidate: () => footer.invalidate(),
    render(width: number) {
      const lines = footer.render(width);
      const label = providerFastFooterLabel(ctx.model, ctx.thinkingLevel);
      if (label && lines[1]) {
        lines[1] = renderFastFooterLine(lines[1], label, width, dim);
      }
      return lines;
    },
  };
}

const FAST_PROVIDER_ORIGINAL = Symbol.for("pi-config.fast-provider-original");

type FastWrappedProvider = Provider & { [FAST_PROVIDER_ORIGINAL]?: Provider };

/** Set Pi's request option as well as the payload so returned usage receives priority-tier pricing. */
export function wrapProviderFastTier(provider: Provider, enabled: () => boolean): Provider {
  const original = (provider as FastWrappedProvider)[FAST_PROVIDER_ORIGINAL] ?? provider;
  const requestOptions = <T extends ProviderStreamOptions | SimpleStreamOptions | undefined>(
    model: Model<any>,
    options: T,
  ): T => enabled() && supportsProviderFastMode(model)
    ? { ...(options ?? {}), serviceTier: PROVIDER_FAST_TIER } as unknown as T
    : options;
  const stream = ((model: Model<any>, context: Context, options?: ProviderStreamOptions) =>
    original.stream(model, context, requestOptions(model, options) as never)) as Provider["stream"];
  const streamSimple = ((model: Model<any>, context: Context, options?: SimpleStreamOptions) =>
    original.streamSimple(model, context, requestOptions(model, options))) as Provider["streamSimple"];
  const wrapped: FastWrappedProvider = {
    ...original,
    getModels: () => original.getModels(),
    stream,
    streamSimple,
  };
  Object.defineProperty(wrapped, FAST_PROVIDER_ORIGINAL, { value: original });
  return wrapped;
}

export function registerFastExtension(pi: ExtensionAPI): void {
  let providerFast = false;
  const originalProviders = new Map<string, Provider>();
  const wrappedProviders = new Map<string, Provider>();

  const restoreProviders = (ctx: ExtensionContext) => {
    for (const provider of originalProviders.values()) ctx.modelRegistry.registerProvider(provider);
    originalProviders.clear();
    wrappedProviders.clear();
  };

  const ensureProvider = (ctx: ExtensionContext) => {
    const model = ctx.model;
    if (!model || !providerFast || !supportsProviderFastMode(model)) return;
    const current = ctx.modelRegistry.getProvider(model.provider);
    if (!current || wrappedProviders.get(model.provider) === current) return;
    const original = (current as FastWrappedProvider)[FAST_PROVIDER_ORIGINAL] ?? current;
    const wrapped = wrapProviderFastTier(original, () => providerFast);
    originalProviders.set(model.provider, original);
    wrappedProviders.set(model.provider, wrapped);
    ctx.modelRegistry.registerProvider(wrapped);
  };

  const updateFooter = (ctx: ExtensionContext) => {
    if (!providerFast || !supportsProviderFastMode(ctx.model)) {
      ctx.ui.setFooter(undefined);
      return;
    }
    ctx.ui.setFooter((_tui, theme, footerData) =>
      createFastFooterAdapter(ctx, footerData, (text) => theme.fg("dim", text)));
  };

  const restore = (ctx: ExtensionContext) => {
    providerFast = isProviderFastEnabled(ctx.sessionManager.getBranch());
    if (providerFast) ensureProvider(ctx);
    else restoreProviders(ctx);
    updateFooter(ctx);
  };

  pi.registerCommand("fast", {
    description: "Toggle OpenAI priority service tier for the selected model",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /fast", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current task to finish before changing provider fast mode.", "warning");
        return;
      }

      const enabled = !providerFast;
      if (enabled && !supportsProviderFastMode(ctx.model)) {
        ctx.ui.notify("Provider fast mode requires an OpenAI Responses or OpenAI Codex Responses model.", "warning");
        return;
      }
      providerFast = enabled;
      if (enabled) ensureProvider(ctx);
      else restoreProviders(ctx);
      pi.appendEntry(PROVIDER_FAST_STATE, { enabled });
      updateFooter(ctx);
      ctx.ui.notify(
        enabled
          ? "Provider fast mode enabled for the selected model; pricing is higher."
          : "Provider fast mode disabled.",
        "info",
      );
    },
  });

  registerProviderFastHook(pi, () => providerFast);
  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("model_select", (_event, ctx) => {
    ensureProvider(ctx);
    updateFooter(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    restoreProviders(ctx);
    ctx.ui.setFooter(undefined);
  });
}

export default function fastExtension(pi: ExtensionAPI): void {
  registerFastExtension(pi);
}
