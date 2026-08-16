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
import { safeDisplayLine } from "./text-safety.ts";
import { normalizeDisplayText, UI_MODE_STATUS_EVENT } from "./ui-core.ts";

const FALLBACK_SKILL = `# Ponytail\n\nUse the smallest correct solution: YAGNI, existing code, standard library, native platform features, installed dependencies, then minimum new code. Never remove validation, data-loss protection, security, or accessibility.`;
const SKILL_BODY = (() => {
  try {
    return readFileSync(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  } catch {
    return FALLBACK_SKILL;
  }
})();

const ICONS: Record<PonytailSessionMode, string> = {
  off: "",
  lite: "🌿",
  full: "⚡",
  ultra: "🔥",
  review: "🔎",
};

export default function ponytailExtension(pi: ExtensionAPI): void {
  let configuredDefault: PonytailMode = DEFAULT_PONYTAIL_MODE;
  let currentMode: PonytailSessionMode = configuredDefault;
  let active = false;
  let quietStartup = false;
  let hideStatus = true;

  const syncStatus = (_context?: ExtensionContext) => {
    if (hideStatus || currentMode === "off") {
      pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail" });
      return;
    }
    const indicator = active ? "●" : "○";
    const label = `${ICONS[currentMode]} ${currentMode.toUpperCase()}`;
    pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail", text: `${indicator} 🐴 ponytail: ${label}` });
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
    syncStatus(ctx);
  };

  const setMode = (mode: PonytailSessionMode, ctx?: ExtensionContext) => {
    currentMode = mode;
    pi.appendEntry("ponytail-mode", { mode });
    syncStatus(ctx);
    ctx?.ui.notify(normalizeDisplayText(`Ponytail mode set to ${mode}.`), "info");
  };

  const runSkill = (name: string, ctx: ExtensionContext) => {
    const message = `/skill:${name}`;
    if (!ctx.isIdle()) {
      pi.sendUserMessage(message, { deliverAs: "followUp", expandPromptTemplates: true });
      ctx.ui.notify(normalizeDisplayText(`${name} queued as a follow-up.`), "info");
      return;
    }
    pi.sendUserMessage(message, { expandPromptTemplates: true });
  };

  pi.registerCommand("ponytail", {
    description: "Set Ponytail mode (lite, full, ultra, off), show status, or save default <mode>",
    handler: async (args, ctx) => {
      const command = parsePonytailCommand(args, configuredDefault);
      if (command.type === "status") {
        ctx.ui.notify(normalizeDisplayText(`Ponytail: current ${currentMode} · default ${configuredDefault}`), "info");
        return;
      }
      if (command.type === "set-mode") {
        setMode(command.mode, ctx);
        return;
      }
      if (command.type === "set-default") {
        try {
          const saved = writePonytailDefaultMode(command.mode);
          configuredDefault = readPonytailDefaultMode();
          const message = configuredDefault === saved
            ? `Default Ponytail mode set to ${saved}.`
            : `Saved ${saved}; PONYTAIL_DEFAULT_MODE keeps the effective default at ${configuredDefault}.`;
          ctx.ui.notify(normalizeDisplayText(message), "info");
        } catch (error) {
          ctx.ui.notify(normalizeDisplayText(safeDisplayLine(`Could not save Ponytail default: ${error instanceof Error ? error.message : String(error)}`, 500)), "error");
        }
        return;
      }
      ctx.ui.notify(normalizeDisplayText("Usage: /ponytail [lite|full|ultra|off|status|default <mode>]"), "warning");
    },
  });

  for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-help"] as const) {
    pi.registerCommand(name, {
      description: `Run /skill:${name}`,
      handler: async (_args, ctx) => runSkill(name, ctx),
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const loaded = loadSettings(ctx);
    restoreMode(ctx);
    if (loaded && !quietStartup) ctx.ui.notify(normalizeDisplayText(`Ponytail loaded: ${currentMode}`), "info");
  });

  pi.on("session_tree", (_event, ctx) => restoreMode(ctx));

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && currentMode !== "off" && isPonytailDeactivationCommand(event.text)) {
      setMode("off", ctx);
      return { action: "handled" };
    }
  });

  pi.on("agent_start", (_event, ctx) => {
    active = true;
    syncStatus(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    active = false;
    syncStatus(ctx);
  });

  pi.on("tool_call", (event) => {
    if (currentMode === "off") return;
    const suffix = `\n\n--- Active parent coding policy ---\n${buildPonytailInstructions(SKILL_BODY, currentMode)}`;
    const append = (value: unknown): string | undefined => {
      if (typeof value !== "string" || value.length + suffix.length > 50_000) return undefined;
      return `${value}${suffix}`;
    };

    if (event.toolName !== "subagent") return;
    const input = event.input as { tasks?: unknown };
    if (!Array.isArray(input.tasks)) return;
    for (const task of input.tasks) {
      if (!task || typeof task !== "object") continue;
      const record = task as { task?: unknown };
      if (typeof record.task !== "string" || !record.task.trim()) continue;
      const next = append(record.task);
      if (next) record.task = next;
    }
  });

  pi.on("before_agent_start", (event) => {
    if (currentMode === "off") return;
    const instructions = buildPonytailInstructions(SKILL_BODY, currentMode);
    return { systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${instructions}` : instructions };
  });

  pi.on("session_shutdown", () => {
    pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail" });
  });
}
