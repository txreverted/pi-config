import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildPonytailInstructions,
  DEFAULT_PONYTAIL_MODE,
  isPonytailDeactivationCommand,
  loadPonytailSettings,
  parsePonytailCommand,
  readPonytailDefaultMode,
  resolvePonytailSessionMode,
  writePonytailDefaultMode,
  type PonytailMode,
  type PonytailSessionMode,
} from "./ponytail-core.ts";
import { normalizeDisplayText, safeDisplayLine } from "./text-safety.ts";

const STATUS_NAME = "pi-config-ponytail";
const FALLBACK_SKILL = `# Ponytail\n\nUse the smallest correct solution: YAGNI, existing code, standard library, native platform features, installed dependencies, then minimum new code. Never remove validation, data-loss protection, security, or accessibility.`;
const SKILL_BODY = (() => {
  try {
    return readFileSync(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  } catch {
    return FALLBACK_SKILL;
  }
})();

export default function ponytailExtension(pi: ExtensionAPI): void {
  let configuredDefault: PonytailMode = DEFAULT_PONYTAIL_MODE;
  let currentMode: PonytailSessionMode = configuredDefault;
  let active = false;
  let quietStartup = false;
  let hideStatus = true;
  let context: ExtensionContext | undefined;

  const syncStatus = () => {
    const state = active ? "active" : "idle";
    context?.ui.setStatus(
      STATUS_NAME,
      hideStatus || currentMode === "off" ? undefined : `ponytail: ${currentMode} (${state})`,
    );
  };

  const loadSettings = (ctx: ExtensionContext): boolean => {
    const settings = loadPonytailSettings();
    configuredDefault = settings.defaultMode;
    quietStartup = settings.quietStartup;
    hideStatus = settings.hideStatus;
    if (settings.errors.length > 0) {
      ctx.ui.notify(normalizeDisplayText(safeDisplayLine(`Could not load some Ponytail settings; using defaults: ${settings.errors.join("; ")}`, 500)), "error");
    }
    return settings.errors.length === 0;
  };

  const restoreMode = (ctx: ExtensionContext) => {
    currentMode = resolvePonytailSessionMode(ctx.sessionManager.getBranch(), configuredDefault);
    active = false;
    syncStatus();
  };

  const setMode = (mode: PonytailSessionMode, ctx?: ExtensionContext) => {
    currentMode = mode;
    pi.appendEntry("ponytail-mode", { mode });
    syncStatus();
    ctx?.ui.notify(normalizeDisplayText(`Ponytail mode set to ${mode}.`), "info");
  };

  pi.registerCommand("ponytail", {
    description: "Set Ponytail mode (lite, full, ultra, off), show status, or save default <mode>",
    handler: async (args, ctx) => {
      const command = parsePonytailCommand(args, configuredDefault);
      if (command.type === "status") {
        ctx.ui.notify(normalizeDisplayText(`Ponytail: current ${currentMode}, default ${configuredDefault}`), "info");
        return;
      }
      if (command.type === "set-mode") {
        setMode(command.mode, ctx);
        return;
      }
      if (command.type === "set-default") {
        let saved: PonytailMode | undefined;
        try {
          saved = writePonytailDefaultMode(command.mode);
        } catch (error) {
          ctx.ui.notify(normalizeDisplayText(safeDisplayLine(`Could not save Ponytail default: ${error instanceof Error ? error.message : String(error)}`, 500)), "error");
          return;
        }
        try {
          configuredDefault = readPonytailDefaultMode();
          const message = configuredDefault === saved
            ? `Default Ponytail mode set to ${saved}.`
            : `Saved ${saved}; PONYTAIL_DEFAULT_MODE keeps the effective default at ${configuredDefault}.`;
          ctx.ui.notify(normalizeDisplayText(message), "info");
        } catch (error) {
          ctx.ui.notify(normalizeDisplayText(safeDisplayLine(`Default Ponytail mode saved as ${saved}, but the effective default is invalid: ${error instanceof Error ? error.message : String(error)}`, 500)), "warning");
        }
        return;
      }
      ctx.ui.notify(normalizeDisplayText("Usage: /ponytail [lite|full|ultra|off|status|default <mode>]"), "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    const loaded = loadSettings(ctx);
    restoreMode(ctx);
    if (loaded && !quietStartup) ctx.ui.notify(normalizeDisplayText(`Ponytail loaded: ${currentMode}`), "info");
  });

  pi.on("session_tree", (_event, ctx) => {
    context = ctx;
    restoreMode(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && currentMode !== "off" && isPonytailDeactivationCommand(event.text)) {
      setMode("off", ctx);
      return { action: "handled" };
    }
  });

  pi.on("agent_start", () => {
    active = true;
    syncStatus();
  });

  pi.on("agent_settled", () => {
    active = false;
    syncStatus();
  });

  pi.on("before_agent_start", (event) => {
    if (currentMode === "off") return;
    const instructions = buildPonytailInstructions(SKILL_BODY, currentMode);
    return { systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${instructions}` : instructions };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_NAME, undefined);
    context = undefined;
  });
}
