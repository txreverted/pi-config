import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  UI_MODE_STATUS_EVENT,
  UI_PANEL_EVENT,
  UI_WIDGET_NAME,
  budgetUiBlocks,
  composeUiBlocks,
  type UiModeStatusId,
  type UiModeStatusUpdate,
  type UiPanelId,
  type UiPanelRenderer,
  type UiPanelUpdate,
} from "./ui-core.ts";
import { safeDisplayLine } from "./text-safety.ts";

const PANEL_ORDER: readonly UiPanelId[] = ["todo"];
const MODE_ORDER: readonly UiModeStatusId[] = ["goal", "ponytail"];

export default function uiExtension(pi: ExtensionAPI): void {
  const panels = new Map<UiPanelId, UiPanelRenderer>();
  const modes = new Map<UiModeStatusId, string>();
  let context: ExtensionContext | undefined;

  const sync = () => {
    if (context?.mode !== "tui") return;
    if (panels.size === 0 && modes.size === 0) {
      context.ui.setWidget(UI_WIDGET_NAME, undefined);
      return;
    }
    context.ui.setWidget(UI_WIDGET_NAME, (tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const contentWidth = Math.max(1, Math.floor(width) - 1);
        const blocks = PANEL_ORDER.flatMap((id) => {
          const render = panels.get(id);
          return render ? [render(contentWidth, theme)] : [];
        });
        const status = MODE_ORDER.flatMap((id) => {
          const text = safeDisplayLine(modes.get(id), 200);
          return text ? [text] : [];
        }).join(" | ");
        if (status) blocks.push([theme.fg("customMessageLabel", status)]);
        return composeUiBlocks(budgetUiBlocks(blocks, Math.max(1, (tui.terminal?.rows ?? 30) - 8), true), width, true);
      },
    }), { placement: "aboveEditor" });
  };

  pi.events.on(UI_PANEL_EVENT, (data) => {
    const update = data as UiPanelUpdate;
    if (!PANEL_ORDER.includes(update?.id) || (update.render !== undefined && typeof update.render !== "function")) return;
    if (update.render) panels.set(update.id, update.render);
    else panels.delete(update.id);
    sync();
  });

  pi.events.on(UI_MODE_STATUS_EVENT, (data) => {
    const update = data as UiModeStatusUpdate;
    if (!MODE_ORDER.includes(update?.id)) return;
    const text = safeDisplayLine(update.text, 200);
    if (text) modes.set(update.id, text);
    else modes.delete(update.id);
    sync();
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    sync();
  });
  pi.on("session_shutdown", () => {
    context?.ui.setWidget(UI_WIDGET_NAME, undefined);
    context = undefined;
    panels.clear();
    modes.clear();
  });
}
