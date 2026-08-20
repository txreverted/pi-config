import {
  estimateTokens,
  type BuildSystemPromptOptions,
  type ContextEvent,
  type ContextUsage,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";

export interface ContextCategory {
  id: string;
  label: string;
  tokens: number;
  children?: ContextCategory[];
}

export interface ContextSnapshot {
  model?: string;
  contextWindow?: number;
  reportedTokens?: number | null;
  reportedPercent?: number | null;
  reserveTokens?: number;
  turnPoliciesObserved: boolean;
  estimatedTokens: number;
  categories: ContextCategory[];
}

export interface ContextSnapshotInput {
  systemPrompt: string;
  options: BuildSystemPromptOptions;
  tools: readonly ToolInfo[];
  activeToolNames: readonly string[];
  messages: ContextEvent["messages"];
  reported?: ContextUsage;
  model?: string;
  reserveTokens?: number;
  turnPoliciesObserved?: boolean;
}

interface Span {
  id: string;
  label: string;
  start: number;
  end: number;
}

const PROMPT_ORDER = ["system-prompt", "memory", "skills", "appended-prompt", "extension-policies"];
const MESSAGE_ORDER = [
  "user-messages",
  "agent-messages",
  "tool-output",
  "shell-output",
  "extension-messages",
  "compacted-data",
];

export function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildContextSnapshot(input: ContextSnapshotInput): ContextSnapshot {
  const categories = [
    ...promptCategories(input.systemPrompt, input.options),
    ...toolCategories(input.tools, input.activeToolNames),
    ...messageCategories(input.messages),
  ].filter((category) => category.tokens > 0);
  return {
    model: input.model,
    contextWindow: input.reported?.contextWindow,
    reportedTokens: input.reported === undefined ? undefined : input.reported.tokens,
    reportedPercent: input.reported === undefined ? undefined : input.reported.percent,
    reserveTokens: input.reserveTokens,
    turnPoliciesObserved: input.turnPoliciesObserved ?? true,
    estimatedTokens: categories.reduce((sum, category) => sum + category.tokens, 0),
    categories,
  };
}

function promptCategories(systemPrompt: string, options: BuildSystemPromptOptions): ContextCategory[] {
  const spans: Span[] = [];
  const memory = delimitedSpan(systemPrompt, "<project_context>", "</project_context>");
  if (memory) spans.push({ id: "memory", label: "Memory and project rules", ...memory });

  const skillsStart = systemPrompt.lastIndexOf("The following skills provide specialized instructions");
  if (skillsStart >= 0) {
    const close = "</available_skills>";
    const closeStart = systemPrompt.indexOf(close, skillsStart);
    if (closeStart >= 0) {
      spans.push({ id: "skills", label: "Skills index", start: skillsStart, end: closeStart + close.length });
    }
  }

  const footerStart = findWorkingDirectoryFooter(systemPrompt, options.cwd);
  const extensionStart = footerStart === undefined
    ? undefined
    : lineEnd(systemPrompt, footerStart);
  if (extensionStart !== undefined && systemPrompt.slice(extensionStart).trim()) {
    spans.push({
      id: "extension-policies",
      label: "Extension policies",
      start: extensionStart,
      end: systemPrompt.length,
    });
  }

  const append = options.appendSystemPrompt;
  if (append) {
    const upperBound = Math.min(
      footerStart ?? systemPrompt.length,
      ...spans.filter((span) => span.id === "memory" || span.id === "skills").map((span) => span.start),
    );
    const start = systemPrompt.lastIndexOf(append, upperBound);
    if (start >= 0 && start + append.length <= upperBound) {
      spans.push({ id: "appended-prompt", label: "Appended prompt", start, end: start + append.length });
    }
  }

  const accepted = nonOverlappingSpans(spans);
  const categories = accepted.map((span) => ({
    id: span.id,
    label: span.label,
    tokens: textTokens(systemPrompt.slice(span.start, span.end)),
  }));
  const base = carve(systemPrompt, accepted);
  categories.push({
    id: "system-prompt",
    label: options.customPrompt ? "Custom system prompt" : "System prompt",
    tokens: textTokens(base),
  });
  return categories.sort((left, right) => PROMPT_ORDER.indexOf(left.id) - PROMPT_ORDER.indexOf(right.id));
}

function toolCategories(tools: readonly ToolInfo[], activeToolNames: readonly string[]): ContextCategory[] {
  const active = new Set(activeToolNames);
  const system: ContextCategory[] = [];
  const custom: ContextCategory[] = [];
  for (const tool of tools) {
    if (!active.has(tool.name)) continue;
    const definition = `${tool.name}: ${tool.description}\n${JSON.stringify(tool.parameters ?? {})}`;
    const category = { id: `tool:${tool.name}`, label: tool.name, tokens: textTokens(definition) };
    (tool.sourceInfo.source === "builtin" ? system : custom).push(category);
  }
  return [
    aggregate("system-tools", "System tools", system),
    aggregate("custom-tools", "Custom tools", custom),
  ].filter((category): category is ContextCategory => category !== undefined);
}

function messageCategories(messages: ContextEvent["messages"]): ContextCategory[] {
  const totals = new Map<string, ContextCategory>();
  const toolResults = new Map<string, number>();
  const extensionMessages = new Map<string, number>();
  const add = (id: string, label: string, tokens: number) => {
    const current = totals.get(id);
    totals.set(id, { id, label, tokens: (current?.tokens ?? 0) + tokens });
  };

  for (const message of messages) {
    const tokens = estimateTokens(message);
    switch (message.role) {
      case "user":
        add("user-messages", "User messages", tokens);
        break;
      case "assistant":
        add("agent-messages", "Agent messages", tokens);
        break;
      case "toolResult":
        toolResults.set(message.toolName, (toolResults.get(message.toolName) ?? 0) + tokens);
        break;
      case "bashExecution":
        if (!message.excludeFromContext) add("shell-output", "Shell output", tokens);
        break;
      case "custom":
        extensionMessages.set(message.customType, (extensionMessages.get(message.customType) ?? 0) + tokens);
        break;
      case "branchSummary":
      case "compactionSummary":
        add("compacted-data", "Compacted data", tokens);
        break;
    }
  }

  const toolOutput = mapAggregate("tool-output", "Tool output", "tool-result", toolResults);
  if (toolOutput) totals.set(toolOutput.id, toolOutput);
  const extensions = mapAggregate("extension-messages", "Extension messages", "extension-message", extensionMessages);
  if (extensions) totals.set(extensions.id, extensions);
  return MESSAGE_ORDER.flatMap((id) => totals.get(id) ?? []);
}

function aggregate(id: string, label: string, children: ContextCategory[]): ContextCategory | undefined {
  if (!children.length) return undefined;
  const sorted = [...children].sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
  return { id, label, tokens: sorted.reduce((sum, child) => sum + child.tokens, 0), children: sorted };
}

function mapAggregate(
  id: string,
  label: string,
  childPrefix: string,
  values: Map<string, number>,
): ContextCategory | undefined {
  return aggregate(id, label, [...values].map(([childLabel, tokens]) => ({
    id: `${childPrefix}:${childLabel}`,
    label: childLabel,
    tokens,
  })));
}

function delimitedSpan(text: string, open: string, close: string): Pick<Span, "start" | "end"> | undefined {
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  const closeStart = text.indexOf(close, start + open.length);
  return closeStart < 0 ? undefined : { start, end: closeStart + close.length };
}

function findWorkingDirectoryFooter(systemPrompt: string, cwd: string): number | undefined {
  const line = `\nCurrent working directory: ${cwd.replaceAll("\\", "/")}`;
  let start = systemPrompt.lastIndexOf(line);
  while (start >= 0) {
    const end = start + line.length;
    if (end === systemPrompt.length || systemPrompt[end] === "\n") return start;
    start = systemPrompt.lastIndexOf(line, start - 1);
  }
  return undefined;
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf("\n", start + 1);
  return end < 0 ? text.length : end;
}

function nonOverlappingSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted: Span[] = [];
  for (const span of sorted) {
    if (span.start < 0 || span.end <= span.start) continue;
    if (accepted.some((current) => span.start < current.end && span.end > current.start)) continue;
    accepted.push(span);
  }
  return accepted;
}

function carve(text: string, spans: readonly Pick<Span, "start" | "end">[]): string {
  let cursor = 0;
  let result = "";
  for (const span of spans) {
    result += text.slice(cursor, span.start);
    cursor = span.end;
  }
  return result + text.slice(cursor);
}
