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
import { normalizeDisplayText } from "./text-safety.ts";

const TOOL_NAME = "todo";
const WIDGET_NAME = "pi-config-todo";
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
}, { additionalProperties: false });

function taskLine(task: TodoTask): string {
  const mark = task.status === "completed" ? "☒" : task.status === "in_progress" ? "■" : "□";
  const activity = task.status === "in_progress" && task.activeForm ? ` · ${task.activeForm}` : "";
  const blockers = task.blockedBy.length ? ` depends on ${task.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  return `${mark} #${task.id} ${task.subject}${activity}${blockers}`;
}

export function formatTodoOutput(action: TodoAction["action"], snapshot: TodoSnapshot, task?: TodoTask, count?: number): string {
  if (action === "list") return snapshot.tasks.length ? snapshot.tasks.map((task) => taskLine(task)).join("\n") : "No todos.";
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
  let snapshot = emptyTodoSnapshot();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; message?: unknown };
    if (candidate.type !== "message" || !candidate.message || typeof candidate.message !== "object") continue;
    const message = candidate.message as Record<string, unknown>;
    if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
    const details = message.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) continue;
    try {
      snapshot = validateTodoSnapshot((details as Record<string, unknown>).snapshot);
    } catch {
      // Keep the latest validated branch snapshot.
    }
  }
  return snapshot;
}

export default function todoExtension(pi: ExtensionAPI): void {
  let snapshot = emptyTodoSnapshot();
  let latestContext: ExtensionContext | undefined;

  const syncWidget = (ctx?: ExtensionContext) => {
    latestContext = ctx ?? latestContext;
    if (latestContext?.mode !== "tui") return;
    const completed = new Set(snapshot.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    const unfinished = snapshot.tasks
      .filter((task) => task.status !== "completed")
      .sort((left, right) => {
        const rank = (task: TodoTask) => task.status === "in_progress"
          ? 0
          : task.blockedBy.every((id) => completed.has(id)) ? 1 : 2;
        return rank(left) - rank(right) || left.id - right.id;
      });
    if (!unfinished.length) {
      latestContext.ui.setWidget(WIDGET_NAME, undefined);
      return;
    }
    latestContext.ui.setWidget(WIDGET_NAME, (tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const safeWidth = Math.max(1, Math.floor(width));
        const contentWidth = Math.max(0, safeWidth - 1);
        const row = (text: string) => ` ${truncateToWidth(text, contentWidth, "")}`;
        const summary = `Todos: ${snapshot.tasks.length - unfinished.length}/${snapshot.tasks.length} completed`;
        const bodyRows = Math.max(0, Math.max(1, (tui.terminal?.rows ?? 30) - 8) - 1);
        let shownCount = Math.min(WIDGET_TASK_LINES, bodyRows, unfinished.length);
        if (unfinished.length > shownCount && shownCount === bodyRows) shownCount = Math.max(0, shownCount - 1);
        const shown = unfinished.slice(0, shownCount);
        const hiddenCount = unfinished.length - shown.length;
        const lines = [
          theme.fg("accent", theme.bold(summary)),
          ...shown.map((task, index) => {
            const connector = index === shown.length - 1 && hiddenCount === 0 ? "└─" : "├─";
            return ` ${connector} ${taskLine(task)}`;
          }),
        ];
        if (hiddenCount > 0 && bodyRows > shown.length) {
          lines.push(theme.fg("dim", ` └─ ${hiddenCount} more`));
        }
        return lines.map(row);
      },
    }), { placement: "aboveEditor" });
  };

  const restore = (ctx: ExtensionContext) => {
    snapshot = restoreTodoSnapshot(ctx);
    syncWidget(ctx);
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "Todo",
    description: "Manage the current branch's bounded todo list. Actions: create, update, list, get, delete, clear. At most 25 tasks and one in_progress task are allowed. Dependencies must exist, be acyclic, and be completed first.",
    promptSnippet: "Manage a bounded, dependency-aware todo list for the current session branch",
    promptGuidelines: ["Use todo to track multi-step work when a durable task list would help; keep one task in_progress and complete dependencies first."],
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
      syncWidget(ctx);
      ctx.ui.notify(normalizeDisplayText(output), "info");
    },
  });

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_compact", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_NAME, undefined);
  });
}
