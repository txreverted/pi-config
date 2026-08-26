import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type ThemeColor } from "@earendil-works/pi-coding-agent";
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
    .filter(([name]) => name !== "memory")
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
    intervalMs: 120,
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

function scrollCount(line: string | undefined, direction: "↑" | "↓"): number | undefined {
  const marker = direction === "↑" ? / ↑ (\d+) more / : / ↓ (\d+) more /;
  const count = Number(marker.exec(stripVTControlCharacters(line ?? ""))?.[1]);
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

class ChromeEditor extends CustomEditor {
  elapsed: () => string = () => "";
  status: () => string = () => "";

  override render(width: number): string[] {
    if (width < 24) return super.render(width);

    const innerWidth = width - 6;
    const lines = super.render(innerWidth);
    const horizontal = this.borderColor("─");
    const bottom = lines.findIndex((line, index) => {
      if (index === 0) return false;
      const plain = stripVTControlCharacters(line);
      return plain === "─".repeat(innerWidth) || /^─── ↓ \d+ more /.test(plain);
    });
    if (bottom < 0) return lines;

    const hiddenAbove = scrollCount(lines[0], "↑");
    const elapsed = this.elapsed();
    const label = truncateToWidth(
      `${this.borderColor("─")} 𝛑${elapsed ? ` ${elapsed}` : ""}${hiddenAbove ? ` ↑${hiddenAbove}` : ""} ❯ ${this.status()} `,
      width - 2,
      "",
    );
    const result = [
      `${this.borderColor("╭")}${label}${horizontal.repeat(Math.max(0, width - visibleWidth(label) - 2))}${this.borderColor("╮")}`,
    ];
    const input = lines.slice(1, bottom);

    if (input.length === 1) {
      const content = truncateToWidth(input[0]!, width - 6, "");
      result.push(`${this.borderColor("╰─ ")}${content}${horizontal.repeat(Math.max(0, width - visibleWidth(content) - 6))}${this.borderColor(" ─╯")}`);
    } else {
      const hiddenBelow = scrollCount(lines[bottom], "↓");
      input.forEach((line, index) => {
        const last = index === input.length - 1;
        const left = this.borderColor(last ? "╰─ " : "│  ");
        const right = this.borderColor(last && hiddenBelow ? ` ↓${hiddenBelow} ─╯` : last ? " ─╯" : "│");
        const contentWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
        const content = truncateToWidth(line, contentWidth, "");
        result.push(`${left}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${right}`);
      });
    }

    result.push(...lines.slice(bottom + 1));
    return result;
  }
}

export default function (pi: ExtensionAPI) {
  let activeIndicatorColor: string | undefined;
  let activeThinkingLevel: keyof typeof thinkingColors = "off";
  let refreshResourceHeadings: ((level: keyof typeof thinkingColors) => void) | undefined;
  let responseStartedAt: number | undefined;
  let responseFinishedAt: number | undefined;
  let requestRender: (() => void) | undefined;

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
    if (ctx.mode !== "tui") return;

    const cwd = formatCwd(ctx.cwd);
    let branch: string | null = null;
    let extensionStatuses: ReadonlyMap<string, string> = new Map();
    activeIndicatorColor = applyThinkingIndicator(ctx, activeThinkingLevel);

    ctx.ui.setFooter((tui, _theme, footerData) => {
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
        render() {
          if (refresh(activeThinkingLevel)) queueMicrotask(() => {
            if (!disposed) tui.requestRender();
          });
          return [];
        },
      };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      requestRender = () => tui.requestRender();
      const editor = new ChromeEditor(tui, theme, keybindings);
      let snapshotLeaf: string | null | undefined;
      let snapshotModel: string | undefined;
      let snapshotUsage: ReturnType<ExtensionContext["getContextUsage"]>;
      let snapshotCost = 0;
      editor.elapsed = () => {
        if (responseStartedAt === undefined) return "";
        const elapsed = formatElapsed((responseFinishedAt ?? performance.now()) - responseStartedAt);
        return elapsed ? theme.borderColor(`(${elapsed})`) : "";
      };
      editor.status = () => {
        const parenthetical = (text: string) => theme.borderColor(`(${text})`);
        const model = ctx.model?.id ?? "no-model";
        const thinking = ctx.model?.reasoning ? ` ${parenthetical(ctx.thinkingLevel ?? "off")}` : "";
        const statuses = formatExtensionStatuses(extensionStatuses);
        const path = `${cwd}${branch ? ` ${parenthetical(branch)}` : ""}`;
        const leaf = ctx.sessionManager.getLeafId();
        const selectedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
        if (leaf !== snapshotLeaf || selectedModel !== snapshotModel) {
          snapshotLeaf = leaf;
          snapshotModel = selectedModel;
          snapshotUsage = ctx.getContextUsage();
          snapshotCost = usageCost(ctx);
        }
        const percent = snapshotUsage?.percent === null ? "?" : (snapshotUsage?.percent ?? 0).toFixed(1);
        const window = formatTokens(snapshotUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
        const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
        return `${model}${thinking}${statuses ? ` ${parenthetical(statuses)}` : ""} ❯ ${path} ❯ ${percent}%/${window} ${parenthetical("auto")} ❯ $${snapshotCost.toFixed(3)}${subscription ? ` ${parenthetical("sub")}` : ""}`;
      };
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    refreshResourceHeadings = undefined;
    requestRender = undefined;
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeThinkingLevel = event.level;
    activeIndicatorColor = applyThinkingIndicator(ctx, event.level, activeIndicatorColor);
    refreshResourceHeadings?.(event.level);
  });
}
