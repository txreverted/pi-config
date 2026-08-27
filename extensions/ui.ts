import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type ExtensionAPI, type ExtensionContext, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const thinkingColors = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
} as const satisfies Record<string, ThemeColor>;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const foreground = /\x1b\[(?:39|38;(?:5;\d+|2;\d+;\d+;\d+))m/;
const leadingForeground = new RegExp(`^${foreground.source}`);
const piLogo = /^((?:\x1b\[[0-9;]*m)*)pi/;
const noComponents: readonly ComponentTree[] = [];

type ComponentTree = {
  children?: ComponentTree[];
};

type RenderableComponent = ComponentTree & {
  render: (width: number) => string[];
};

type ExpandableHeading = ComponentTree & {
  getCollapsedText: () => string;
  getExpandedText: () => string;
  setText: (text: string) => void;
};

function startupComponents(tui: unknown): {
  header: readonly ComponentTree[];
  resources: readonly ComponentTree[];
} {
  const roots = (tui as ComponentTree).children;
  const document = roots?.[0]?.children;
  // Pi mounts the header and small loaded-resources container before chat.
  return {
    header: document?.[0]?.children ?? noComponents,
    resources: document?.[1]?.children ?? noComponents,
  };
}

function isExpandableHeading(component: ComponentTree): component is ExpandableHeading {
  const candidate = component as Partial<ExpandableHeading>;
  return typeof candidate.getCollapsedText === "function"
    && typeof candidate.getExpandedText === "function"
    && typeof candidate.setText === "function";
}

function isEmptyLine(line: string): boolean {
  return stripVTControlCharacters(line).trim() === "";
}

function isImageLine(line: string): boolean {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

export function collapseEmptyLines(lines: readonly string[]): string[] {
  // Inline image protocols reserve adjacent empty rows for the image height.
  const imageRows = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!isImageLine(lines[index]!)) continue;
    imageRows.add(index);
    for (let row = index - 1; row >= 0 && isEmptyLine(lines[row]!); row--) imageRows.add(row);
    for (let row = index + 1; row < lines.length && isEmptyLine(lines[row]!); row++) imageRows.add(row);
  }

  let previousWasEmpty = false;
  return lines.filter((line, index) => {
    if (imageRows.has(index) || !isEmptyLine(line)) {
      previousWasEmpty = false;
      return true;
    }
    if (previousWasEmpty) return false;
    previousWasEmpty = true;
    return true;
  });
}

function constrainTranscriptSpacing(tui: unknown): (() => void) | undefined {
  const document = (tui as ComponentTree).children?.[0] as Partial<RenderableComponent> | undefined;
  if (typeof document?.render !== "function") return undefined;

  const originalRender = document.render;
  const render = (width: number) => collapseEmptyLines(originalRender.call(document, width));
  document.render = render;
  return () => {
    if (document.render === render) document.render = originalRender;
  };
}

function colorLoadedHeading(text: string, color: string): string {
  return leadingForeground.test(text) ? text.replace(leadingForeground, color) : text;
}

function colorPiLogo(text: string, color: string): string | undefined {
  const match = piLogo.exec(text);
  if (!match || !foreground.test(match[1]!)) return undefined;
  return text.replace(piLogo, `${match[1]!.replace(foreground, color)}pi`);
}

export function formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string {
  return [...statuses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function applyThinkingIndicator(
  ctx: ExtensionContext,
  level: keyof typeof thinkingColors,
  currentColor?: string,
): string {
  const color = ctx.ui.theme.getFgAnsi(thinkingColors[level]);
  if (color === currentColor) return color;

  ctx.ui.setWorkingIndicator({
    frames: spinnerFrames.map((frame) => ctx.ui.theme.fg(thinkingColors[level], frame)),
  });
  return color;
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  if (totalSeconds <= 0) return "";

  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return `${seconds}s`;

  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours === 0 ? `${minutes}m ${seconds}s` : `${hours}h ${minutes}m ${seconds}s`;
}

function formatCwd(cwd: string): string {
  const home = resolve(homedir());
  const path = resolve(cwd);
  const fromHome = relative(home, path);
  return fromHome === "" ? "~" : !isAbsolute(fromHome) && fromHome !== ".." && !fromHome.startsWith(`..${sep}`) ? `~${sep}${fromHome}` : cwd;
}

function usageCost(ctx: ExtensionContext): number {
  let cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
      cost += entry.usage.cost.total;
    } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
      cost += entry.message.usage.cost.total;
    }
  }
  return cost;
}

export default function (pi: ExtensionAPI) {
  let activeIndicatorColor: string | undefined;
  let activeThinkingLevel: keyof typeof thinkingColors = "off";
  let refreshResourceHeadings: ((level: keyof typeof thinkingColors) => void) | undefined;
  let responseStartedAt: number | undefined;
  let responseFinishedAt: number | undefined;
  let requestRender: (() => void) | undefined;
  let restoreTranscriptSpacing: (() => void) | undefined;

  pi.on("before_agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    responseStartedAt = performance.now();
    responseFinishedAt = undefined;
    requestRender?.();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode !== "tui" || responseStartedAt === undefined) return;
    responseFinishedAt = performance.now();
    requestRender?.();
  });

  pi.on("session_start", (_event, ctx) => {
    activeIndicatorColor = undefined;
    activeThinkingLevel = ctx.thinkingLevel ?? "off";
    refreshResourceHeadings = undefined;
    responseStartedAt = undefined;
    responseFinishedAt = undefined;
    requestRender = undefined;
    restoreTranscriptSpacing?.();
    restoreTranscriptSpacing = undefined;
    if (ctx.mode !== "tui") return;

    const cwd = formatCwd(ctx.cwd);
    let branch: string | null = null;
    let extensionStatuses: ReadonlyMap<string, string> = new Map();
    let snapshotLeaf: string | null | undefined;
    let snapshotModel: string | undefined;
    let snapshotUsage: ReturnType<ExtensionContext["getContextUsage"]>;
    let snapshotCost = 0;
    activeIndicatorColor = applyThinkingIndicator(ctx, activeThinkingLevel);

    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestRender = () => tui.requestRender();
      restoreTranscriptSpacing?.();
      restoreTranscriptSpacing = constrainTranscriptSpacing(tui);
      branch = footerData.getGitBranch();
      extensionStatuses = footerData.getExtensionStatuses();
      const unsubscribe = footerData.onBranchChange(() => {
        branch = footerData.getGitBranch();
        tui.requestRender();
      });
      let disposed = false;
      let lastHeader: readonly ComponentTree[] | undefined;
      let lastResources: readonly ComponentTree[] | undefined;
      let lastExpanded: boolean | undefined;
      let lastLevel: keyof typeof thinkingColors | undefined;
      let lastTheme: unknown;
      const refresh = (level: keyof typeof thinkingColors): boolean => {
        const { header, resources } = startupComponents(tui);
        const expanded = ctx.ui.getToolsExpanded();
        const currentTheme = ctx.ui.theme;
        const stateChanged = header !== lastHeader
          || resources !== lastResources
          || expanded !== lastExpanded
          || level !== lastLevel
          || currentTheme !== lastTheme;
        if (!stateChanged) return false;

        const color = currentTheme.getFgAnsi(thinkingColors[level]);
        let changed = false;
        for (const component of header) {
          if (!isExpandableHeading(component)) continue;
          const source = expanded ? component.getExpandedText() : component.getCollapsedText();
          const text = colorPiLogo(source, color);
          if (text !== undefined) {
            component.setText(text);
            changed = true;
          }
        }
        for (const component of resources) {
          if (!isExpandableHeading(component)) continue;
          const source = expanded ? component.getExpandedText() : component.getCollapsedText();
          component.setText(colorLoadedHeading(source, color));
          changed = true;
        }

        lastHeader = header;
        lastResources = resources;
        lastExpanded = expanded;
        lastLevel = level;
        lastTheme = currentTheme;
        return changed;
      };
      const refreshAndRender = (level: keyof typeof thinkingColors) => {
        if (!disposed && refresh(level)) tui.requestRender();
      };
      refreshResourceHeadings = refreshAndRender;

      return {
        dispose() {
          disposed = true;
          unsubscribe();
          if (refreshResourceHeadings === refreshAndRender) refreshResourceHeadings = undefined;
        },
        invalidate() {},
        render(width: number) {
          if (refresh(activeThinkingLevel)) queueMicrotask(() => {
            if (!disposed) tui.requestRender();
          });

          const leaf = ctx.sessionManager.getLeafId();
          const selectedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          if (leaf !== snapshotLeaf || selectedModel !== snapshotModel) {
            snapshotLeaf = leaf;
            snapshotModel = selectedModel;
            snapshotUsage = ctx.getContextUsage();
            snapshotCost = usageCost(ctx);
          }

          const elapsed = responseStartedAt === undefined
            ? ""
            : formatElapsed((responseFinishedAt ?? performance.now()) - responseStartedAt);
          const percent = snapshotUsage?.percent === null ? "?" : `${(snapshotUsage?.percent ?? 0).toFixed(1)}%`;
          const window = formatTokens(snapshotUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
          const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
          const left = `${elapsed ? `(${elapsed}) ` : ""}${percent}/${window} (auto) $${snapshotCost.toFixed(3)}${subscription ? " (sub)" : ""}`;
          const model = `${ctx.model?.id ?? "no-model"}${ctx.model?.reasoning ? ` (${activeThinkingLevel})` : ""}`;
          const gap = width - visibleWidth(left) - visibleWidth(model);
          const stats = gap >= 2 ? `${left}${" ".repeat(gap)}${model}` : `${left}  ${model}`;
          const currentTheme = ctx.ui.theme;
          const lines = [
            currentTheme.fg("dim", truncateToWidth(`${cwd}${branch ? ` (${branch})` : ""}`, width, "")),
            currentTheme.fg("dim", truncateToWidth(stats, width, "")),
          ];
          const statuses = formatExtensionStatuses(extensionStatuses);
          if (statuses) lines.push(currentTheme.fg("dim", truncateToWidth(statuses, width, "")));
          return lines;
        },
      };
    });
  });

  pi.on("session_shutdown", () => {
    refreshResourceHeadings = undefined;
    requestRender = undefined;
    restoreTranscriptSpacing?.();
    restoreTranscriptSpacing = undefined;
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeThinkingLevel = event.level;
    activeIndicatorColor = applyThinkingIndicator(ctx, event.level, activeIndicatorColor);
    refreshResourceHeadings?.(event.level);
  });
}
