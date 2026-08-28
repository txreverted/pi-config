import type { Model, Usage } from "@earendil-works/pi-ai";
import type {
  ContextUsage,
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Loader, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

const WORKING_WIDGET = "ui-working";
type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface UsageSummary {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
}

export interface FooterState {
  cwd: string;
  home?: string;
  branch: string | null;
  sessionName?: string;
  durationMs?: number;
  usage: UsageSummary;
  contextUsage?: ContextUsage;
  model?: Model<any>;
  thinkingLevel: ThinkingLevel;
  usingSubscription: boolean;
  extensionStatuses: ReadonlyMap<string, string>;
}

function emptyUsage(): UsageSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(summary: UsageSummary, usage: Usage): void {
  summary.input += usage.input;
  summary.output += usage.output;
  summary.cacheRead += usage.cacheRead;
  summary.cacheWrite += usage.cacheWrite;
  summary.cost += usage.cost.total;
}

function addAssistantUsage(summary: UsageSummary, usage: Usage): void {
  addUsage(summary, usage);
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  summary.latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

export function summarizeUsage(entries: readonly SessionEntry[]): UsageSummary {
  const summary = emptyUsage();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      addAssistantUsage(summary, entry.message.usage);
    } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
      addUsage(summary, entry.message.usage);
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
      addUsage(summary, entry.usage);
    }
  }
  return summary;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${totalSeconds % 60}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h${totalMinutes % 60}m`;
  return `${Math.floor(totalHours / 24)}d${totalHours % 24}h`;
}

export function formatCwd(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const insideHome = relativeToHome === "" || (
    relativeToHome !== ".." &&
    !relativeToHome.startsWith(`..${sep}`) &&
    !isAbsolute(relativeToHome)
  );
  if (!insideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatus(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function renderFooter(width: number, state: FooterState, theme: Theme): string[] {
  if (width <= 0) return ["", ""];

  let pwd = formatCwd(state.cwd, state.home);
  if (state.branch) pwd += ` (${state.branch})`;
  if (state.sessionName) pwd += ` • ${state.sessionName}`;

  const parts: string[] = [];
  if (state.durationMs !== undefined) parts.push(`(${formatDuration(state.durationMs)})`);
  if (state.usage.input) parts.push(`↑${formatTokens(state.usage.input)}`);
  if (state.usage.output) parts.push(`↓${formatTokens(state.usage.output)}`);
  if (state.usage.cacheRead) parts.push(`R${formatTokens(state.usage.cacheRead)}`);
  if (state.usage.cacheWrite) parts.push(`W${formatTokens(state.usage.cacheWrite)}`);
  if ((state.usage.cacheRead || state.usage.cacheWrite) && state.usage.latestCacheHitRate !== undefined) {
    parts.push(`CH${state.usage.latestCacheHitRate.toFixed(1)}%`);
  }
  if (state.usage.cost || state.usingSubscription) {
    parts.push(`$${state.usage.cost.toFixed(3)}${state.usingSubscription ? " (sub)" : ""}`);
  }

  // ponytail: assumes auto-compaction stays enabled; upgrade when ExtensionContext exposes this setting.
  const contextWindow = state.contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
  const contextPercent = state.contextUsage?.percent;
  const contextText = contextPercent === null
    ? `?/${formatTokens(contextWindow)} (auto)`
    : `${(contextPercent ?? 0).toFixed(1)}%/${formatTokens(contextWindow)} (auto)`;
  parts.push(contextPercent !== null && contextPercent !== undefined && contextPercent > 90
    ? theme.fg("error", contextText)
    : contextPercent !== null && contextPercent !== undefined && contextPercent > 70
      ? theme.fg("warning", contextText)
      : contextText);

  let left = parts.join(" ");
  if (visibleWidth(left) > width) left = truncateToWidth(left, width, "...");

  const modelName = state.model?.id ?? "no-model";
  const right = state.model?.reasoning ? `${modelName} (${state.thinkingLevel})` : modelName;
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  let statsLine = left;
  if (leftWidth + 2 + rightWidth <= width) {
    statsLine += " ".repeat(width - leftWidth - rightWidth) + right;
  } else {
    const available = width - leftWidth - 2;
    if (available > 0) {
      const shortened = truncateToWidth(right, available, "");
      statsLine += " ".repeat(Math.max(0, width - leftWidth - visibleWidth(shortened))) + shortened;
    }
  }

  const lines = [
    truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
    theme.fg("dim", statsLine),
  ];
  if (state.extensionStatuses.size > 0) {
    const status = [...state.extensionStatuses.entries()]
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([, text]) => sanitizeStatus(text))
      .join(" ");
    lines.push(truncateToWidth(status, width, theme.fg("dim", "...")));
  }
  return lines;
}

class SingleLineWorkingLoader implements Component {
  private readonly loader: Loader;

  constructor(tui: TUI, theme: Theme, getThinkingLevel: () => ThinkingLevel, message: string) {
    const color = (text: string) => theme.getThinkingBorderColor(getThinkingLevel())(text);
    this.loaderMessage = message;
    this.loader = new Loader(tui, color, color, message);
  }

  render(width: number): string[] {
    return this.loader.render(width).slice(1);
  }

  invalidate(): void {
    this.loader.invalidate();
    this.loader.setMessage(this.loaderMessage);
  }

  private loaderMessage = "Working...";

  update(message: string): void {
    this.loaderMessage = message;
    this.loader.setMessage(message);
  }

  dispose(): void {
    this.loader.stop();
  }
}

function usesSubscription(ctx: ExtensionContext, model: Model<any> | undefined): boolean {
  if (!model) return false;
  if (model.provider === "kimi-coding") return true;
  return ctx.modelRegistry.isUsingOAuth(model) && ctx.modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true;
}

export default function uiExtension(pi: ExtensionAPI): void {
  let usage = emptyUsage();
  let contextUsage: ContextUsage | undefined;
  let sessionName: string | undefined;
  let model: Model<any> | undefined;
  let thinkingLevel: ThinkingLevel = "off";
  let usingSubscription = false;
  let durationMs: number | undefined;
  let runStartedAt: number | undefined;
  let clock: NodeJS.Timeout | undefined;
  let workingLoader: SingleLineWorkingLoader | undefined;
  let requestFooterRender: (() => void) | undefined;
  let tuiActive = false;

  const stopClock = () => {
    if (clock) clearInterval(clock);
    clock = undefined;
  };

  const updateClock = () => {
    if (runStartedAt === undefined) return;
    durationMs = Date.now() - runStartedAt;
    workingLoader?.update(`Working... (${formatDuration(durationMs)})`);
    requestFooterRender?.();
  };

  const hideWorking = (ctx: ExtensionContext) => {
    ctx.ui.setWidget(WORKING_WIDGET, undefined);
    workingLoader = undefined;
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    tuiActive = true;
    const entries = ctx.sessionManager.getEntries();
    usage = summarizeUsage(entries);
    contextUsage = ctx.getContextUsage();
    sessionName = entries.findLast((entry) => entry.type === "session_info")?.name?.trim() || undefined;
    model = ctx.model;
    thinkingLevel = ctx.thinkingLevel ?? "off";
    usingSubscription = usesSubscription(ctx, model);
    durationMs = undefined;
    runStartedAt = undefined;
    stopClock();

    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      let disposed = false;
      const render = () => {
        if (!disposed) tui.requestRender();
      };
      requestFooterRender = render;
      const unsubscribe = footerData.onBranchChange(render);
      return {
        render: (width: number) => renderFooter(width, {
          cwd: ctx.sessionManager.getCwd(),
          home: process.env.HOME || process.env.USERPROFILE,
          branch: footerData.getGitBranch(),
          sessionName,
          durationMs,
          usage,
          contextUsage,
          model,
          thinkingLevel,
          usingSubscription,
          extensionStatuses: footerData.getExtensionStatuses(),
        }, theme),
        invalidate() {
          workingLoader?.update(`Working... (${formatDuration(durationMs ?? 0)})`);
        },
        dispose() {
          disposed = true;
          unsubscribe();
          if (requestFooterRender === render) requestFooterRender = undefined;
        },
      };
    });
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!tuiActive) return;
    runStartedAt ??= Date.now();
    updateClock();
    ctx.ui.setWidget(WORKING_WIDGET, (tui, theme) => {
      workingLoader = new SingleLineWorkingLoader(
        tui,
        theme,
        () => thinkingLevel,
        `Working... (${formatDuration(durationMs ?? 0)})`,
      );
      return workingLoader;
    });
    stopClock();
    clock = setInterval(updateClock, 1_000);
    clock.unref();
  });

  pi.on("agent_end", (_event, ctx) => {
    if (tuiActive) hideWorking(ctx);
  });

  pi.on("agent_settled", (_event, _ctx) => {
    if (!tuiActive || runStartedAt === undefined) return;
    updateClock();
    runStartedAt = undefined;
    stopClock();
  });

  pi.on("message_end", (event, ctx) => {
    if (!tuiActive) return;
    if (event.message.role === "assistant") {
      addAssistantUsage(usage, event.message.usage);
      contextUsage = ctx.getContextUsage();
    } else if (event.message.role === "toolResult" && event.message.usage) {
      addUsage(usage, event.message.usage);
    }
  });

  pi.on("session_compact", (event, ctx) => {
    if (!tuiActive) return;
    if (event.compactionEntry.usage) addUsage(usage, event.compactionEntry.usage);
    contextUsage = ctx.getContextUsage();
  });

  pi.on("session_tree", (event, ctx) => {
    if (!tuiActive) return;
    if (event.summaryEntry?.usage) addUsage(usage, event.summaryEntry.usage);
    contextUsage = ctx.getContextUsage();
  });

  pi.on("session_info_changed", (event) => {
    if (!tuiActive) return;
    sessionName = event.name;
    requestFooterRender?.();
  });

  pi.on("thinking_level_select", (event) => {
    if (!tuiActive) return;
    thinkingLevel = event.level;
    workingLoader?.update(`Working... (${formatDuration(durationMs ?? 0)})`);
    requestFooterRender?.();
  });

  pi.on("model_select", (event, ctx) => {
    if (!tuiActive) return;
    model = event.model;
    thinkingLevel = ctx.thinkingLevel ?? "off";
    usingSubscription = usesSubscription(ctx, model);
    contextUsage = ctx.getContextUsage();
    workingLoader?.update(`Working... (${formatDuration(durationMs ?? 0)})`);
    requestFooterRender?.();
  });

  pi.on("session_shutdown", () => {
    tuiActive = false;
    stopClock();
    workingLoader?.dispose();
    workingLoader = undefined;
    requestFooterRender = undefined;
  });
}
