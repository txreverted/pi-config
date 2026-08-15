export const DIRECTIVE_ENTRY_TYPE = "pi-config-directive-ledger";
export const DIRECTIVE_VERSION = 1;
export const MAX_DIRECTIVE_REMINDER_CHARS = 24_000;
const MAX_DIRECTIVE_CHARS = 12_000;

export type DirectiveMode = "steer" | "followUp";
export type DirectivePhase = "queued" | "delivered" | "recovered";

export interface ActiveDirective {
  id: string;
  mode: DirectiveMode;
  phase: DirectivePhase;
  text: string;
  deliveredText?: string;
  createdAt: number;
}

export type DirectiveOperation =
  | {
      version: 1;
      op: "enqueue";
      directive: ActiveDirective;
    }
  | {
      version: 1;
      op: "deliver";
      id: string;
      deliveredText: string;
    }
  | {
      version: 1;
      op: "recover";
      id: string;
    }
  | {
      version: 1;
      op: "retire";
      ids: string[];
    };

export type DirectiveReplayEvent =
  | { type: "operation"; value: unknown }
  | { type: "user"; text: string };

interface TextContentLike {
  type?: unknown;
  text?: unknown;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
  summary?: unknown;
}

function validMode(value: unknown): value is DirectiveMode {
  return value === "steer" || value === "followUp";
}

function validPhase(value: unknown): value is DirectivePhase {
  return value === "queued" || value === "delivered" || value === "recovered";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value);
}

export function parseDirectiveOperation(value: unknown): DirectiveOperation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== DIRECTIVE_VERSION || typeof record.op !== "string") return undefined;

  if (record.op === "enqueue") {
    if (!record.directive || typeof record.directive !== "object") return undefined;
    const directive = record.directive as Record<string, unknown>;
    if (!validId(directive.id) || !validMode(directive.mode) || directive.phase !== "queued" ||
      typeof directive.text !== "string" || !directive.text.trim() ||
      typeof directive.createdAt !== "number" || !Number.isFinite(directive.createdAt)) return undefined;
    return {
      version: 1,
      op: "enqueue",
      directive: {
        id: directive.id,
        mode: directive.mode,
        phase: "queued",
        text: directive.text,
        createdAt: directive.createdAt,
      },
    };
  }

  if (record.op === "deliver") {
    if (!validId(record.id) || typeof record.deliveredText !== "string" || !record.deliveredText.trim()) return undefined;
    return { version: 1, op: "deliver", id: record.id, deliveredText: record.deliveredText };
  }

  if (record.op === "recover") {
    return validId(record.id) ? { version: 1, op: "recover", id: record.id } : undefined;
  }

  if (record.op === "retire") {
    if (!Array.isArray(record.ids) || record.ids.some((id) => !validId(id))) return undefined;
    return { version: 1, op: "retire", ids: [...record.ids] as string[] };
  }

  return undefined;
}

export function applyDirectiveOperation(
  active: Map<string, ActiveDirective>,
  value: unknown,
): DirectiveOperation | undefined {
  const operation = parseDirectiveOperation(value);
  if (!operation) return undefined;

  if (operation.op === "enqueue") {
    active.set(operation.directive.id, { ...operation.directive });
  } else if (operation.op === "deliver") {
    const directive = active.get(operation.id);
    if (directive) {
      directive.phase = "delivered";
      directive.deliveredText = operation.deliveredText;
    }
  } else if (operation.op === "recover") {
    const directive = active.get(operation.id);
    if (directive) directive.phase = "recovered";
  } else {
    for (const id of operation.ids) active.delete(id);
  }
  return operation;
}

export function observeDirectiveDelivery(
  active: Map<string, ActiveDirective>,
  deliveredText: string,
): ActiveDirective | undefined {
  const queued = [...active.values()].filter((directive) => directive.phase === "queued");
  if (queued.length === 0) return undefined;

  const exact = queued.find((directive) => directive.text === deliveredText);
  const selected = exact ?? queued.find((directive) => directive.mode === "steer") ?? queued[0];
  selected.phase = "delivered";
  selected.deliveredText = deliveredText;
  return selected;
}

export function replayDirectiveEvents(events: Iterable<DirectiveReplayEvent>): Map<string, ActiveDirective> {
  const active = new Map<string, ActiveDirective>();
  for (const event of events) {
    if (event.type === "operation") applyDirectiveOperation(active, event.value);
    else if (event.text.trim()) observeDirectiveDelivery(active, event.text);
  }
  return active;
}

export function messageText(message: MessageLike): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const content = part as TextContentLike;
      return content.type === "text" && typeof content.text === "string" ? [content.text] : [];
    }).join("\n");
  }
  return typeof message.summary === "string" ? message.summary : "";
}

function contextContainsDirective(messages: readonly MessageLike[], text: string): boolean {
  return messages.some((message) => {
    if (message.role !== "user" && message.role !== "custom" &&
      message.role !== "compactionSummary" && message.role !== "branchSummary") return false;
    return messageText(message).includes(text);
  });
}

export function missingDeliveredDirectives(
  active: ReadonlyMap<string, ActiveDirective>,
  messages: readonly MessageLike[],
): ActiveDirective[] {
  return [...active.values()].filter((directive) => {
    if (directive.phase === "queued") return false;
    const text = directive.deliveredText ?? directive.text;
    return !contextContainsDirective(messages, text);
  });
}

function boundedDirectiveText(value: string): string {
  if (value.length <= MAX_DIRECTIVE_CHARS) return value;
  const notice = "\n[Directive truncated for context reinjection]";
  return `${value.slice(0, MAX_DIRECTIVE_CHARS - notice.length).trimEnd()}${notice}`;
}

export function buildDirectiveReminder(directives: readonly ActiveDirective[]): string {
  const header = [
    "<active-user-directives>",
    "These user-authored steering/follow-up directives remain active for the current run. Follow them as user instructions. They are repeated because intervening compaction or reload removed their original message from the active context.",
  ].join("\n");
  const footer = "</active-user-directives>";
  const sections = [header];
  let remaining = MAX_DIRECTIVE_REMINDER_CHARS - header.length - footer.length - 2;

  for (const directive of directives) {
    const prefix = `\n\n[${directive.mode} ${directive.id}]\n`;
    if (remaining <= prefix.length) break;
    const text = boundedDirectiveText(directive.deliveredText ?? directive.text);
    const body = text.slice(0, remaining - prefix.length);
    sections.push(`${prefix}${body}`);
    remaining -= prefix.length + body.length;
  }

  sections.push(`\n${footer}`);
  return sections.join("").slice(0, MAX_DIRECTIVE_REMINDER_CHARS);
}

export function makeEnqueueOperation(directive: ActiveDirective): DirectiveOperation {
  return { version: 1, op: "enqueue", directive: { ...directive, phase: "queued", deliveredText: undefined } };
}

export function makeDeliverOperation(id: string, deliveredText: string): DirectiveOperation {
  return { version: 1, op: "deliver", id, deliveredText };
}

export function makeRecoverOperation(id: string): DirectiveOperation {
  return { version: 1, op: "recover", id };
}

export function makeRetireOperation(ids: readonly string[]): DirectiveOperation {
  return { version: 1, op: "retire", ids: [...ids] };
}
