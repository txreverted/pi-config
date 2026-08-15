import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildPonytailInstructions,
  isPonytailDeactivationCommand,
  parsePonytailCommand,
  readPonytailDefaultMode,
  readPonytailHideStatus,
  readPonytailQuietStartup,
  resolvePonytailSessionMode,
  writePonytailDefaultMode,
  type PonytailMode,
  type PonytailSessionMode,
} from "./ponytail-core.ts";

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
  let configuredDefault: PonytailMode = readPonytailDefaultMode();
  let currentMode: PonytailSessionMode = configuredDefault;
  let active = false;
  let hideStatus = readPonytailHideStatus();
  let latestContext: ExtensionContext | undefined;

  const syncStatus = (context?: ExtensionContext) => {
    latestContext = context ?? latestContext;
    const ctx = latestContext;
    if (!ctx?.ui?.setStatus) return;
    if (hideStatus || currentMode === "off") {
      ctx.ui.setStatus("ponytail", undefined);
      return;
    }
    try {
      const indicator = ctx.ui.theme.fg(active ? "accent" : "dim", active ? "●" : "○");
      const label = `${ICONS[currentMode]} ${currentMode.toUpperCase()}`;
      ctx.ui.setStatus("ponytail", `${indicator} 🐴 ${ctx.ui.theme.fg("muted", "ponytail: ")}${ctx.ui.theme.fg("text", label)}`);
    } catch {
      // Some non-TUI adapters expose status methods before their theme is ready.
    }
  };

  const setMode = (mode: PonytailSessionMode, ctx?: ExtensionContext) => {
    currentMode = mode;
    pi.appendEntry("ponytail-mode", { mode });
    syncStatus(ctx);
    ctx?.ui.notify(`Ponytail mode set to ${mode}.`, "info");
  };

  const runSkill = (name: string, ctx: ExtensionContext) => {
    const message = `/skill:${name}`;
    if (!ctx.isIdle()) {
      pi.sendUserMessage(message, { deliverAs: "followUp", expandPromptTemplates: true });
      ctx.ui.notify(`${name} queued as a follow-up.`, "info");
      return;
    }
    pi.sendUserMessage(message, { expandPromptTemplates: true });
  };

  pi.registerCommand("ponytail", {
    description: "Set Ponytail mode (lite, full, ultra, off), show status, or save default <mode>",
    handler: async (args, ctx) => {
      const command = parsePonytailCommand(args, configuredDefault);
      if (command.type === "status") {
        ctx.ui.notify(`Ponytail: current ${currentMode} · default ${configuredDefault}`, "info");
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
          ctx.ui.notify(message, "info");
        } catch (error) {
          ctx.ui.notify(`Could not save Ponytail default: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }
      ctx.ui.notify("Usage: /ponytail [lite|full|ultra|off|status|default <mode>]", "warning");
    },
  });

  for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help"] as const) {
    pi.registerCommand(name, {
      description: `Run /skill:${name}`,
      handler: async (_args, ctx) => runSkill(name, ctx),
    });
  }

  pi.on("session_start", (_event, ctx) => {
    configuredDefault = readPonytailDefaultMode();
    hideStatus = readPonytailHideStatus();
    const entries = ctx.sessionManager.getBranch();
    currentMode = resolvePonytailSessionMode(entries, configuredDefault);
    active = false;
    syncStatus(ctx);
    if (!readPonytailQuietStartup()) ctx.ui.notify(`Ponytail loaded: ${currentMode}`, "info");
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && currentMode !== "off" && isPonytailDeactivationCommand(event.text)) {
      setMode("off", ctx);
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

    if (event.toolName === "subagent") {
      const input = event.input as { tasks?: unknown };
      if (!Array.isArray(input.tasks)) return;
      for (const task of input.tasks) {
        if (!task || typeof task !== "object") continue;
        const record = task as { task?: unknown };
        const next = append(record.task);
        if (next) record.task = next;
      }
    } else if (event.toolName === "workflow") {
      const input = event.input as { objective?: unknown };
      const next = append(input.objective);
      if (next) input.objective = next;
    }
  });

  pi.on("before_agent_start", (event) => {
    if (currentMode === "off") return;
    const instructions = buildPonytailInstructions(SKILL_BODY, currentMode);
    return { systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${instructions}` : instructions };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("ponytail", undefined);
  });
}
