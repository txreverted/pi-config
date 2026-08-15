import { basename, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { Model } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  loadProjectContextFiles,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const EXTENSION_LABELS = ["tools.ts"];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function contextLabels(cwd: string): string[] {
  return unique(
    loadProjectContextFiles({ cwd, agentDir: getAgentDir() }).map(({ path }) => basename(path)),
  );
}

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

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes === 0) return `${seconds}s`;
  if (totalMinutes < 60) return `${totalMinutes}m${seconds.toString().padStart(2, "0")}`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, "0")}`;
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

function fitFooter(left: string, right: string, width: number): string {
  const rightWidth = visibleWidth(right);
  const maxLeftWidth = width - rightWidth - 1;

  if (maxLeftWidth <= 0) return truncateToWidth(right, width, "");

  const fittedLeft = truncateToWidth(left, maxLeftWidth, "…");
  const padding = " ".repeat(Math.max(1, width - visibleWidth(fittedLeft) - rightWidth));
  return truncateToWidth(`${fittedLeft}${padding}${right}`, width, "");
}

export default function toolsExtension(pi: ExtensionAPI) {
  const startedAt = Date.now();
  let currentModel: Model<any> | undefined;
  let currentThinking = "off";
  let footerTimer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    currentModel = ctx.model;
    currentThinking = ctx.thinkingLevel ?? "off";
    const contexts = contextLabels(ctx.cwd);

    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const lines = [
          `${theme.bold(theme.fg("accent", "π"))}${theme.fg("dim", ` v${VERSION}`)}`,
          "",
          theme.fg("mdHeading", "[Extensions]"),
          ...EXTENSION_LABELS.map((name) => theme.fg("dim", `  ${name}`)),
          ...(contexts.length > 0
            ? [
                theme.fg("mdHeading", "[Context]"),
                ...contexts.map((name) => theme.fg("dim", `  ${name}`)),
              ]
            : []),
        ];

        return lines.map((line) => truncateToWidth(line, width, ""));
      },
    }));

    ctx.ui.setFooter((tui, theme) => {
      footerTimer = setInterval(() => tui.requestRender(), 1_000);
      footerTimer.unref?.();

      return {
        dispose() {
          if (footerTimer) clearInterval(footerTimer);
          footerTimer = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const cost = ctx.sessionManager.getEntries().reduce((total, entry) => total + usageCost(entry), 0);
          const usage = ctx.getContextUsage();
          const contextWindow = usage?.contextWindow ?? currentModel?.contextWindow ?? 0;
          const contextPercent = usage?.percent === null ? "?" : (usage?.percent ?? 0).toFixed(1);
          const subscription = isSubscription(ctx, currentModel) ? " (sub)" : "";

          const left = `${formatCwd(ctx.cwd)} ${formatElapsed(startedAt)}`;
          const right = [
            `$${cost.toFixed(3)}${subscription}`,
            `${contextPercent}%/${formatTokens(contextWindow)} (auto)`,
            currentModel?.id ?? "no-model",
            currentThinking,
          ].join(" ");

          return [theme.fg("dim", fitFooter(left, right, width))];
        },
      };
    });
  });

  pi.on("model_select", (event) => {
    currentModel = event.model;
  });

  pi.on("thinking_level_select", (event) => {
    currentThinking = event.level;
  });

  pi.on("session_shutdown", () => {
    if (footerTimer) clearInterval(footerTimer);
    footerTimer = undefined;
  });
}
