import { watchFile, unwatchFile } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  SettingsManager,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { safeDisplayLine } from "./text-safety.ts";

export interface CompactFooterValues {
  version: string;
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

export function totalSessionCost(entries: readonly SessionEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    const usage = entry.type === "message"
      ? entry.message.role === "assistant" || entry.message.role === "toolResult" ? entry.message.usage : undefined
      : entry.type === "compaction" || entry.type === "branch_summary" ? entry.usage : undefined;
    const cost = usage?.cost.total;
    if (cost !== undefined && Number.isFinite(cost) && cost >= 0) total += cost;
  }
  return total;
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

export function formatCompactFooter(values: CompactFooterValues, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (!safeWidth) return "";

  const location = `${safeDisplayLine(values.cwd, 2_000)}${values.branch ? `(${safeDisplayLine(values.branch, 500)})` : ""}`;
  const status = values.statuses.map((value) => safeDisplayLine(value, 500)).filter(Boolean).join(" ");
  const percent = values.contextPercent !== null && values.contextPercent !== undefined && Number.isFinite(values.contextPercent)
    ? `${values.contextPercent.toFixed(1)}%`
    : "?";
  const context = values.contextWindow && values.contextWindow > 0
    ? `${percent}/${formatTokens(values.contextWindow)}${values.autoCompact ? " (auto)" : ""}`
    : "";
  const model = `${safeDisplayLine(values.model ?? "no-model", 500)}${values.thinking ? ` (${safeDisplayLine(values.thinking, 50)})` : ""}`;
  const cost = Number.isFinite(values.cost) ? Math.max(0, values.cost) : 0;

  let showElapsed = true;
  let showVersion = true;
  let showCost = true;
  let showLocation = true;
  let showContext = true;
  let showModel = true;
  const build = () => {
    const left = [
      showVersion ? `pi v${values.version}` : "",
      showLocation ? location : "",
      showElapsed ? formatElapsed(values.elapsedSeconds) : "",
      status,
    ].filter(Boolean).join(" ");
    const right = [
      showCost ? `$${cost.toFixed(3)} (${values.costLabel})` : "",
      showContext ? context : "",
      showModel ? model : "",
    ].filter(Boolean).join(" ");
    return { left, right };
  };

  for (const hide of [
    () => { showElapsed = false; },
    () => { showVersion = false; },
    () => { showCost = false; },
    () => { if (status) showLocation = false; },
    () => { if (status) showModel = false; },
    () => { if (status) showContext = false; },
  ]) {
    const { left, right } = build();
    if (visibleWidth(left) + (left && right ? 1 : 0) + visibleWidth(right) <= safeWidth) break;
    hide();
  }

  const { left, right } = build();
  return joinFooterSides(left, right, safeWidth);
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

  ctx.ui.setHeader(() => ({
    render: () => [],
    invalidate() {},
  }));

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
    return {
      render(width: number): string[] {
        const context = ctx.getContextUsage();
        const statuses = [...footerData.getExtensionStatuses().entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, text]) => text);
        const line = formatCompactFooter({
          version: VERSION,
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
        }, width);
        return [theme.fg("dim", line)];
      },
      invalidate() {},
      dispose() {
        setTicker(false);
        registerTicker(() => {});
        for (const path of settingsPaths) unwatchFile(path, refreshSettings);
        unsubscribe();
      },
    };
  });
}

export default function layoutExtension(pi: ExtensionAPI): void {
  const answerTimer = createAnswerTimer();
  let sessionCost = 0;
  let setFooterTicker: (running: boolean) => void = () => {};
  const refreshSessionCost = (ctx: ExtensionContext) => {
    if (ctx.mode === "tui") sessionCost = totalSessionCost(ctx.sessionManager.getEntries());
  };

  pi.on("session_start", (_event, ctx) => {
    answerTimer.reset();
    refreshSessionCost(ctx);
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
