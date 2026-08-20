import {
  buildSessionContext,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  type KeybindingsManager,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { buildContextSnapshot, type ContextCategory, type ContextSnapshot } from "./context-core.ts";
import { safeDisplayLine } from "./text-safety.ts";

interface ContextRow {
  category: ContextCategory;
  depth: number;
  marker: string;
}

const CATEGORY_MARKERS: Record<string, string> = {
  "system-prompt": "P",
  memory: "M",
  skills: "S",
  "appended-prompt": "P",
  "extension-policies": "E",
  "system-tools": "T",
  "custom-tools": "T",
  "user-messages": "U",
  "agent-messages": "A",
  "tool-output": "O",
  "shell-output": "B",
  "extension-messages": "X",
  "compacted-data": "C",
};
const MARKER_COLORS = ["accent", "success", "warning", "text", "muted"] as const;

export function parseContextCommand(args: string): boolean {
  const normalized = args.trim().toLowerCase();
  return normalized === "" || normalized === "usage";
}

export function formatContextTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

export function flattenContextRows(snapshot: ContextSnapshot): ContextRow[] {
  return snapshot.categories.flatMap((category) => [
    { category, depth: 0, marker: CATEGORY_MARKERS[category.id] ?? "?" },
    ...(category.children ?? []).map((child) => ({ category: child, depth: 1, marker: "-" })),
  ]);
}

function contextBar(snapshot: ContextSnapshot, width: number, theme: Theme): string {
  const innerWidth = Math.max(0, width - 2);
  if (!innerWidth) return truncateToWidth("[]", width, "");
  const window = snapshot.contextWindow;
  if (!window || window <= 0) return `[${"?".repeat(innerWidth)}]`;

  let cumulativeTokens = 0;
  let usedCells = 0;
  const segments: string[] = [];
  snapshot.categories.forEach((category, index) => {
    cumulativeTokens += category.tokens;
    const end = Math.min(innerWidth, Math.round(cumulativeTokens / window * innerWidth));
    const count = Math.max(0, end - usedCells);
    if (count) {
      const marker = CATEGORY_MARKERS[category.id] ?? "?";
      segments.push(theme.fg(MARKER_COLORS[index % MARKER_COLORS.length]!, marker.repeat(count)));
      usedCells = end;
    }
  });
  const reportedCells = typeof snapshot.reportedTokens === "number"
    ? Math.min(innerWidth, Math.round(snapshot.reportedTokens / window * innerWidth))
    : usedCells;
  if (reportedCells > usedCells) segments.push(theme.fg("dim", "?".repeat(reportedCells - usedCells)));
  const occupied = Math.max(usedCells, reportedCells);
  if (occupied < innerWidth) segments.push(theme.fg("dim", ".".repeat(innerWidth - occupied)));
  return `[${segments.join("")}]`;
}

function formatRow(row: ContextRow, snapshot: ContextSnapshot, width: number, theme: Theme): string {
  const marker = row.depth === 0
    ? theme.fg("accent", `[${row.marker}]`)
    : theme.fg("dim", "  -");
  const label = safeDisplayLine(row.category.label, 500);
  const value = `${formatContextTokens(row.category.tokens)} ${snapshot.contextWindow
    ? `${(row.category.tokens / snapshot.contextWindow * 100).toFixed(1)}%`
    : ""}`.trim();
  const prefix = `${marker} `;
  const valueWidth = visibleWidth(value);
  if (width <= visibleWidth(prefix) + valueWidth + 1) {
    return truncateToWidth(`${prefix}${label}`, width, "");
  }
  const labelWidth = width - visibleWidth(prefix) - valueWidth - 1;
  const fitted = truncateToWidth(label, labelWidth, "...");
  return `${prefix}${fitted}${" ".repeat(Math.max(1, width - visibleWidth(prefix) - visibleWidth(fitted) - valueWidth))}${theme.fg("muted", value)}`;
}

export function createContextComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  snapshot: ContextSnapshot,
  done: () => void,
): { render(width: number): string[]; handleInput(data: string): void; invalidate(): void } {
  const rows = flattenContextRows(snapshot);
  let offset = 0;
  let pageSize = 1;
  const refresh = () => tui.requestRender();
  const move = (amount: number) => {
    offset = Math.max(0, Math.min(Math.max(0, rows.length - pageSize), offset + amount));
    refresh();
  };

  return {
    invalidate() {},
    handleInput(data: string) {
      if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "q")) {
        done();
        return;
      }
      if (keybindings.matches(data, "tui.select.up") || matchesKey(data, "k")) move(-1);
      else if (keybindings.matches(data, "tui.select.down") || matchesKey(data, "j")) move(1);
      else if (matchesKey(data, Key.pageUp)) move(-pageSize);
      else if (matchesKey(data, Key.pageDown)) move(pageSize);
      else if (matchesKey(data, Key.home)) { offset = 0; refresh(); }
      else if (matchesKey(data, Key.end)) { offset = Math.max(0, rows.length - pageSize); refresh(); }
    },
    render(width: number): string[] {
      const safeWidth = Math.max(1, Math.floor(width));
      const maxRows = Math.max(1, (tui.terminal?.rows ?? 30) - 2);
      const border = theme.fg("borderMuted", "─".repeat(safeWidth));
      const reported = snapshot.reportedTokens === undefined
        ? "Provider usage unavailable"
        : snapshot.reportedTokens === null
          ? "Current usage unknown after compaction"
          : `${formatContextTokens(snapshot.reportedTokens)} / ${formatContextTokens(snapshot.contextWindow ?? 0)}${typeof snapshot.reportedPercent === "number" ? ` (${snapshot.reportedPercent.toFixed(1)}%)` : ""}`;
      const policyState = snapshot.turnPoliciesObserved ? "" : " | turn policies pending";
      const estimate = `Estimated breakdown ${formatContextTokens(snapshot.estimatedTokens)}${snapshot.reserveTokens === undefined ? "" : ` | auto-compact reserve ${formatContextTokens(snapshot.reserveTokens)}`}${policyState}`;
      const title = `Context usage${snapshot.model ? ` | ${safeDisplayLine(snapshot.model, 200)}` : ""}`;
      const fit = (line: string) => truncateToWidth(line, safeWidth, "");
      const titleLine = theme.fg("accent", theme.bold(title));
      const reportedLine = theme.fg("text", reported);
      const estimateLine = theme.fg("muted", estimate);
      const barLine = contextBar(snapshot, safeWidth, theme);
      const helpLine = theme.fg("dim", "up/down or j/k scroll | page up/down | q/esc close");
      const compactHelpLine = theme.fg("dim", "j/k scroll | q/esc close");
      const responsiveHelpLine = visibleWidth(helpLine) <= safeWidth ? helpLine : compactHelpLine;
      if (maxRows === 1) return [fit(titleLine)];
      if (maxRows === 2) return [fit(titleLine), fit("q/esc close")];

      const header = maxRows >= 10
        ? [border, titleLine, reportedLine, estimateLine, barLine, ""]
        : maxRows >= 6
          ? [titleLine, reportedLine, estimateLine, barLine]
          : maxRows >= 5
            ? [titleLine, reportedLine, barLine]
            : maxRows >= 4
              ? [titleLine, reportedLine]
              : [titleLine];
      const footer = maxRows >= 10 ? ["", responsiveHelpLine, border] : [compactHelpLine];
      pageSize = Math.max(1, maxRows - header.length - footer.length);
      offset = Math.min(offset, Math.max(0, rows.length - pageSize));
      const body = rows.slice(offset, offset + pageSize).map((row) => formatRow(row, snapshot, safeWidth, theme));
      if (offset > 0 && body.length >= 3) body[0] = theme.fg("dim", fit("... more above"));
      if (offset + pageSize < rows.length && body.length >= 3) body[body.length - 1] = theme.fg("dim", fit("... more below"));
      return [...header, ...body, ...footer].slice(0, maxRows).map(fit);
    },
  };
}

function readReserveTokens(ctx: ExtensionCommandContext): number | undefined {
  try {
    const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
    return settings.getCompactionEnabled() ? settings.getCompactionReserveTokens() : undefined;
  } catch {
    return undefined;
  }
}

export default function contextExtension(pi: ExtensionAPI): void {
  let latestSystemPrompt: string | undefined;

  pi.on("session_start", () => {
    latestSystemPrompt = undefined;
  });
  pi.on("before_agent_start", (event) => {
    latestSystemPrompt = event.systemPrompt;
  });

  pi.registerCommand("context", {
    description: "[usage] - Show what occupies the model context",
    getArgumentCompletions(prefix) {
      return "usage".startsWith(prefix.trimStart().toLowerCase())
        ? [{ value: "usage", label: "usage", description: "Show context usage" }]
        : null;
    },
    handler: async (args, ctx) => {
      if (!parseContextCommand(args)) {
        ctx.ui.notify("Usage: /context [usage]", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/context requires TUI mode.", "warning");
        return;
      }
      await ctx.waitForIdle();
      const messages = buildSessionContext(
        ctx.sessionManager.getEntries(),
        ctx.sessionManager.getLeafId(),
      ).messages;
      const snapshot = buildContextSnapshot({
        systemPrompt: latestSystemPrompt ?? ctx.getSystemPrompt(),
        options: ctx.getSystemPromptOptions(),
        tools: pi.getAllTools(),
        activeToolNames: pi.getActiveTools(),
        messages,
        reported: ctx.getContextUsage(),
        model: ctx.model?.id,
        reserveTokens: readReserveTokens(ctx),
        turnPoliciesObserved: latestSystemPrompt !== undefined,
      });
      await ctx.ui.custom<void>((tui, theme, keybindings, done) =>
        createContextComponent(tui, theme, keybindings, snapshot, done)
      );
    },
  });
}
