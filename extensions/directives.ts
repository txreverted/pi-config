import { randomUUID } from "node:crypto";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  DIRECTIVE_ENTRY_TYPE,
  applyDirectiveOperation,
  buildDirectiveReminder,
  makeDeliverOperation,
  makeEnqueueOperation,
  makeRecoverOperation,
  makeRetireOperation,
  messageText,
  missingDeliveredDirectives,
  observeDirectiveDelivery,
  replayDirectiveEvents,
  type ActiveDirective,
  type DirectiveOperation,
  type DirectiveReplayEvent,
} from "./directives-core.ts";

function replayEvents(entries: readonly SessionEntry[]): DirectiveReplayEvent[] {
  const events: DirectiveReplayEvent[] = [];
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === DIRECTIVE_ENTRY_TYPE) {
      events.push({ type: "operation", value: entry.data });
      continue;
    }
    if (entry.type === "message" && entry.message.role === "user") {
      const text = messageText(entry.message);
      if (text.trim()) events.push({ type: "user", text });
    }
  }
  return events;
}

function formatDirective(directive: ActiveDirective): string {
  const text = (directive.deliveredText ?? directive.text).replace(/\s+/g, " ").trim();
  const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  return `${directive.mode} · ${directive.phase} · ${preview}`;
}

export default function directivesExtension(pi: ExtensionAPI) {
  let active = new Map<string, ActiveDirective>();

  const persist = (operation: DirectiveOperation) => {
    applyDirectiveOperation(active, operation);
    pi.appendEntry(DIRECTIVE_ENTRY_TYPE, operation);
  };

  pi.on("session_start", (_event, ctx) => {
    active = replayDirectiveEvents(replayEvents(ctx.sessionManager.getBranch()));
    const stranded = [...active.values()].filter((directive) => directive.phase === "queued");
    if (stranded.length > 0 && !ctx.hasPendingMessages()) {
      for (const directive of stranded) persist(makeRecoverOperation(directive.id));
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Recovered ${stranded.length} queued directive${stranded.length === 1 ? "" : "s"}; they will be reinforced on the next model turn.`,
          "info",
        );
      }
    }
  });

  pi.on("input", (event) => {
    if (event.streamingBehavior !== "steer" && event.streamingBehavior !== "followUp") return;
    if (!event.text.trim()) return;
    const directive: ActiveDirective = {
      id: randomUUID(),
      mode: event.streamingBehavior,
      phase: "queued",
      text: event.text,
      createdAt: Date.now(),
    };
    persist(makeEnqueueOperation(directive));
  });

  pi.on("message_start", (event) => {
    if (event.message.role !== "user") return;
    const text = messageText(event.message);
    if (!text.trim()) return;
    const delivered = observeDirectiveDelivery(active, text);
    if (!delivered) return;
    pi.appendEntry(DIRECTIVE_ENTRY_TYPE, makeDeliverOperation(delivered.id, text));
  });

  pi.on("context", (event) => {
    const missing = missingDeliveredDirectives(active, event.messages);
    if (missing.length === 0) return;
    const reminder = buildDirectiveReminder(missing);
    return {
      messages: [
        ...event.messages,
        {
          role: "custom",
          customType: "pi-config-active-directives",
          content: reminder,
          display: false,
          details: { directiveIds: missing.map((directive) => directive.id) },
          timestamp: Date.now(),
        },
      ],
    };
  });

  pi.on("agent_settled", () => {
    const ids = [...active.keys()];
    if (ids.length === 0) return;
    persist(makeRetireOperation(ids));
  });

  pi.registerCommand("directives", {
    description: "Show compaction-safe steering and follow-up directives",
    handler: async (_args, ctx) => {
      const directives = [...active.values()];
      if (directives.length === 0) {
        ctx.ui.notify("No active steering/follow-up directives.", "info");
        return;
      }
      ctx.ui.notify(
        [`Active directives (${directives.length}):`, ...directives.map((directive, index) => `${index + 1}. ${formatDirective(directive)}`)].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand("directives-clear", {
    description: "Stop reinforcing active directives (does not clear Pi's native pending queue)",
    handler: async (_args, ctx) => {
      const ids = [...active.keys()];
      if (ids.length === 0) {
        ctx.ui.notify("No active directives to clear.", "info");
        return;
      }
      persist(makeRetireOperation(ids));
      ctx.ui.notify(
        `Stopped reinforcing ${ids.length} directive${ids.length === 1 ? "" : "s"}. Pi's native undelivered queue is unchanged.`,
        "info",
      );
    },
  });
}
