import type { ModelThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
  getMarkdownTheme,
  truncateHead,
  type Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  Markdown,
  type Component,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  SUBAGENT_LIMITS,
  emptyUsage,
  isScoutPhase,
  isTerminalScoutOutcome,
  normalizeScoutUsage,
  thinkingForKind,
  type ScoutKind,
  type ScoutPhase,
} from "./subagents-core.ts";
import { normalizeDisplayText, safeDisplayLine, safeDisplayText } from "./text-safety.ts";

export const SUBAGENTS_MESSAGE_TYPE = "pi-config-r-fast";

export interface ScoutProgressDetail {
  index: number;
  name: string;
  kind: ScoutKind;
  question: string;
  phase: ScoutPhase;
  model: string;
  requestedThinking: ModelThinkingLevel;
  thinking?: ModelThinkingLevel;
  serviceTier?: string;
  turns: number;
  toolUses: number;
  durationMs: number;
  usage: Usage;
  error?: string;
}

export interface ParallelScoutsDetailV2 {
  version: 2;
  total: number;
  maxConcurrency: number;
  elapsedMs?: number;
  scouts: readonly ScoutProgressDetail[];
}

export interface ParallelScoutTaskDisplay {
  name?: unknown;
  kind?: unknown;
  question?: unknown;
}

export interface ParallelScoutsArguments {
  tasks?: readonly ParallelScoutTaskDisplay[];
}

export interface SubagentsCommandMessageDetails {
  version?: number;
  task: string;
}

interface ToolResultLike {
  content?: readonly { type?: unknown; text?: unknown }[];
  details?: unknown;
}

interface RendererState {
  parallelScoutsHeader?: ParallelScoutsHeaderComponent;
}

interface RendererContext {
  args?: ParallelScoutsArguments;
  lastComponent?: Component;
  state?: RendererState;
}

interface CustomMessageLike {
  content: unknown;
  details?: unknown;
}

interface MessageOptionsLike {
  expanded: boolean;
  outputPad: number;
}

interface NormalizedBatch {
  total: number;
  maxConcurrency: number;
  elapsedMs?: number;
  scouts: ScoutProgressDetail[];
}

interface PhasePresentation {
  symbol: "○" | "●" | "✓" | "!" | "✗" | "⊘";
  label: string;
  color: "accent" | "success" | "warning" | "error" | "muted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function integer(value: unknown, fallback = 0): number {
  return Math.floor(finite(value, fallback));
}

function normalizedTasks(args: ParallelScoutsArguments | undefined): ParallelScoutTaskDisplay[] {
  return Array.isArray(args?.tasks) ? [...args.tasks] : [];
}

function normalizedKind(value: unknown, fallback: unknown): ScoutKind {
  if (value === "trace" || value === "audit" || value === "survey") return value;
  if (fallback === "trace" || fallback === "audit" || fallback === "survey") return fallback;
  return "survey";
}

function normalizedThinking(value: unknown, fallback: ModelThinkingLevel): ModelThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium"
    || value === "high" || value === "xhigh" || value === "max"
    ? value
    : fallback;
}

function normalizedPhase(value: unknown, fallback: ScoutPhase): ScoutPhase {
  return isScoutPhase(value) ? value : fallback;
}

function normalizeScout(
  value: unknown,
  position: number,
  task: ParallelScoutTaskDisplay | undefined,
  legacy = false,
): ScoutProgressDetail | undefined {
  if (!isRecord(value)) return undefined;
  const kind = normalizedKind(value.kind, task?.kind);
  const requestedThinking = normalizedThinking(value.requestedThinking, normalizedThinking(value.thinking, thinkingForKind(kind)));
  const fallbackPhase: ScoutPhase = legacy
    ? value.success === true ? "succeeded" : value.outcome === "partial" ? "partial" : "failed"
    : value.error ? "failed" : "running";
  const phase = normalizedPhase(value.phase ?? value.outcome, fallbackPhase);
  const taskName = safeDisplayLine(task?.name, SUBAGENT_LIMITS.nameCharacters);
  const suppliedName = safeDisplayLine(value.name, SUBAGENT_LIMITS.nameCharacters);
  const name = suppliedName || taskName || (legacy ? `${kind}-scout-${position + 1}` : `scout-${position + 1}`);
  const question = safeDisplayLine(value.question ?? task?.question) || "Task unavailable";
  const model = safeDisplayLine(value.model) || "unknown";
  const thinking = value.thinking === undefined ? undefined : normalizedThinking(value.thinking, requestedThinking);
  const serviceTier = safeDisplayLine(value.serviceTier) || undefined;
  const error = safeDisplayText(value.error).trim() || undefined;
  return {
    index: integer(value.index, position),
    name,
    kind,
    question,
    phase,
    model,
    requestedThinking,
    thinking,
    serviceTier,
    turns: integer(value.turns),
    toolUses: integer(value.toolUses),
    durationMs: finite(value.durationMs),
    usage: normalizeScoutUsage(value.usage) ?? emptyUsage(),
    error,
  };
}

function normalizeBatch(details: unknown, args: ParallelScoutsArguments | undefined): NormalizedBatch | undefined {
  if (!isRecord(details)) return undefined;
  const tasks = normalizedTasks(args);
  const structured = Array.isArray(details.scouts) ? details.scouts : undefined;
  const legacy = !structured && Array.isArray(details.results) ? details.results : undefined;
  const source = structured ?? legacy;
  if (!source) return undefined;
  const scouts = source
    .map((value, position) => normalizeScout(value, position, tasks[position], Boolean(legacy)))
    .filter((value): value is ScoutProgressDetail => Boolean(value))
    .sort((left, right) => left.index - right.index);
  if (scouts.length === 0) return undefined;
  const total = Math.max(scouts.length, integer(details.total, scouts.length));
  const maxConcurrency = Math.max(1, integer(details.maxConcurrency, Math.min(SUBAGENT_LIMITS.maxConcurrency, total)));
  const elapsedMs = details.elapsedMs === undefined ? undefined : finite(details.elapsedMs);
  return { total, maxConcurrency, elapsedMs, scouts };
}

function phasePresentation(phase: ScoutPhase): PhasePresentation {
  switch (phase) {
    case "queued": return { symbol: "○", label: "Queued", color: "muted" };
    case "starting": return { symbol: "●", label: "Starting", color: "accent" };
    case "running": return { symbol: "●", label: "Running", color: "accent" };
    case "succeeded": return { symbol: "✓", label: "Done", color: "success" };
    case "partial": return { symbol: "!", label: "Partial", color: "warning" };
    case "failed": return { symbol: "✗", label: "Failed", color: "error" };
    case "timed_out": return { symbol: "!", label: "Timed out", color: "warning" };
    case "aborted": return { symbol: "⊘", label: "Aborted", color: "muted" };
  }
}

function cleanWidth(width: number): number {
  return Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1);
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, cleanWidth(width), "…");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) {
    const compact = (value / 1_000).toFixed(value < 100_000 ? 1 : 0).replace(/\.0$/, "");
    return `${compact}k`;
  }
  const compact = (value / 1_000_000).toFixed(value < 100_000_000 ? 1 : 0).replace(/\.0$/, "");
  return `${compact}m`;
}

function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
}

function plural(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function extractResultText(result: ToolResultLike): string {
  if (!Array.isArray(result.content)) return "";
  return normalizeDisplayText(result.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n"));
}

function boundedMarkdown(value: string): string {
  const fallback = value.trim() || "(No findings returned.)";
  const notice = "\n\n[Displayed findings truncated by pi-config.]";
  const limited = truncateHead(fallback, {
    maxBytes: Math.max(1, SUBAGENT_LIMITS.aggregateOutputBytes - Buffer.byteLength(notice, "utf8")),
    maxLines: Math.max(1, SUBAGENT_LIMITS.aggregateOutputLines - 2),
  });
  return limited.truncated ? limited.content + notice : fallback;
}

function expandBinding(): string | undefined {
  try {
    const keys = getKeybindings().getKeys("app.tools.expand");
    return keys.length ? keys.map(String).join("/") : undefined;
  } catch {
    return undefined;
  }
}

function styledIdentityLine(scout: ScoutProgressDetail, theme: Theme, width: number): string {
  const presentation = phasePresentation(scout.phase);
  const symbol = theme.fg(presentation.color, presentation.symbol);
  const name = theme.fg("toolTitle", theme.bold(scout.name));
  const base = `${symbol} ${name}`;
  const available = cleanWidth(width) - visibleWidth(base);
  if (available < 6) return fit(base, width);
  const question = truncateToWidth(scout.question, Math.max(1, available - 3), "…");
  return fit(`${base} ${theme.fg("muted", `(${question})`)}`, width);
}

function collapsedStatusLine(scout: ScoutProgressDetail, theme: Theme, width: number): string {
  const presentation = phasePresentation(scout.phase);
  const fields = [
    `${scout.thinking ?? scout.requestedThinking} thinking`,
    scout.toolUses > 0 ? plural(scout.toolUses, "tool") : undefined,
    scout.usage.totalTokens > 0 ? `${formatCount(scout.usage.totalTokens)} tok` : undefined,
    scout.durationMs > 0 ? formatDuration(scout.durationMs) : undefined,
  ].filter((field): field is string => Boolean(field));
  const status = theme.fg(presentation.color, presentation.label);
  return fit(`  ${theme.fg("muted", "└")} ${status}${fields.length ? theme.fg("dim", ` · ${fields.join(" · ")}`) : ""}`, width);
}

function addWrapped(lines: string[], prefix: string, value: string, width: number): void {
  const safeWidth = cleanWidth(width);
  const prefixWidth = visibleWidth(prefix);
  const available = Math.max(1, safeWidth - prefixWidth);
  const wrapped = wrapTextWithAnsi(value, available);
  wrapped.forEach((line, index) => lines.push(fit(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`, safeWidth)));
}

function usageDetail(scout: ScoutProgressDetail): string {
  const usage = scout.usage;
  const parts = [
    `${formatCount(usage.totalTokens)} tok`,
    `${formatCount(usage.input)} in`,
    `${formatCount(usage.output)} out`,
  ];
  if (usage.cacheRead > 0 || usage.cacheWrite > 0) parts.push(`${formatCount(usage.cacheRead + usage.cacheWrite)} cache`);
  if ((usage.reasoning ?? 0) > 0) parts.push(`${formatCount(usage.reasoning ?? 0)} reasoning`);
  return parts.join(" · ");
}

function summaryLine(batch: NormalizedBatch, expanded: boolean, theme: Theme, width: number): string {
  const counts = new Map<ScoutPhase, number>();
  for (const scout of batch.scouts) counts.set(scout.phase, (counts.get(scout.phase) ?? 0) + 1);
  const terminal = batch.scouts.filter((scout) => isTerminalScoutOutcome(scout.phase)).length;
  const succeeded = counts.get("succeeded") ?? 0;
  const partial = counts.get("partial") ?? 0;
  const failed = counts.get("failed") ?? 0;
  const timedOut = counts.get("timed_out") ?? 0;
  const aborted = counts.get("aborted") ?? 0;
  const running = (counts.get("starting") ?? 0) + (counts.get("running") ?? 0);
  const queued = counts.get("queued") ?? 0;
  const complete = terminal >= batch.total;
  const fields = complete
    ? [
        `${succeeded}/${batch.total} succeeded`,
        partial ? `${partial} partial` : undefined,
        failed ? `${failed} failed` : undefined,
        timedOut ? `${timedOut} timed out` : undefined,
        aborted ? `${aborted} aborted` : undefined,
      ]
    : [
        `${terminal}/${batch.total} done`,
        running ? `${running} running` : undefined,
        queued ? `${queued} queued` : undefined,
      ];
  if (batch.elapsedMs !== undefined && expanded) fields.push(`${formatDuration(batch.elapsedMs)} elapsed`);
  const binding = complete && !expanded ? expandBinding() : undefined;
  if (binding) fields.push(`${binding} to expand`);
  return fit(`${theme.fg("muted", "⎿")} ${theme.fg("dim", fields.filter(Boolean).join(" · "))}`, width);
}

class ParallelScoutsHeaderComponent implements Component {
  private total: number;
  private maxConcurrency: number;
  private theme: Theme;

  constructor(total: number, maxConcurrency: number, theme: Theme) {
    this.total = total;
    this.maxConcurrency = maxConcurrency;
    this.theme = theme;
  }

  update(total: number, maxConcurrency: number, theme: Theme): void {
    this.total = total;
    this.maxConcurrency = maxConcurrency;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const count = this.total > 0 ? ` (${plural(this.total, "task")} · ${this.maxConcurrency} concurrent)` : "";
    const text = `${this.theme.fg("accent", "●")} ${this.theme.fg("toolTitle", this.theme.bold("Parallel scouts"))}${this.theme.fg("muted", count)}`;
    return [fit(text, width)];
  }
}

class ParallelScoutsResultComponent implements Component {
  private result: ToolResultLike;
  private options: ToolRenderResultOptions;
  private theme: Theme;
  private args: ParallelScoutsArguments | undefined;

  constructor(
    result: ToolResultLike,
    options: ToolRenderResultOptions,
    theme: Theme,
    args: ParallelScoutsArguments | undefined,
  ) {
    this.result = result;
    this.options = options;
    this.theme = theme;
    this.args = args;
  }

  update(
    result: ToolResultLike,
    options: ToolRenderResultOptions,
    theme: Theme,
    args: ParallelScoutsArguments | undefined,
  ): void {
    this.result = result;
    this.options = options;
    this.theme = theme;
    this.args = args;
  }

  invalidate(): void {}

  private renderLegacy(width: number): string[] {
    const value = extractResultText(this.result).trim() || (this.options.isPartial ? "Parallel scouts are starting." : "No scout output returned.");
    if (this.options.expanded) {
      const markdown = new Markdown(boundedMarkdown(value), 0, 0, getMarkdownTheme(), {
        color: (text) => this.theme.fg("toolOutput", text),
      });
      return markdown.render(cleanWidth(width)).map((line) => fit(line, width));
    }
    const sourceLines = value.split("\n");
    const lines = sourceLines.slice(0, 6).map((line) => fit(this.theme.fg("toolOutput", line), width));
    if (sourceLines.length > lines.length) {
      const binding = expandBinding();
      lines.push(fit(this.theme.fg("muted", binding ? `… ${binding} to expand` : "… more output"), width));
    }
    return lines;
  }

  private renderCollapsed(batch: NormalizedBatch, width: number): string[] {
    const lines: string[] = [""];
    for (const scout of batch.scouts) {
      lines.push(styledIdentityLine(scout, this.theme, width));
      lines.push(collapsedStatusLine(scout, this.theme, width));
    }
    lines.push("");
    lines.push(summaryLine(batch, false, this.theme, width));
    return lines;
  }

  private renderExpanded(batch: NormalizedBatch, width: number): string[] {
    const lines: string[] = [""];
    for (const scout of batch.scouts) {
      const presentation = phasePresentation(scout.phase);
      lines.push(styledIdentityLine(scout, this.theme, width));
      addWrapped(
        lines,
        `  ${this.theme.fg("muted", "Task:")} `,
        this.theme.fg("toolOutput", scout.question),
        width,
      );
      const thinking = scout.thinking ?? scout.requestedThinking;
      const thinkingText = thinking === scout.requestedThinking
        ? thinking
        : `${thinking} (requested ${scout.requestedThinking})`;
      addWrapped(
        lines,
        `  ${this.theme.fg("muted", "Run:")} `,
        this.theme.fg("dim", `${scout.kind} · ${scout.model} · ${thinkingText} thinking · ${scout.serviceTier ?? "default"} tier`),
        width,
      );
      addWrapped(
        lines,
        `  ${this.theme.fg("muted", "Stats:")} `,
        this.theme.fg("dim", `${plural(scout.turns, "turn")} · ${plural(scout.toolUses, "tool")} · ${formatDuration(scout.durationMs)} · ${usageDetail(scout)} · ${formatCost(scout.usage.cost.total)}`),
        width,
      );
      if (scout.error) {
        addWrapped(
          lines,
          `  ${this.theme.fg(presentation.color, "Error:")} `,
          this.theme.fg(presentation.color, safeDisplayLine(scout.error, 500)),
          width,
        );
      }
      lines.push("");
    }

    lines.push(this.theme.fg("muted", "Findings"));
    lines.push("");
    const markdown = new Markdown(boundedMarkdown(extractResultText(this.result)), 0, 0, getMarkdownTheme(), {
      color: (text) => this.theme.fg("toolOutput", text),
    });
    lines.push(...markdown.render(cleanWidth(width)).map((line) => fit(line, width)));
    lines.push("");
    lines.push(summaryLine(batch, true, this.theme, width));
    return lines;
  }

  render(width: number): string[] {
    const batch = normalizeBatch(this.result.details, this.args);
    if (!batch) return this.renderLegacy(width);
    return this.options.expanded ? this.renderExpanded(batch, width) : this.renderCollapsed(batch, width);
  }
}

class SubagentsCommandMessageComponent implements Component {
  private content: string;
  private task: string;
  private expanded: boolean;
  private outputPad: number;
  private theme: Theme;

  constructor(content: string, task: string, options: MessageOptionsLike, theme: Theme) {
    this.content = content;
    this.task = task;
    this.expanded = options.expanded;
    this.outputPad = options.outputPad;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = cleanWidth(width);
    const pad = Math.max(0, Math.min(Math.floor(this.outputPad), Math.floor((safeWidth - 1) / 2)));
    const contentWidth = Math.max(1, safeWidth - pad * 2);
    const prefix = "> /r-fast";
    const taskWidth = Math.max(0, contentWidth - visibleWidth(prefix) - 1);
    const task = taskWidth > 0 ? truncateToWidth(this.task, taskWidth, "…") : "";
    const header = `${this.theme.fg("customMessageLabel", prefix)}${task ? ` ${this.theme.fg("customMessageText", task)}` : ""}`;
    const contentLines: string[] = [fit(header, contentWidth)];
    if (this.expanded) {
      contentLines.push("");
      contentLines.push(this.theme.fg("muted", "Generated instructions"));
      for (const sourceLine of normalizeDisplayText(this.content).split("\n")) {
        if (!sourceLine) {
          contentLines.push("");
          continue;
        }
        contentLines.push(...wrapTextWithAnsi(this.theme.fg("customMessageText", sourceLine), contentWidth));
      }
    }
    return contentLines.map((line) => {
      const fitted = truncateToWidth(line, contentWidth, "…");
      const raw = `${" ".repeat(pad)}${fitted}`;
      const padded = raw + " ".repeat(Math.max(0, safeWidth - visibleWidth(raw)));
      return this.theme.bg("customMessageBg", padded);
    });
  }
}

function taskFromMessage(content: string, details: unknown): string {
  if (isRecord(details)) {
    const task = safeDisplayLine(details.task);
    if (task) return task;
  }
  const match = /^(?:Speed mode task|Speed task):\s*\n([\s\S]*?)(?=\n\s*\n|$)/i.exec(content);
  if (match) return safeDisplayLine(match[1]) || "task";
  return safeDisplayLine(content.split("\n").find((line) => line.trim())) || "task";
}

function customMessageText(content: unknown): string {
  if (typeof content === "string") return safeDisplayText(content);
  if (!Array.isArray(content)) return safeDisplayText(content);
  return content
    .filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => safeDisplayText(part.text))
    .join("\n");
}

export function renderParallelScoutsCall(
  args: ParallelScoutsArguments,
  theme: Theme,
  context: RendererContext,
): Component {
  const tasks = normalizedTasks(args);
  const total = tasks.length;
  const concurrency = Math.max(1, Math.min(SUBAGENT_LIMITS.maxConcurrency, total || SUBAGENT_LIMITS.maxConcurrency));
  const previous = context.lastComponent;
  const component = previous instanceof ParallelScoutsHeaderComponent
    ? previous
    : new ParallelScoutsHeaderComponent(total, concurrency, theme);
  component.update(total, concurrency, theme);
  if (context.state) context.state.parallelScoutsHeader = component;
  return component;
}

export function renderParallelScoutsResult(
  result: ToolResultLike,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: RendererContext,
): Component {
  const batch = normalizeBatch(result.details, context.args);
  if (batch && context.state?.parallelScoutsHeader) {
    context.state.parallelScoutsHeader.update(batch.total, batch.maxConcurrency, theme);
  }
  const previous = context.lastComponent;
  if (previous instanceof ParallelScoutsResultComponent) {
    previous.update(result, options, theme, context.args);
    return previous;
  }
  return new ParallelScoutsResultComponent(result, options, theme, context.args);
}

export function renderSubagentsCommandMessage(
  message: CustomMessageLike,
  options: MessageOptionsLike,
  theme: Theme,
): Component {
  const content = customMessageText(message.content);
  return new SubagentsCommandMessageComponent(content, taskFromMessage(content, message.details), options, theme);
}
