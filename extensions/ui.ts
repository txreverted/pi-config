import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
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
const fastModeEntry = "ui-fast-mode";

export function supportsFastMode(model: { api: string; id: string; provider: string } | undefined): boolean {
  return model !== undefined
    && (model.provider === "openai" || model.provider === "openai-codex")
    && (model.api === "openai-completions" || model.api === "openai-responses" || model.api === "openai-codex-responses")
    && /^gpt-5\.6(?:-|$)/.test(model.id);
}

function restoreFastMode(ctx: ExtensionContext): boolean {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry?.type === "custom" && entry.customType === fastModeEntry) {
      return typeof entry.data === "object" && entry.data !== null && "enabled" in entry.data && entry.data.enabled === true;
    }
  }
  return false;
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
    intervalMs: 80,
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
  return fromHome === "" ? "~" : fromHome !== ".." && !fromHome.startsWith(`..${sep}`) ? `~${sep}${fromHome}` : cwd;
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

class ChromeEditor extends CustomEditor {
  status: () => string = () => "";

  override render(width: number): string[] {
    if (width < 8) return super.render(width);

    const innerWidth = width - 6;
    const lines = super.render(innerWidth);
    const horizontal = this.borderColor("─");
    const bottom = lines.indexOf(horizontal.repeat(innerWidth), 1);
    if (bottom < 0) return lines;

    const label = truncateToWidth(`${this.borderColor("─")} 𝛑 ❯ ${this.status()} `, width - 2, "");
    const result = [
      `${this.borderColor("╭")}${label}${horizontal.repeat(Math.max(0, width - visibleWidth(label) - 2))}${this.borderColor("╮")}`,
    ];
    const input = lines.slice(1, bottom);

    if (input.length === 1) {
      const content = truncateToWidth(input[0]!, width - 6, "");
      result.push(`${this.borderColor("╰─ ")}${content}${horizontal.repeat(Math.max(0, width - visibleWidth(content) - 6))}${this.borderColor(" ─╯")}`);
    } else {
      input.forEach((line, index) => {
        const last = index === input.length - 1;
        const left = this.borderColor(last ? "╰─ " : "│  ");
        const right = this.borderColor(last ? " ─╯" : "│");
        const content = truncateToWidth(line, width - 6, "");
        result.push(`${left}${content}${" ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(content) - visibleWidth(right)))}${right}`);
      });
    }

    result.push(...lines.slice(bottom + 1));
    return result;
  }
}

export default function (pi: ExtensionAPI) {
  let activeIndicatorColor: string | undefined;
  let responseStartedAt: number | undefined;
  let responseFinishedAt: number | undefined;
  let requestRender: (() => void) | undefined;
  let fastMode = false;

  pi.registerCommand("fast", {
    description: "Toggle OpenAI Fast mode for this session",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (value !== "" && value !== "on" && value !== "off") {
        ctx.ui.notify("Usage: /fast [on|off]", "warning");
        return;
      }

      const enabled = value === "on" || (value === "" && !fastMode);
      if (enabled && !supportsFastMode(ctx.model)) {
        ctx.ui.notify("Fast mode is supported here only for OpenAI GPT-5.6 models.", "warning");
        return;
      }

      fastMode = enabled;
      pi.appendEntry(fastModeEntry, { enabled });
      requestRender?.();
      ctx.ui.notify(`Fast mode ${enabled ? "enabled; premium usage applies" : "disabled"}.`, "info");
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastMode || !supportsFastMode(ctx.model) || typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return;
    return { ...event.payload, service_tier: "priority" };
  });

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
    responseStartedAt = undefined;
    responseFinishedAt = undefined;
    requestRender = undefined;
    fastMode = restoreFastMode(ctx);
    if (ctx.mode !== "tui") return;

    let branch: string | null = null;
    activeIndicatorColor = applyThinkingIndicator(ctx, ctx.thinkingLevel ?? "off");

    ctx.ui.setFooter((tui, _theme, footerData) => {
      branch = footerData.getGitBranch();
      const dispose = footerData.onBranchChange(() => {
        branch = footerData.getGitBranch();
        tui.requestRender();
      });
      return { dispose, invalidate() {}, render: () => [] };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      requestRender = () => tui.requestRender();
      const editor = new ChromeEditor(tui, theme, keybindings);
      let snapshotLeaf: string | null | undefined;
      let snapshotUsage: ReturnType<ExtensionContext["getContextUsage"]>;
      let snapshotCost = 0;
      editor.status = () => {
        const parenthetical = (text: string) => theme.borderColor(`(${text})`);
        const model = ctx.model?.id ?? "no-model";
        const fast = fastMode && supportsFastMode(ctx.model) ? "✧ " : "";
        const thinking = ctx.model?.reasoning ? ` ${parenthetical(`${fast}${ctx.thinkingLevel ?? "off"}`)}` : "";
        const elapsed = responseStartedAt === undefined
          ? ""
          : formatElapsed((responseFinishedAt ?? performance.now()) - responseStartedAt);
        const path = `${formatCwd(ctx.cwd)}${branch ? ` ${parenthetical(branch)}` : ""}`;
        const leaf = ctx.sessionManager.getLeafId();
        if (leaf !== snapshotLeaf) {
          snapshotLeaf = leaf;
          snapshotUsage = ctx.getContextUsage();
          snapshotCost = usageCost(ctx);
        }
        const percent = snapshotUsage?.percent === null ? "?" : (snapshotUsage?.percent ?? 0).toFixed(1);
        const window = formatTokens(snapshotUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
        const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
        return `${model}${thinking}${elapsed ? ` ${parenthetical(elapsed)}` : ""} ❯ ${path} ❯ ${percent}%/${window} ${parenthetical("auto")} ❯ $${snapshotCost.toFixed(3)}${subscription ? ` ${parenthetical("sub")}` : ""}`;
      };
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    requestRender = undefined;
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeIndicatorColor = applyThinkingIndicator(ctx, event.level, activeIndicatorColor);
  });
}
