import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
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
import { normalizeDisplayText, UI_PANEL_EVENT, type UiPanelRenderer } from "./ui-core.ts";

const TOOL_NAME = "todo";
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
  const mark = task.status === "completed" ? "☒" : task.status === "in_progress" ? "■" : "□";
  const activity = task.status === "in_progress" && task.activeForm ? ` — ${task.activeForm}` : "";
  const blockers = task.blockedBy.length ? ` depends on ${task.blockedBy.map((id) => `#${id}`).join(",")}` : "";
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

function migrateLegacyBlockedActiveSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const input = value as { tasks?: unknown };
  if (!Array.isArray(input.tasks)) return value;
  const active = input.tasks.filter((task) => task && typeof task === "object" && (task as { status?: unknown }).status === "in_progress");
  if (active.length !== 1) return value;
  const task = active[0] as { id?: unknown; status: "in_progress"; blockedBy?: unknown };
  if (!Array.isArray(task.blockedBy)) return value;
  const completed = new Set(input.tasks.flatMap((candidate) =>
    candidate && typeof candidate === "object" && (candidate as { status?: unknown }).status === "completed"
      ? [(candidate as { id?: unknown }).id]
      : [],
  ));
  if (task.blockedBy.every((id) => completed.has(id))) return value;
  return { ...value, tasks: input.tasks.map((candidate) => candidate === task ? { ...task, status: "pending" } : candidate) };
}

export function restoreTodoSnapshot(ctx: ExtensionContext): TodoSnapshot {
  let restored = emptyTodoSnapshot();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== TOOL_NAME) continue;
    const value = (entry.message.details as Partial<TodoDetails> | undefined)?.snapshot;
    try {
      restored = validateTodoSnapshot(value);
    } catch {
      try {
        restored = validateTodoSnapshot(migrateLegacyBlockedActiveSnapshot(value));
      } catch {
        // Ignore malformed tool results and retain the latest validated snapshot.
      }
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
    const unfinished = snapshot.tasks.filter((task) => task.status !== "completed");
    if (!unfinished.length) {
      pi.events.emit(UI_PANEL_EVENT, { id: "todo" });
      return;
    }
    const render: UiPanelRenderer = (width, theme) => {
      const summary = `Todos · ${snapshot.tasks.length - unfinished.length}/${snapshot.tasks.length} completed`;
      if (collapsed) return [truncateToWidth(theme.fg("muted", `${summary} (collapsed)`), width)];
      const shown = unfinished.slice(0, WIDGET_TASK_LINES);
      const lines = [
        theme.fg("accent", summary),
        ...shown.map((task, index) => `${index === 0 ? " └─ " : "    "}${taskLine(task)}`),
      ];
      if (unfinished.length > shown.length) lines.push(theme.fg("dim", `    … ${unfinished.length - shown.length} more`));
      return lines.map((line) => truncateToWidth(line, width));
    };
    pi.events.emit(UI_PANEL_EVENT, { id: "todo", render });
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
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Show the todo widget for the current branch",
    handler: async (_args, ctx) => {
      const output = snapshot.tasks.length
        ? `Todos (${snapshot.tasks.length}):\n${formatTodoOutput("list", snapshot)}`
        : "No todos.";
      if (ctx.mode !== "tui") {
        ctx.ui.notify(normalizeDisplayText(output), "info");
        return;
      }
      collapsed = false;
      syncWidget(ctx);
      ctx.ui.notify(normalizeDisplayText(output), "info");
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
    if (ctx.mode === "tui") pi.events.emit(UI_PANEL_EVENT, { id: "todo" });
  });
}
