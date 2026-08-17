import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type EditorTheme, type Focusable, type TUI,
} from "@earendil-works/pi-tui";
import type { PersistentAgentRecord } from "./subagents-supervisor.ts";
import { formatElapsed, formatTokens } from "./ui-core.ts";
import { safeDisplayLine, safeDisplayText } from "./text-safety.ts";

export type AgentsUiAction =
  | { type: "close" | "refresh" }
  | { type: "message" | "resume"; id: string; message: string }
  | { type: "interrupt" | "diff" | "apply" | "discard" | "delete"; id: string };

export interface AgentsUiState {
  selectedId?: string;
  transcript?: string;
  claimedTasks?: ReadonlyMap<string, string>;
}

const ACTIVE = new Set(["queued", "starting", "running"]);

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []).join("");
}

/** Parse only known native message fields. Never render serialized JSON or terminal controls. */
export function formatRecentTranscript(raw: string, maxMessages = 12, maxChars = 12_000): string {
  const messages: string[] = [];
  for (const line of raw.split("\n").slice(-400)) {
    if (!line || line.length > 200_000) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "message") continue;
    const message = (entry as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: unknown }).role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
    const text = safeDisplayText(contentText((message as { content?: unknown }).content)).trim();
    if (!text) continue;
    messages.push(`${role === "toolResult" ? "tool" : role}: ${text}`);
  }
  const recent = messages.slice(-Math.max(1, maxMessages));
  let output = recent.join("\n\n");
  if (output.length > maxChars) output = `…${output.slice(output.length - maxChars + 1)}`;
  return output || "(no recent transcript messages)";
}

function progress(record: PersistentAgentRecord) {
  return record.progress ?? record.result;
}

function activity(record: PersistentAgentRecord): string {
  const current = progress(record);
  return safeDisplayLine(current?.activity ?? current?.currentTool ?? record.status, 80) || record.status;
}

function treeOrder(records: readonly PersistentAgentRecord[]): PersistentAgentRecord[] {
  const byParent = new Map<string | undefined, PersistentAgentRecord[]>();
  for (const record of records) byParent.set(record.parentId, [...(byParent.get(record.parentId) ?? []), record]);
  const output: PersistentAgentRecord[] = [];
  const visit = (parent?: string) => {
    for (const record of (byParent.get(parent) ?? []).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
      output.push(record); visit(record.id);
    }
  };
  visit();
  return output;
}

export class AgentsView implements Focusable {
  private records: PersistentAgentRecord[];
  private selected = 0;
  private inputMode: "message" | "resume" | undefined;
  private readonly editor: Editor;
  private _focused = false;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly state: AgentsUiState;
  private readonly done: (action: AgentsUiAction) => void;

  constructor(
    tui: TUI,
    theme: Theme,
    records: readonly PersistentAgentRecord[],
    state: AgentsUiState,
    done: (action: AgentsUiAction) => void,
  ) {
    this.tui = tui; this.theme = theme; this.state = state; this.done = done;
    this.records = treeOrder(records);
    const selected = this.records.findIndex((record) => record.id === state.selectedId);
    this.selected = selected < 0 ? 0 : selected;
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text), selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text), scrollInfo: (text) => theme.fg("dim", text), noMatch: (text) => theme.fg("warning", text),
      },
    };
    this.editor = new Editor(tui, editorTheme);
    this.editor.onSubmit = (text) => {
      const selectedRecord = this.current();
      const message = text.trim();
      if (selectedRecord && message && this.inputMode) this.done({ type: this.inputMode, id: selectedRecord.id, message });
    };
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.editor.focused = value && !!this.inputMode; }
  invalidate(): void { this.editor.invalidate(); }

  setRecords(records: readonly PersistentAgentRecord[]): void {
    const selectedId = this.current()?.id;
    this.records = treeOrder(records);
    const next = this.records.findIndex((record) => record.id === selectedId);
    this.selected = next >= 0 ? next : Math.min(this.selected, Math.max(0, this.records.length - 1));
    this.tui.requestRender();
  }

  private current(): PersistentAgentRecord | undefined { return this.records[this.selected]; }
  private finish(action: AgentsUiAction): void {
    const current = this.current();
    if (current) this.state.selectedId = current.id;
    this.done(action);
  }

  handleInput(data: string): void {
    if (this.inputMode) {
      if (matchesKey(data, Key.escape)) { this.inputMode = undefined; this.editor.setText(""); this.editor.focused = false; this.tui.requestRender(); return; }
      this.editor.handleInput(data); this.tui.requestRender(); return;
    }
    if (matchesKey(data, Key.escape)) return this.finish({ type: "close" });
    if (matchesKey(data, Key.up) || data === "k") this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(data, Key.down) || data === "j") this.selected = Math.min(this.records.length - 1, this.selected + 1);
    else if (matchesKey(data, Key.enter)) { const current = this.current(); if (current) { this.state.transcript = undefined; return this.finish({ type: "refresh" }); } }
    else if (data === "f") return this.finish({ type: "refresh" });
    else {
      const current = this.current(); if (!current) return;
      if (data === "m") this.inputMode = ACTIVE.has(current.status) ? "message" : "resume";
      else if (data === "i" && ACTIVE.has(current.status)) return this.finish({ type: "interrupt", id: current.id });
      else if (data === "r" && !ACTIVE.has(current.status)) this.inputMode = "resume";
      else if (data === "d" && current.worktree) return this.finish({ type: "diff", id: current.id });
      else if (data === "a" && current.worktree && !ACTIVE.has(current.status)) return this.finish({ type: "apply", id: current.id });
      else if (data === "x" && current.worktree && !ACTIVE.has(current.status)) return this.finish({ type: "discard", id: current.id });
      else if (data === "z" && !current.worktree && !ACTIVE.has(current.status)) return this.finish({ type: "delete", id: current.id });
    }
    this.editor.focused = this.focused && !!this.inputMode;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const maxRows = Math.max(10, (this.tui.terminal?.rows ?? 30) - 2);
    const line = (text: string) => truncateToWidth(text, safeWidth, "");
    const lines = [line(this.theme.bold("Agents"))];
    if (!this.records.length) lines.push(line(this.theme.fg("dim", "No persistent agents.")));

    const visibleCount = Math.max(1, Math.min(this.records.length, Math.floor((maxRows - 10) / 4)));
    const start = Math.max(0, Math.min(this.selected - Math.floor(visibleCount / 2), this.records.length - visibleCount));
    const end = Math.min(this.records.length, start + visibleCount);
    if (start > 0) lines.push(line(this.theme.fg("dim", `… ${start} earlier agent${start === 1 ? "" : "s"}`)));
    for (let index = start; index < end; index++) {
      const record = this.records[index];
      const current = progress(record);
      const endedAt = Number.isFinite(record.result?.endedAt) ? record.result!.endedAt : Date.now();
      const startedAt = Number.isFinite(current?.startedAt) ? current!.startedAt : record.createdAt;
      const elapsed = endedAt - startedAt;
      const tokens = Number.isFinite(current?.usage?.totalTokens) ? current!.usage.totalTokens : 0;
      const cost = Number.isFinite(current?.usage?.cost?.total) ? current!.usage.cost.total : 0;
      const claim = this.state.claimedTasks?.get(record.id);
      const prefix = `${index === this.selected ? ">" : " "} ${"  ".repeat(Math.max(0, record.depth - 1))}${record.parentId ? "└─" : "•"}`;
      const stats = `${formatElapsed(elapsed)} · ${formatTokens(Math.round(tokens))}t · $${cost.toFixed(3)}`;
      lines.push(line(`${prefix} ${safeDisplayLine(record.name, 80)} · ${record.agent} · ${record.status} · ${stats}`));
      lines.push(line(`${" ".repeat(Math.min(safeWidth, visibleWidth(prefix) + 1))}${claim ? `#${claim} · ` : ""}${activity(record)}`));
    }
    if (end < this.records.length) lines.push(line(this.theme.fg("dim", `… ${this.records.length - end} later agent${this.records.length - end === 1 ? "" : "s"}`)));

    const selected = this.current();
    if (selected) {
      lines.push("");
      lines.push(line(this.theme.fg("accent", `Recent native transcript · ${safeDisplayLine(selected.name, 80)}`)));
      const transcript = this.state.transcript ?? "Press enter or f to refresh transcript.";
      const rendered = transcript.split("\n").flatMap((paragraph) => wrapTextWithAnsi(paragraph || " ", safeWidth).map(line));
      const editorRows = this.inputMode ? Math.min(4, this.editor.render(safeWidth).length) : 0;
      const available = Math.max(1, maxRows - lines.length - editorRows - 2);
      lines.push(...rendered.slice(-available));
    }
    lines.push("");
    lines.push(line(this.theme.fg("dim", "↑↓ select · enter/open · m message · i interrupt · r resume · f refresh · d diff · a apply · x discard · z delete · esc close")));
    if (this.inputMode) lines.push(...this.editor.render(safeWidth).slice(0, Math.max(1, maxRows - lines.length)));
    return lines.slice(0, maxRows);
  }
}
