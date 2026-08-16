import type { Model } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
  UI_MODE_STATUS_EVENT,
  UI_PANEL_EVENT,
  UI_WIDGET_NAME,
  applyUiGutter,
  composeUiBlocks,
  formatCwd,
  utilityBarSegments,
  wrapUtilityBar,
  type UiModeStatusId,
  type UiModeStatusUpdate,
  type UiPanelId,
  type UiPanelRenderer,
  type UiPanelUpdate,
  type UtilityBarValues,
} from "./ui-core.ts";
import { safeDisplayLine } from "./text-safety.ts";

const PANEL_ORDER: readonly UiPanelId[] = ["todo", "subagents"];
const MODE_ORDER: readonly UiModeStatusId[] = ["goal", "ponytail"];

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
  const provider = ctx.modelRegistry.getProvider(model.provider);
  return ctx.modelRegistry.isUsingOAuth(model) && provider?.auth.oauth?.isSubscription === true;
}

export class UtilityEditor extends CustomEditor {
  private readonly renderUtilityLine: (width: number) => string[];

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    renderUtility: (width: number) => string[],
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.renderUtilityLine = renderUtility;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const editorWidth = Math.max(1, safeWidth - 1);
    const editorLines = super.render(editorWidth);
    const inputLines = applyUiGutter(editorLines.length > 0 ? editorLines.slice(1) : [], safeWidth);
    return [...this.renderUtilityLine(safeWidth), ...inputLines];
  }
}

function styleUtility(values: UtilityBarValues, theme: Theme, width: number): string[] {
  const { fields } = utilityBarSegments(values);
  const contextColor = values.contextPercent === undefined
    ? "muted"
    : values.contextPercent > 90 ? "error" : values.contextPercent > 70 ? "warning" : "success";
  const head = `${theme.bold(theme.fg("accent", "π"))} ${theme.fg("dim", `v${values.version}`)}`;
  return wrapUtilityBar(head, [
    theme.fg("accent", fields[0]),
    theme.fg("syntaxType", fields[1]),
    theme.fg(contextColor, fields[2]),
    theme.fg("syntaxNumber", fields[3]),
    theme.fg("customMessageLabel", fields[4]),
  ], width);
}

export default function uiExtension(pi: ExtensionAPI) {
  let currentModel: Model<any> | undefined;
  let currentThinking = "off";
  let responseStartedAt: number | undefined;
  let responseTimer: ReturnType<typeof setInterval> | undefined;
  let requestEditorRender: (() => void) | undefined;
  let requestPanelRender: (() => void) | undefined;
  let latestContext: ExtensionContext | undefined;
  let getGitBranch = (): string | null => null;
  let unsubscribeBranch = () => {};
  let cachedEntryCount = -1;
  let cachedCost = 0;
  const panels = new Map<UiPanelId, UiPanelRenderer>();
  const modes = new Map<UiModeStatusId, string>();

  const requestRender = () => {
    requestEditorRender?.();
    requestPanelRender?.();
  };
  const branchCost = (ctx: ExtensionContext): number => {
    const entries = ctx.sessionManager.getBranch();
    if (entries.length !== cachedEntryCount) {
      cachedEntryCount = entries.length;
      cachedCost = entries.reduce((total, entry) => total + usageCost(entry), 0);
    }
    return cachedCost;
  };
  const invalidateSessionCost = () => {
    cachedEntryCount = -1;
    requestRender();
  };
  const stopResponseTimer = () => {
    if (responseTimer) clearInterval(responseTimer);
    responseTimer = undefined;
    responseStartedAt = undefined;
    requestRender();
  };
  const utilityValues = (ctx: ExtensionContext): UtilityBarValues => {
    const usage = ctx.getContextUsage();
    const contextWindow = usage?.contextWindow ?? currentModel?.contextWindow ?? 0;
    return {
      version: VERSION,
      path: safeDisplayLine(formatCwd(ctx.cwd), 4_096) || "?",
      branch: safeDisplayLine(getGitBranch(), 500) || "detached",
      model: safeDisplayLine(currentModel?.id ?? "no-model", 500) || "no-model",
      thinking: safeDisplayLine(currentThinking, 40) || "off",
      contextPercent: usage?.percent ?? undefined,
      contextWindow,
      cost: branchCost(ctx),
      auth: isSubscription(ctx, currentModel) ? "sub" : "api",
      elapsedMs: responseStartedAt === undefined ? 0 : Date.now() - responseStartedAt,
    };
  };
  const syncCompositeWidget = () => {
    const ctx = latestContext;
    if (ctx?.mode !== "tui") return;
    const visible = panels.size > 0 || modes.size > 0;
    if (!visible) {
      requestPanelRender = undefined;
      ctx.ui.setWidget(UI_WIDGET_NAME, undefined);
      return;
    }
    ctx.ui.setWidget(UI_WIDGET_NAME, (tui, theme) => {
      requestPanelRender = () => tui.requestRender();
      return {
        invalidate() {},
        render(width: number): string[] {
          const logicalWidth = Math.max(1, Math.floor(width) - 1);
          const blocks = PANEL_ORDER.flatMap((id) => {
            const render = panels.get(id);
            return render ? [render(logicalWidth, theme)] : [];
          });
          const modeText = MODE_ORDER.flatMap((id) => {
            const text = safeDisplayLine(modes.get(id), 200);
            return text ? [text] : [];
          }).join(" · ");
          if (modeText) blocks.push([theme.fg("customMessageLabel", modeText)]);
          return composeUiBlocks(blocks, width, true);
        },
      };
    }, { placement: "aboveEditor" });
  };

  pi.events.on(UI_PANEL_EVENT, (data) => {
    const update = data as UiPanelUpdate;
    if (!PANEL_ORDER.includes(update?.id)) return;
    if (update.render !== undefined && typeof update.render !== "function") return;
    if (update.render) panels.set(update.id, update.render);
    else panels.delete(update.id);
    syncCompositeWidget();
  });
  pi.events.on(UI_MODE_STATUS_EVENT, (data) => {
    const update = data as UiModeStatusUpdate;
    if (!MODE_ORDER.includes(update?.id)) return;
    const text = safeDisplayLine(update.text, 200);
    if (text) modes.set(update.id, text);
    else modes.delete(update.id);
    syncCompositeWidget();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    latestContext = ctx;
    currentModel = ctx.model;
    currentThinking = ctx.thinkingLevel ?? "off";
    cachedEntryCount = -1;
    cachedCost = 0;

    ctx.ui.setFooter((_tui, _theme, footerData) => {
      getGitBranch = () => footerData.getGitBranch();
      unsubscribeBranch();
      unsubscribeBranch = footerData.onBranchChange(requestRender);
      return { invalidate() {}, render: () => [] };
    });
    ctx.ui.setHeader(() => ({ invalidate() {}, render: () => [] }));
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      requestEditorRender = () => tui.requestRender();
      return new UtilityEditor(
        tui,
        editorTheme,
        keybindings,
        (width) => styleUtility(utilityValues(ctx), ctx.ui.theme, width),
      );
    });
    syncCompositeWidget();
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    responseStartedAt = Date.now();
    if (!responseTimer) {
      responseTimer = setInterval(requestRender, 1_000);
      responseTimer.unref?.();
    }
    requestRender();
  });

  pi.on("agent_settled", stopResponseTimer);
  pi.on("model_select", (event) => {
    currentModel = event.model;
    requestRender();
  });
  pi.on("thinking_level_select", (event) => {
    currentThinking = event.level;
    requestRender();
  });
  pi.on("session_info_changed", requestRender);
  pi.on("message_end", invalidateSessionCost);
  pi.on("session_tree", invalidateSessionCost);
  pi.on("session_compact", invalidateSessionCost);

  pi.on("session_shutdown", () => {
    if (responseTimer) clearInterval(responseTimer);
    responseTimer = undefined;
    responseStartedAt = undefined;
    unsubscribeBranch();
    unsubscribeBranch = () => {};
    latestContext?.ui.setWidget(UI_WIDGET_NAME, undefined);
    latestContext?.ui.setEditorComponent(undefined);
    latestContext = undefined;
    requestEditorRender = undefined;
    requestPanelRender = undefined;
    getGitBranch = () => null;
    panels.clear();
    modes.clear();
    cachedEntryCount = -1;
    cachedCost = 0;
  });
}
