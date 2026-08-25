import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
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
        const left = index === 0 ? this.borderColor("╰  ") : "   ";
        const right = this.borderColor(index === input.length - 1 ? "╯" : "│");
        const content = truncateToWidth(line, width - 6, "");
        result.push(`${left}${content}${" ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(content) - 1))}${right}`);
      });
    }

    result.push(...lines.slice(bottom + 1));
    return result;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    let branch: string | null = null;

    ctx.ui.setFooter((tui, _theme, footerData) => {
      branch = footerData.getGitBranch();
      const dispose = footerData.onBranchChange(() => {
        branch = footerData.getGitBranch();
        tui.requestRender();
      });
      return { dispose, invalidate() {}, render: () => [] };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new ChromeEditor(tui, theme, keybindings);
      editor.status = () => {
        const model = ctx.model?.id ?? "no-model";
        const thinking = ctx.model?.reasoning ? ` (${ctx.thinkingLevel})` : "";
        const path = `${formatCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
        const usage = ctx.getContextUsage();
        const percent = usage?.percent === null ? "?" : (usage?.percent ?? 0).toFixed(1);
        const window = formatTokens(usage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
        const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
        return `${model}${thinking} ❯ ${path} ❯ ${percent}%/${window} (auto) ❯ $${usageCost(ctx).toFixed(3)}${subscription ? " (sub)" : ""}`;
      };
      return editor;
    });
  });
}
