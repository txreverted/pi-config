import { relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { Model } from "@earendil-works/pi-ai";
import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

function formatCwd(cwd: string): string {
  const home = resolve(homedir());
  const absoluteCwd = resolve(cwd);
  const fromHome = relative(home, absoluteCwd);
  const insideHome =
    fromHome === "" ||
    (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !fromHome.startsWith(sep));

  if (!insideHome) return cwd;
  return fromHome === "" ? "~" : `~${sep}${fromHome}`;
}

function formatTokens(count: number): string {
  if (count < 1_000) return `${count}`;
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

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
  let requestStatusRender: (() => void) | undefined;

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
            requestStatusRender = undefined;
          },
          invalidate() {},
          render(width: number): string[] {
            const branch = getGitBranch();
            const location = `${formatCwd(ctx.cwd)}${branch ? `(${branch})` : ""}`;
            const cost = ctx.sessionManager.getEntries().reduce((total, entry) => total + usageCost(entry), 0);
            const usage = ctx.getContextUsage();
            const contextWindow = usage?.contextWindow ?? currentModel?.contextWindow ?? 0;
            const contextPercent = usage?.percent === null ? "?" : (usage?.percent ?? 0).toFixed(1);
            const subscription = isSubscription(ctx, currentModel) ? " (sub)" : "";
            const details = [
              `v${VERSION}`,
              location,
              `${currentModel?.id ?? "no-model"} (${currentThinking})`,
              `${contextPercent}%/${formatTokens(contextWindow)} (auto)`,
              `$${cost.toFixed(3)}${subscription}`,
            ].join(" > ");
            const line = `${theme.bold(theme.fg("accent", "π"))}${theme.fg("dim", ` ${details}`)}`;

            return [truncateToWidth(line, width, "…")];
          },
        };
      },
      { placement: "aboveEditor" },
    );
  });

  pi.on("model_select", (event) => {
    currentModel = event.model;
    requestStatusRender?.();
  });

  pi.on("thinking_level_select", (event) => {
    currentThinking = event.level;
    requestStatusRender?.();
  });

  pi.on("session_shutdown", () => {
    requestStatusRender = undefined;
  });
}
