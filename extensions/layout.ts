import { watchFile, unwatchFile } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { FAST_MODE_STATUS_KEY } from "./fast.ts";
import { safeDisplayLine } from "./text-safety.ts";

export interface CompactFooterValues {
  cwd: string;
  branch: string | null;
  elapsedSeconds: number;
  statuses: readonly string[];
  cost: number;
  costLabel: "sub" | "api";
  contextPercent: number | null | undefined;
  contextWindow: number | undefined;
  autoCompact: boolean;
  model: string | undefined;
  thinking: string | undefined;
  fast: boolean;
}

export function createAnswerTimer(now: () => number = () => performance.now()) {
  let startedAt: number | undefined;
  let elapsedSeconds = 0;

  return {
    reset() {
      startedAt = undefined;
      elapsedSeconds = 0;
    },
    start() {
      startedAt = now();
      elapsedSeconds = 0;
    },
    stop() {
      if (startedAt === undefined) return;
      elapsedSeconds = Math.max(0, (now() - startedAt) / 1_000);
      startedAt = undefined;
    },
    isRunning() {
      return startedAt !== undefined;
    },
    elapsedSeconds() {
      return startedAt === undefined ? elapsedSeconds : Math.max(0, (now() - startedAt) / 1_000);
    },
  };
}

export function formatElapsed(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total % 86_400 / 3_600);
  const minutes = Math.floor(total % 3_600 / 60);
  const remainder = total % 60;
  if (days) return `${days}d${hours}h`;
  if (hours) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m${String(remainder).padStart(2, "0")}`;
  return `${remainder}s`;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function compactCwd(cwd: string, home = process.env.HOME || process.env.USERPROFILE): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const fromHome = relative(resolvedHome, resolvedCwd);
  const insideHome = fromHome === "" || (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome));
  if (!insideHome) return cwd;
  return fromHome ? `~${sep}${fromHome}` : "~";
}

export function getCostLabel(ctx: Pick<ExtensionContext, "model" | "modelRegistry">): "sub" | "api" {
  const model = ctx.model;
  if (!model) return "api";
  const oauth = ctx.modelRegistry.getProvider(model.provider)?.auth.oauth;
  return model.provider === "kimi-coding" || (ctx.modelRegistry.isUsingOAuth(model) && oauth?.isSubscription === true)
    ? "sub"
    : "api";
}

function sessionEntryCost(entry: unknown): number {
  if (!entry || typeof entry !== "object") return 0;
  const record = entry as Record<string, unknown>;
  let usage: unknown;
  if (record.type === "message" && record.message && typeof record.message === "object") {
    const message = record.message as Record<string, unknown>;
    if (message.role === "assistant" || message.role === "toolResult") usage = message.usage;
  } else if (record.type === "compaction" || record.type === "branch_summary") {
    usage = record.usage;
  }
  if (!usage || typeof usage !== "object") return 0;
  const costSummary = (usage as Record<string, unknown>).cost;
  if (!costSummary || typeof costSummary !== "object") return 0;
  const cost = (costSummary as Record<string, unknown>).total;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

export function totalSessionCost(entries: readonly unknown[]): number {
  return entries.reduce<number>((total, entry) => total + sessionEntryCost(entry), 0);
}

function joinFooterSides(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width, "...");
  if (!left) {
    const fitted = truncateToWidth(right, width, "");
    return `${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}${fitted}`;
  }

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + 1 + rightWidth <= width) {
    return `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
  }

  const fittedRight = truncateToWidth(right, Math.min(rightWidth, Math.max(1, Math.floor(width * 0.55))), "");
  const fittedRightWidth = visibleWidth(fittedRight);
  const leftLimit = width - fittedRightWidth - 1;
  if (leftLimit < 1) return truncateToWidth(fittedRight, width, "");
  const fittedLeft = truncateToWidth(left, leftLimit, "...");
  return `${fittedLeft}${" ".repeat(Math.max(1, width - visibleWidth(fittedLeft) - fittedRightWidth))}${fittedRight}`;
}

export function formatCompactFooter(values: CompactFooterValues, width: number): string[] {
  const safeWidth = Math.max(0, Math.floor(width));
  if (!safeWidth) return ["", ""];

  const location = `${safeDisplayLine(values.cwd, 2_000)}${values.branch ? `(${safeDisplayLine(values.branch, 500)})` : ""}`;
  const status = values.statuses.map((value) => safeDisplayLine(value, 500)).filter(Boolean).join(" ");
  const percent = values.contextPercent !== null && values.contextPercent !== undefined && Number.isFinite(values.contextPercent)
    ? `${values.contextPercent.toFixed(1)}%`
    : "?";
  const context = values.contextWindow && values.contextWindow > 0
    ? `${percent}/${formatTokens(values.contextWindow)}${values.autoCompact ? " (auto)" : ""}`
    : "";
  const model = `${safeDisplayLine(values.model ?? "no-model", 500)}${values.thinking ? ` (${safeDisplayLine(values.thinking, 50)})` : ""}${values.fast ? " fast" : ""}`;
  const cost = Number.isFinite(values.cost) ? Math.max(0, values.cost) : 0;
  const details = [
    `$${cost.toFixed(3)} (${values.costLabel})`,
    context,
    formatElapsed(values.elapsedSeconds),
    status,
  ].filter(Boolean).join(" ");
  const detailWidth = visibleWidth(details) + 1 + visibleWidth(model);
  const fittedDetails = status && detailWidth > safeWidth ? status : details;

  return [truncateToWidth(location, safeWidth, "..."), joinFooterSides(fittedDetails, model, safeWidth)];
}

function patchStartupSpacing(tui: Pick<TUI, "children">) {
  // ponytail: handles Pi's current document/header/resource containers; upgrade when Pi exposes startup spacing through ctx.ui.
  const document = tui.children[0];
  if (!(document instanceof Container)) return { refresh() {}, dispose() {} };
  const header = document.children[0];
  const resources = document.children[1];
  const chat = document.children[2];
  if (!(header instanceof Container) || !(resources instanceof Container) || !(chat instanceof Container)) {
    return { refresh() {}, dispose() {} };
  }

  const patched = new Map<Spacer, (width: number) => string[]>();
  const setHidden = (spacer: Spacer, hidden: boolean) => {
    const render = patched.get(spacer) ?? spacer.render;
    patched.set(spacer, render);
    spacer.render = hidden ? () => [] : render;
  };
  for (const child of header.children) {
    if (child instanceof Spacer) setHidden(child, true);
  }

  return {
    refresh() {
      const trailing = resources.children.at(-1);
      if (trailing instanceof Spacer) setHidden(trailing, chat.children.length === 0);
    },
    dispose() {
      for (const [spacer, render] of patched) spacer.render = render;
    },
  };
}

function installLayout(
  ctx: ExtensionContext,
  answerElapsedSeconds: () => number,
  answerRunning: () => boolean,
  sessionCost: () => number,
  registerTicker: (ticker: (running: boolean) => void) => void,
): void {
  if (ctx.mode !== "tui") return;
  const readAutoCompact = () => SettingsManager.create(
    ctx.cwd,
    undefined,
    { projectTrusted: ctx.isProjectTrusted() },
  ).getCompactionEnabled();
  let autoCompact = readAutoCompact();

  ctx.ui.setHeader((tui) => {
    const spacing = patchStartupSpacing(tui);
    return {
      render: () => {
        spacing.refresh();
        return [];
      },
      invalidate() {},
      dispose: spacing.dispose,
    };
  });

  ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    let timer: NodeJS.Timeout | undefined;
    const setTicker = (running: boolean) => {
      if (running && timer === undefined) {
        timer = setInterval(() => tui.requestRender(), 1_000);
        timer.unref?.();
      } else if (!running && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    registerTicker(setTicker);
    setTicker(answerRunning());
    const settingsPaths = [
      join(getAgentDir(), "settings.json"),
      ...(ctx.isProjectTrusted() ? [join(ctx.cwd, CONFIG_DIR_NAME, "settings.json")] : []),
    ];
    const refreshSettings = () => {
      const next = readAutoCompact();
      if (next === autoCompact) return;
      autoCompact = next;
      tui.requestRender();
    };
    for (const path of settingsPaths) watchFile(path, { interval: 1_000, persistent: false }, refreshSettings);
    const initialSettingsRefresh = setTimeout(refreshSettings, 1_000);
    initialSettingsRefresh.unref?.();
    return {
      render(width: number): string[] {
        const context = ctx.getContextUsage();
        const extensionStatuses = [...footerData.getExtensionStatuses().entries()]
          .sort(([left], [right]) => left.localeCompare(right));
        const fast = extensionStatuses.some(([key]) => key === FAST_MODE_STATUS_KEY);
        const statuses = extensionStatuses
          .filter(([key]) => key !== FAST_MODE_STATUS_KEY)
          .map(([, text]) => text);
        return formatCompactFooter({
          cwd: compactCwd(ctx.sessionManager.getCwd()),
          branch: footerData.getGitBranch(),
          elapsedSeconds: answerElapsedSeconds(),
          statuses,
          cost: sessionCost(),
          costLabel: getCostLabel(ctx),
          contextPercent: context?.percent,
          contextWindow: context?.contextWindow ?? ctx.model?.contextWindow,
          autoCompact,
          model: ctx.model?.id,
          thinking: ctx.model?.reasoning ? ctx.thinkingLevel : undefined,
          fast,
        }, width).map((line) => theme.fg("dim", line));
      },
      invalidate() {},
      dispose() {
        setTicker(false);
        registerTicker(() => {});
        clearTimeout(initialSettingsRefresh);
        for (const path of settingsPaths) unwatchFile(path, refreshSettings);
        unsubscribe();
      },
    };
  });
}

export default function layoutExtension(pi: ExtensionAPI): void {
  const answerTimer = createAnswerTimer();
  let sessionCost = 0;
  let processedEntries = 0;
  let setFooterTicker: (running: boolean) => void = () => {};
  const refreshSessionCost = (ctx: ExtensionContext, reset = false) => {
    if (ctx.mode !== "tui") return;
    const entries = ctx.sessionManager.getEntries();
    if (reset || entries.length < processedEntries) {
      sessionCost = 0;
      processedEntries = 0;
    }
    for (let index = processedEntries; index < entries.length; index++) {
      sessionCost += sessionEntryCost(entries[index]!);
    }
    processedEntries = entries.length;
  };

  pi.on("session_start", (_event, ctx) => {
    answerTimer.reset();
    sessionCost = 0;
    processedEntries = 0;
    refreshSessionCost(ctx, true);
    installLayout(
      ctx,
      answerTimer.elapsedSeconds,
      answerTimer.isRunning,
      () => sessionCost,
      (ticker) => { setFooterTicker = ticker; },
    );
  });
  pi.on("session_tree", (_event, ctx) => refreshSessionCost(ctx));
  pi.on("session_compact", (_event, ctx) => refreshSessionCost(ctx));
  pi.on("turn_end", (_event, ctx) => refreshSessionCost(ctx));
  pi.on("before_agent_start", () => {
    answerTimer.start();
    setFooterTicker(true);
  });
  pi.on("agent_settled", (_event, ctx) => {
    answerTimer.stop();
    setFooterTicker(false);
    refreshSessionCost(ctx);
  });
}
