import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  applyTodoAction,
  copyTodoSnapshot,
  emptyTodoSnapshot,
  TODO_LIMITS,
  TODO_STATUSES,
  validateTodoSnapshot,
  type TodoAction,
  type TodoSnapshot,
  type TodoTask,
} from "./todo-core.ts";
import { STATUS_WIDGET_DOCK_EVENT } from "./ui-core.ts";

const TOOL_NAME = "todo";
const WIDGET_NAME = "todos";
const WIDGET_TASK_LINES = 6;

interface TodoDetails {
  action: TodoAction["action"];
  snapshot: TodoSnapshot;
}

const Parameters = Type.Object({
  action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
  id: Type.Optional(Type.Integer({ minimum: 1, description: "Task id for update, get, or delete" })),
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: TODO_LIMITS.subject })),
  description: Type.Optional(Type.String({ maxLength: TODO_LIMITS.description })),
  activeForm: Type.Optional(Type.String({ maxLength: TODO_LIMITS.activeForm, description: "Short present-tense activity shown while in progress" })),
  status: Type.Optional(StringEnum(TODO_STATUSES)),
  blockedBy: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: TODO_LIMITS.blockers })),
});

function taskLine(task: TodoTask): string {
  const mark = task.status === "completed" ? "✓" : task.status === "in_progress" ? "●" : "○";
  const activity = task.status === "in_progress" && task.activeForm ? ` — ${task.activeForm}` : "";
  const blockers = task.blockedBy.length ? ` blocked by ${task.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  return `${mark} #${task.id} ${task.subject}${activity}${blockers}`;
}

export function formatTodoOutput(action: TodoAction["action"], snapshot: TodoSnapshot, task?: TodoTask, count?: number): string {
  if (action === "list") return snapshot.tasks.length ? snapshot.tasks.map(taskLine).join("\n") : "No todos.";
  if (action === "get" && task) {
    return [taskLine(task), task.description && `Description: ${task.description}`, task.activeForm && `Active form: ${task.activeForm}`]
      .filter(Boolean)
      .join("\n");
  }
  if (action === "create" && task) return `Created ${taskLine(task)}`;
  if (action === "update" && task) return `Updated ${taskLine(task)}`;
  if (action === "delete" && task) return `Deleted #${task.id} ${task.subject}`;
  return `Cleared ${count ?? 0} todo(s).`;
}

export function restoreTodoSnapshot(ctx: ExtensionContext): TodoSnapshot {
  let restored = emptyTodoSnapshot();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== TOOL_NAME) continue;
    const value = (entry.message.details as Partial<TodoDetails> | undefined)?.snapshot;
    try {
      restored = validateTodoSnapshot(value);
    } catch {
      // Ignore malformed or legacy tool results and retain the latest validated snapshot.
    }
  }
  return restored;
}

export default function todoExtension(pi: ExtensionAPI): void {
  let snapshot = emptyTodoSnapshot();
  let collapsed = false;
  let latestContext: ExtensionContext | undefined;

  const syncWidget = (ctx?: ExtensionContext) => {
    latestContext = ctx ?? latestContext;
    if (latestContext?.mode !== "tui") return;
    if (!snapshot.tasks.length) {
      latestContext.ui.setWidget(WIDGET_NAME, undefined);
      pi.events.emit(STATUS_WIDGET_DOCK_EVENT, undefined);
      return;
    }
    latestContext.ui.setWidget(WIDGET_NAME, (_tui, theme) => ({
      render(width: number) {
        const summary = `Todos · ${snapshot.tasks.filter((task) => task.status === "completed").length}/${snapshot.tasks.length} completed`;
        if (collapsed) return [truncateToWidth(theme.fg("muted", `${summary} (collapsed)`), width)];
        const shown = snapshot.tasks.slice(0, WIDGET_TASK_LINES);
        const lines = [theme.fg("accent", summary), ...shown.map((task) => taskLine(task))];
        if (snapshot.tasks.length > shown.length) lines.push(theme.fg("dim", `… ${snapshot.tasks.length - shown.length} more`));
        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate() {},
    }), { placement: "aboveEditor" });
    pi.events.emit(STATUS_WIDGET_DOCK_EVENT, undefined);
  };

  const restore = (ctx: ExtensionContext) => {
    snapshot = restoreTodoSnapshot(ctx);
    syncWidget(ctx);
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "Todo",
    description: "Manage the current branch's bounded todo list. Actions: create, update, list, get, delete, clear. At most 25 tasks and one in_progress task are allowed; dependencies must exist, be acyclic, and be completed before their dependants.",
    promptSnippet: "Manage a bounded, dependency-aware todo list for the current session branch",
    promptGuidelines: ["Use todo to track multi-step work when a durable task list would help; keep only one task in_progress and complete blockers first."],
    parameters: Parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const change = applyTodoAction(snapshot, params as TodoAction);
      snapshot = copyTodoSnapshot(change.snapshot);
      syncWidget();
      const task = change.task ?? change.deleted;
      return {
        content: [{ type: "text", text: formatTodoOutput(params.action, snapshot, task, change.cleared) }],
        details: { action: params.action, snapshot: copyTodoSnapshot(snapshot) } satisfies TodoDetails,
      };
    },
  });

  pi.registerCommand("todos", {
    description: "Show the todo widget for the current branch",
    handler: async (_args, ctx) => {
      const output = snapshot.tasks.length
        ? `Todos (${snapshot.tasks.length}):\n${formatTodoOutput("list", snapshot)}`
        : "No todos.";
      if (ctx.mode !== "tui") {
        ctx.ui.notify(output, "info");
        return;
      }
      collapsed = false;
      syncWidget(ctx);
      ctx.ui.notify(output, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "Collapse or expand the todo widget",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      collapsed = !collapsed;
      syncWidget(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_compact", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_NAME, undefined);
  });
}
