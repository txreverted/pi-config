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
import { CONFIG_EVENTS } from "./coordination-core.ts";

const FALLBACK_SKILL = `# Ponytail\n\nUse the smallest correct solution: YAGNI, existing code, standard library, native platform features, installed dependencies, then minimum new code. Never remove validation, data-loss protection, security, or accessibility.`;

export function loadPonytailSkill(path = new URL("../skills/ponytail/SKILL.md", import.meta.url)): { body: string; error?: string } {
  try {
    return { body: readFileSync(path, "utf8") };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { body: FALLBACK_SKILL, error: `Could not load Ponytail skill; using fallback: ${detail}` };
  }
}

const skill = loadPonytailSkill();

export default function ponytailExtension(pi: ExtensionAPI): void {
  let configuredDefault: PonytailMode = DEFAULT_PONYTAIL_MODE;
  let currentMode: PonytailSessionMode = configuredDefault;

  const loadSettings = (ctx: ExtensionContext) => {
    const settings = loadPonytailSettings();
    configuredDefault = settings.defaultMode;
    if (settings.errors.length > 0) {
      ctx.ui.notify(normalizeDisplayText(safeDisplayLine(`Could not load some Ponytail settings; using defaults: ${settings.errors.join("; ")}`, 500)), "error");
    }
  };

  const restoreMode = (ctx: ExtensionContext) => {
    currentMode = resolvePonytailSessionMode(ctx.sessionManager.getBranch(), configuredDefault);
    pi.events.emit(CONFIG_EVENTS.ponytailMode, currentMode);
  };

  const setMode = (mode: PonytailSessionMode, ctx?: ExtensionContext) => {
    currentMode = mode;
    pi.appendEntry("ponytail-mode", { mode });
    pi.events.emit(CONFIG_EVENTS.ponytailMode, currentMode);
    ctx?.ui.notify(normalizeDisplayText(`Ponytail mode set to ${mode}.`), "info");
  };

  pi.registerCommand("ponytail", {
    description: "Set Ponytail mode (lite, full, ultra, off), show status, or save default <mode>",
    getArgumentCompletions: (prefix) => {
      const values = ["lite", "full", "ultra", "off", "status", "default lite", "default full", "default ultra", "default off"];
      const matches = values.filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
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
    if (skill.error) ctx.ui.notify(normalizeDisplayText(safeDisplayLine(skill.error, 500)), "error");
    loadSettings(ctx);
    restoreMode(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && currentMode !== "off" && isPonytailDeactivationCommand(event.text)) {
      setMode("off", ctx);
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", (event) => {
    if (currentMode === "off") return;
    const instructions = buildPonytailInstructions(skill.body, currentMode);
    return { systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${instructions}` : instructions };
  });
}
