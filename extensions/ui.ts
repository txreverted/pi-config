import type { Model } from "@earendil-works/pi-ai";
import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  formatCwd,
  formatElapsed,
  formatTokens,
  wrapStatusLine,
} from "./ui-core.ts";

function usageCost(entry: SessionEntry): number {
  let usage: unknown;

  if (entry.type === "message") {
    if (entry.message.role === "assistant" || entry.message.role === "toolResult") {
      usage = entry.message.usage;
    }
  } else if (entry.type === "compaction" || entry.type === "branch_summary") {
    usage = entry.usage;
  }

  if (!usage || typeof usage !== "object") return 0;
  const cost = (usage as { cost?: { total?: unknown } }).cost?.total;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

function isSubscription(ctx: ExtensionContext, model: Model<any> | undefined): boolean {
  if (!model) return false;
  if (model.provider === "kimi-coding") return true;

  const provider = ctx.modelRegistry.getProvider(model.provider);
  return ctx.modelRegistry.isUsingOAuth(model) && provider?.auth.oauth?.isSubscription === true;
}

export default function uiExtension(pi: ExtensionAPI) {
  let currentModel: Model<any> | undefined;
  let currentThinking = "off";
  let responseStartedAt: number | undefined;
  let responseTimer: ReturnType<typeof setInterval> | undefined;
  let requestStatusRender: (() => void) | undefined;
  let cachedEntryCount = -1;
  let cachedCost = 0;

  const sessionCost = (ctx: ExtensionContext): number => {
    const entries = ctx.sessionManager.getEntries();
    if (entries.length !== cachedEntryCount) {
      cachedEntryCount = entries.length;
      cachedCost = entries.reduce((total, entry) => total + usageCost(entry), 0);
    }
    return cachedCost;
  };

  const stopResponseTimer = () => {
    if (responseTimer) clearInterval(responseTimer);
    responseTimer = undefined;
    responseStartedAt = undefined;
    requestStatusRender?.();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    currentModel = ctx.model;
    currentThinking = ctx.thinkingLevel ?? "off";

    let getGitBranch = (): string | null => null;
    let onBranchChange = (_callback: () => void): (() => void) => () => {};

    // FooterDataProvider owns Pi's reactive git branch state. Capture its public
    // accessors, then replace the footer with a zero-line component.
    ctx.ui.setFooter((_tui, _theme, footerData) => {
      getGitBranch = () => footerData.getGitBranch();
      onBranchChange = (callback) => footerData.onBranchChange(callback);
      return { invalidate() {}, render: () => [] };
    });

    // Remove the startup header. The status widget is docked directly above the
    // editor, so transcript output, working state, and tool calls stay above it.
    ctx.ui.setHeader(() => ({ invalidate() {}, render: () => [] }));
    ctx.ui.setWidget(
      "minimal-status",
      (tui, theme) => {
        requestStatusRender = () => tui.requestRender();
        const unsubscribeBranch = onBranchChange(requestStatusRender);

        return {
          dispose() {
            unsubscribeBranch();
            if (responseTimer) clearInterval(responseTimer);
            responseTimer = undefined;
            responseStartedAt = undefined;
            requestStatusRender = undefined;
          },
          invalidate() {},
          render(width: number): string[] {
            const branch = getGitBranch();
            const sessionName = ctx.sessionManager.getSessionName();
            const location = [
              `${formatCwd(ctx.cwd)}${branch ? `(${branch})` : ""}`,
              sessionName,
            ].filter(Boolean).join(" · ");
            const cost = sessionCost(ctx);
            const usage = ctx.getContextUsage();
            const contextWindow = usage?.contextWindow ?? currentModel?.contextWindow ?? 0;
            const contextPercentValue = usage?.percent ?? 0;
            const contextPercent = usage?.percent == null ? "?" : contextPercentValue.toFixed(1);
            const subscription = isSubscription(ctx, currentModel) ? " (sub)" : "";
            const elapsed = responseStartedAt === undefined ? undefined : formatElapsed(Date.now() - responseStartedAt);
            const model = currentModel?.id ?? "no-model";

            const dim = (value: string) => theme.fg("dim", value);
            const contextColor = contextPercentValue > 90 ? "error" : contextPercentValue > 70 ? "warning" : "dim";
            const context = theme.fg(contextColor, `${contextPercent}%/${formatTokens(contextWindow)}`);
            const separator = dim(" > ");
            const logo = theme.bold(theme.fg("accent", "π"));
            const renderCandidate = (segments: readonly string[]) =>
              `${logo} ${segments.filter(Boolean).join(separator)}`;
            const version = dim(`v${VERSION}`);
            const fullModel = dim(`${model} (${currentThinking})`);
            const place = dim(location);
            const price = dim(`$${cost.toFixed(3)}${subscription}`);
            const time = elapsed ? theme.fg("muted", elapsed) : undefined;
            const line = renderCandidate([
              version,
              place,
              fullModel,
              context,
              price,
              ...(time ? [time] : []),
            ]);

            return wrapStatusLine(line, width);
          },
        };
      },
      { placement: "aboveEditor" },
    );
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    responseStartedAt = Date.now();
    if (!responseTimer) {
      responseTimer = setInterval(() => requestStatusRender?.(), 1_000);
      responseTimer.unref?.();
    }
    requestStatusRender?.();
  });

  pi.on("agent_settled", () => {
    stopResponseTimer();
  });

  pi.on("model_select", (event) => {
    currentModel = event.model;
    requestStatusRender?.();
  });

  pi.on("thinking_level_select", (event) => {
    currentThinking = event.level;
    requestStatusRender?.();
  });

  pi.on("session_info_changed", () => {
    requestStatusRender?.();
  });

  pi.on("session_shutdown", () => {
    if (responseTimer) clearInterval(responseTimer);
    responseTimer = undefined;
    responseStartedAt = undefined;
    requestStatusRender = undefined;
    cachedEntryCount = -1;
    cachedCost = 0;
  });
}
