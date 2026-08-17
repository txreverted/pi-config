import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead,
  type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  applyTaskAction, copyTaskSnapshot, emptyTaskSnapshot, TASK_CHANGED_EVENT, TASK_LIMITS, TASK_STATUSES,
  type SharedTask, type TaskAction, type TaskCaller, type TaskChange,
} from "./task-core.ts";
import { taskStoreForContext } from "./task-store.ts";
import { brokerRequest } from "./subagents-supervisor.ts";
import { normalizeDisplayText, UI_PANEL_EVENT, type UiPanelRenderer } from "./ui-core.ts";

const ACTIONS = ["create", "update", "list", "get", "claim", "release", "delete", "clear"] as const;
const Parameters = Type.Object({
  action: StringEnum(ACTIONS),
  id: Type.Optional(Type.Integer({ minimum: 1, description: "Task id; omit for claim-next" })),
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_LIMITS.subject })),
  description: Type.Optional(Type.String({ maxLength: TASK_LIMITS.description })),
  activeForm: Type.Optional(Type.String({ maxLength: TASK_LIMITS.activeForm })),
  status: Type.Optional(StringEnum(TASK_STATUSES)),
  owner: Type.Optional(Type.String({ maxLength: TASK_LIMITS.owner, description: "Use an empty string to clear the assignment" })),
  blockedBy: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: TASK_LIMITS.blockers })),
  metadata: Type.Optional(Type.Unknown({ description: `Bounded JSON object (at most ${TASK_LIMITS.metadataBytes} encoded bytes)` })),
}, { additionalProperties: false });

function callerIdentity(): TaskCaller {
  if (process.env.PI_CONFIG_SUBAGENT_CHILD !== "1") return Object.freeze({ id: "main", main: true });
  const id = process.env.PI_CONFIG_TASK_OWNER;
  if (!id || id.length > TASK_LIMITS.owner || !/^\S(?:.*\S)?$/.test(id)) return Object.freeze({ id: "", main: false });
  return Object.freeze({ id, main: false });
}

function line(task: SharedTask): string {
  const mark = task.status === "completed" ? "☒" : task.status === "in_progress" ? "■" : "□";
  const owner = task.owner ? ` @${task.owner}` : "";
  const activity = task.status === "in_progress" && task.activeForm ? ` — ${task.activeForm}` : "";
  const dependencies = task.blockedBy.length ? ` depends on ${task.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  return `${mark} #${task.id} ${task.subject}${owner}${activity}${dependencies}`;
}

export function formatTaskOutput(action: TaskAction["action"], change: TaskChange): string {
  if (action === "list") {
    if (!change.snapshot.tasks.length) return "No shared tasks.";
    const output = change.snapshot.tasks.map(line).join("\n");
    const notice = "\n[Task list truncated; use get with a task id for full details.]";
    const bounded = truncateHead(output, {
      maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice),
      maxLines: DEFAULT_MAX_LINES - 1,
    });
    return bounded.truncated ? `${bounded.content}${notice}` : output;
  }
  if (action === "get" && change.task) {
    return [line(change.task), change.task.description && `Description: ${change.task.description}`, `Version: ${change.task.version}`].filter(Boolean).join("\n");
  }
  if (action === "create" && change.task) return `Created ${line(change.task)}`;
  if (action === "claim" && change.task) return `Claimed ${line(change.task)}`;
  if (action === "release" && change.task) return `Released #${change.task.id} ${change.task.subject}`;
  if (action === "update" && change.task) return `Updated ${line(change.task)}`;
  if (action === "delete" && change.deleted) return `Deleted #${change.deleted.id} ${change.deleted.subject}`;
  return `Cleared ${change.cleared ?? 0} shared task(s).`;
}

export default function taskExtension(pi: ExtensionAPI): void {
  const caller = callerIdentity();
  let snapshot = emptyTaskSnapshot();
  let latestContext: ExtensionContext | undefined;

  const syncPanel = (ctx?: ExtensionContext) => {
    latestContext = ctx ?? latestContext;
    if (latestContext?.mode !== "tui") return;
    const unfinished = snapshot.tasks.filter((task) => task.status !== "completed");
    if (!unfinished.length) {
      pi.events.emit(UI_PANEL_EVENT, { id: "task" });
      return;
    }
    const render: UiPanelRenderer = (width, theme) => {
      const shown = unfinished.slice(0, 6);
      const lines = [
        theme.fg("accent", `Tasks · ${snapshot.tasks.length - unfinished.length}/${snapshot.tasks.length} completed`),
        ...shown.map((task, index) => `${index === 0 ? " └─ " : "    "}${line(task)}`),
      ];
      if (unfinished.length > shown.length) lines.push(theme.fg("dim", `    … ${unfinished.length - shown.length} more`));
      return lines.map((value) => truncateToWidth(value, width));
    };
    pi.events.emit(UI_PANEL_EVENT, { id: "task", render });
  };

  const load = async (ctx: ExtensionContext) => {
    snapshot = await taskStoreForContext(ctx).read();
    syncPanel(ctx);
  };

  pi.registerTool({
    name: "task",
    label: "Task",
    description: "Manage a persistent collaborative task DAG. Actions: create, update, list, get, claim, release, delete, clear. Claims are atomic, select only unblocked pending work, and each owner may have one active task.",
    promptSnippet: "Manage and atomically claim persistent shared tasks across collaborating agents",
    promptGuidelines: ["Use task for work shared between main and subagents; claim work before starting it and release or complete owned work when done."],
    parameters: Parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as TaskAction;
      if (!caller.main && !caller.id && input.action !== "list" && input.action !== "get") {
        throw new Error("Shared task mutation requires an immutable agent identity");
      }
      const store = taskStoreForContext(ctx);
      let change: TaskChange;
      if (input.action === "list" || input.action === "get") {
        snapshot = await store.read();
        change = applyTaskAction(snapshot, input, caller);
      } else {
        change = await store.transact((current) => {
          const result = applyTaskAction(current, input, caller);
          return { snapshot: result.snapshot, result };
        });
        snapshot = copyTaskSnapshot(change.snapshot);
      }
      syncPanel(ctx);
      if (!caller.main && input.action !== "list" && input.action !== "get" && process.env.PI_CONFIG_BROKER_SOCKET) {
        await brokerRequest({ action: "tasks_changed" }).catch(() => undefined);
      }
      const affected = change.task ?? change.deleted;
      const counts = { pending: 0, inProgress: 0, completed: 0 };
      for (const task of snapshot.tasks) {
        if (task.status === "pending") counts.pending++;
        else if (task.status === "in_progress") counts.inProgress++;
        else counts.completed++;
      }
      return {
        content: [{ type: "text", text: formatTaskOutput(input.action, change) }],
        details: {
          action: input.action,
          ...(affected ? { id: affected.id, version: affected.version } : {}),
          ...(change.cleared !== undefined ? { cleared: change.cleared } : {}),
          total: snapshot.tasks.length,
          counts,
        },
      };
    },
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.registerCommand("tasks", {
    description: "Show persistent shared tasks",
    handler: async (_args, ctx) => {
      await load(ctx);
      const output = snapshot.tasks.length ? `Tasks (${snapshot.tasks.length}):\n${snapshot.tasks.map(line).join("\n")}` : "No shared tasks.";
      ctx.ui.notify(normalizeDisplayText(output), "info");
    },
  });

  pi.events.on(TASK_CHANGED_EVENT, () => {
    if (latestContext) void load(latestContext).catch(() => undefined);
  });
  pi.on("session_start", async (_event, ctx) => load(ctx));
  pi.on("session_tree", async (_event, ctx) => load(ctx));
  pi.on("session_compact", async (_event, ctx) => load(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") pi.events.emit(UI_PANEL_EVENT, { id: "task" });
  });
}
