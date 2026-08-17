import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  type Focusable,
  type KeybindingsManager,
  Markdown,
  type TUI,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { boundCustomAnswer, type AskAnswer, type AskQuestion } from "./ask-core.ts";

export interface AskUiResult {
  answers: AskAnswer[];
  notes?: string;
  cancelled: boolean;
  timedOut: boolean;
}

export class AskState {
  page = 0;
  cursor = 0;
  notes?: string;
  private readonly selected = new Map<string, Set<number>>();
  private readonly custom = new Map<string, string>();
  readonly questions: readonly AskQuestion[];

  constructor(questions: readonly AskQuestion[]) { this.questions = questions; }

  get review(): boolean { return this.page === this.questions.length; }
  get question(): AskQuestion | undefined { return this.questions[this.page]; }
  get selectedIndexes(): readonly number[] {
    const question = this.question;
    return question ? [...(this.selected.get(question.id) ?? [])].sort((a, b) => a - b) : [];
  }
  get customAnswer(): string | undefined {
    const question = this.question;
    return question ? this.custom.get(question.id) : undefined;
  }

  movePage(delta: number): void {
    this.page = (this.page + delta + this.questions.length + 1) % (this.questions.length + 1);
    this.cursor = 0;
  }

  choose(index: number): void {
    const question = this.question;
    if (!question?.options) return;
    if (!question.multiSelect) {
      this.selected.set(question.id, new Set([index]));
      this.custom.delete(question.id);
      return;
    }
    const indexes = this.selected.get(question.id) ?? new Set<number>();
    indexes.has(index) ? indexes.delete(index) : indexes.add(index);
    this.selected.set(question.id, indexes);
  }

  write(value: string): void {
    const question = this.question;
    if (!question) return;
    const answer = boundCustomAnswer(value);
    if (answer) this.custom.set(question.id, answer);
    else this.custom.delete(question.id);
    if (!question.multiSelect) this.selected.delete(question.id);
  }

  isAnswered(question: AskQuestion): boolean {
    return (this.selected.get(question.id)?.size ?? 0) > 0 || Boolean(this.custom.get(question.id));
  }

  get allAnswered(): boolean { return this.questions.every((question) => this.isAnswered(question)); }

  answers(): AskAnswer[] {
    return this.questions.flatMap((question) => {
      const indexes = [...(this.selected.get(question.id) ?? [])].sort((a, b) => a - b);
      const custom = this.custom.get(question.id);
      const labels = indexes.map((index) => question.options?.[index]?.label).filter((label): label is string => Boolean(label));
      if (custom) labels.push(custom);
      if (labels.length === 0) return [];
      return [{
        id: question.id,
        question: question.question,
        answer: labels.join(", "),
        kind: indexes.length > 0 ? "option" as const : "custom" as const,
        ...(indexes.length === 1 && !question.multiSelect ? { optionIndex: indexes[0] + 1 } : {}),
        ...(question.multiSelect && indexes.length > 0 ? { optionIndexes: indexes.map((index) => index + 1) } : {}),
      }];
    });
  }
}

function addWrapped(lines: string[], prefix: string, text: string, width: number): void {
  const prefixWidth = visibleWidth(prefix);
  const available = Math.max(1, width - prefixWidth);
  const wrapped = wrapTextWithAnsi(text, available);
  for (let index = 0; index < wrapped.length; index++) {
    lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[index]}`);
  }
}

export function createAskComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  questions: readonly AskQuestion[],
  context: string | undefined,
  done: (result: AskUiResult) => void,
): Focusable & { render(width: number): string[]; handleInput(data: string): void; invalidate(): void; snapshot(cancelled: boolean, timedOut: boolean): AskUiResult } {
  const state = new AskState(questions);
  const editorTheme: EditorTheme = {
    borderColor: (text) => theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
  const editor = new Editor(tui, editorTheme, { paddingX: 0 });
  let editing: "answer" | "notes" | undefined;
  let focused = false;

  const refresh = () => tui.requestRender();
  editor.onSubmit = (value) => {
    const trimmed = value.trim();
    const question = state.question;
    if (editing === "notes") state.notes = boundCustomAnswer(trimmed);
    else state.write(trimmed);
    editing = undefined;
    editor.setText("");
    if (question && state.isAnswered(question)) {
      if (state.allAnswered) {
        done({ answers: state.answers(), notes: state.notes, cancelled: false, timedOut: false });
        return;
      }
      state.movePage(1);
    }
    refresh();
  };

  const component = {
    get focused() { return focused; },
    set focused(value: boolean) { focused = value; editor.focused = value; },
    invalidate() { editor.invalidate(); },
    snapshot(cancelled: boolean, timedOut: boolean) {
      return { answers: state.answers(), notes: state.notes, cancelled, timedOut };
    },
    handleInput(data: string) {
      if (editing) {
        if (keybindings.matches(data, "tui.select.cancel")) {
          editing = undefined;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }
      if (keybindings.matches(data, "tui.select.cancel")) {
        done({ answers: state.answers(), notes: state.notes, cancelled: true, timedOut: false });
        return;
      }
      if (keybindings.matches(data, "tui.input.tab") || data === "\x1b[C") { state.movePage(1); refresh(); return; }
      if (data === "\x1b[Z" || data === "\x1b[D") { state.movePage(-1); refresh(); return; }
      if (state.review) {
        if ((data === "n" || data === "N")) {
          editing = "notes";
          editor.setText(state.notes ?? "");
          refresh();
        } else if (keybindings.matches(data, "tui.select.confirm") && state.allAnswered) {
          done({ answers: state.answers(), notes: state.notes, cancelled: false, timedOut: false });
        }
        return;
      }
      const question = state.question;
      const optionCount = question?.options?.length ?? 0;
      const choiceCount = optionCount + 1;
      if (keybindings.matches(data, "tui.select.up")) { state.cursor = Math.max(0, state.cursor - 1); refresh(); return; }
      if (keybindings.matches(data, "tui.select.down")) { state.cursor = Math.min(choiceCount - 1, state.cursor + 1); refresh(); return; }
      if (question?.multiSelect && data === " " && state.cursor < optionCount) { state.choose(state.cursor); refresh(); return; }
      if (!keybindings.matches(data, "tui.select.confirm")) return;
      if (!question?.options || state.cursor === optionCount) {
        editing = "answer";
        editor.setText(state.customAnswer ?? "");
        refresh();
        return;
      }
      if (!question.multiSelect || !state.isAnswered(question)) state.choose(state.cursor);
      if (state.allAnswered) {
        done({ answers: state.answers(), notes: state.notes, cancelled: false, timedOut: false });
        return;
      }
      state.movePage(1);
      refresh();
    },
    render(width: number): string[] {
      const renderWidth = Math.max(1, width);
      const lines: string[] = [theme.fg("accent", "─".repeat(renderWidth))];
      const tabs = questions.map((question, index) => {
        const label = question.header ?? `Q${index + 1}`;
        const tab = `${state.isAnswered(question) ? "[x]" : "[ ]"} ${label}`;
        return theme.fg(index === state.page ? "accent" : "muted", tab);
      });
      tabs.push(state.review ? theme.fg("accent", "[Review]") : theme.fg("muted", "Review"));
      addWrapped(lines, " ", tabs.join("  "), renderWidth);
      if (context) addWrapped(lines, " ", theme.fg("muted", context), renderWidth);
      lines.push("");

      if (editing) {
        addWrapped(lines, " ", theme.fg("accent", editing === "notes" ? "General notes" : "Write your answer"), renderWidth);
        for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(truncateToWidth(` ${line}`, renderWidth));
        addWrapped(lines, " ", theme.fg("dim", "Enter save • Esc back"), renderWidth);
      } else if (state.review) {
        addWrapped(lines, " ", theme.bold("Review answers"), renderWidth);
        for (const question of questions) {
          const answer = state.answers().find((candidate) => candidate.id === question.id);
          addWrapped(lines, " ", `${theme.fg("muted", `${question.header ?? question.id}:`)} ${answer?.answer ?? theme.fg("warning", "Unanswered")}`, renderWidth);
        }
        if (state.notes) addWrapped(lines, " ", `${theme.fg("muted", "Notes:")} ${state.notes}`, renderWidth);
        lines.push("");
        addWrapped(lines, " ", theme.fg(state.allAnswered ? "success" : "warning", state.allAnswered ? "Enter to submit" : "Answer every question before submitting"), renderWidth);
        addWrapped(lines, " ", theme.fg("dim", "N add/edit general notes"), renderWidth);
      } else {
        const question = state.question!;
        addWrapped(lines, " ", theme.bold(question.question), renderWidth);
        lines.push("");
        if (question.options) {
          question.options.forEach((option, index) => {
            const selected = state.selectedIndexes.includes(index);
            const cursor = state.cursor === index;
            const marker = selected ? "[x]" : "[ ]";
            const description = option.description ? ` — ${theme.fg("muted", option.description)}` : "";
            addWrapped(lines, cursor ? theme.fg("accent", "> ") : "  ", `${marker} ${option.label}${option.recommended ? " (recommended)" : ""}${description}`, renderWidth);
          });
        }
        const customIndex = question.options?.length ?? 0;
        addWrapped(lines, state.cursor === customIndex ? theme.fg("accent", "> ") : "  ", `${state.customAnswer ? "[x]" : "[ ]"} ${question.options ? "Write a different answer…" : "Write answer…"}`, renderWidth);
        const preview = question.options?.[state.cursor]?.preview;
        if (preview) {
          lines.push("");
          const markdown = new Markdown(preview, 1, 0, {
            heading: (text) => theme.fg("text", text), link: (text) => theme.fg("accent", text), linkUrl: (text) => theme.fg("dim", text),
            code: (text) => theme.fg("accent", text), codeBlock: (text) => theme.fg("text", text), codeBlockBorder: (text) => theme.fg("dim", text),
            quote: (text) => theme.fg("muted", text), quoteBorder: (text) => theme.fg("dim", text), hr: (text) => theme.fg("dim", text),
            listBullet: (text) => theme.fg("accent", text), bold: (text) => theme.bold(text), italic: (text) => theme.italic(text),
            strikethrough: (text) => theme.strikethrough(text), underline: (text) => text,
          }, { color: (text) => theme.fg("muted", text) });
          lines.push(...markdown.render(renderWidth));
        }
      }
      lines.push("");
      addWrapped(lines, " ", theme.fg("dim", "Tab/←→ questions • ↑↓ choose • Enter confirm • Esc cancel"), renderWidth);
      lines.push(theme.fg("accent", "─".repeat(renderWidth)));
      const bounded = lines.map((line) => truncateToWidth(line, renderWidth, ""));
      const maxRows = Math.max(1, (tui.terminal?.rows ?? 30) - 2);
      if (bounded.length <= maxRows) return bounded;
      if (maxRows === 1) return [bounded[0]];
      if (maxRows < 5) return [bounded[0], ...Array.from({ length: maxRows - 2 }, () => theme.fg("dim", " …")), bounded.at(-1)!];

      const footerCount = Math.min(2, maxRows - 2);
      const headerCount = Math.min(3, maxRows - footerCount - 1);
      const header = bounded.slice(0, headerCount);
      const footer = bounded.slice(-footerCount);
      const body = bounded.slice(headerCount, -footerCount);
      const focus = Math.max(0, body.findIndex((line) => /(?:^|\s)>\s|Enter to submit|Answer every question|Enter save/.test(stripTerminalSequences(line))));
      const slots = maxRows - header.length - footer.length;
      const start = Math.max(0, Math.min(focus - Math.floor(slots / 2), body.length - slots));
      const window = body.slice(start, start + slots);
      if (start > 0) window[0] = theme.fg("dim", " …");
      if (start + slots < body.length) window[window.length - 1] = theme.fg("dim", " …");
      return [...header, ...window, ...footer];
    },
  };
  return component;
}
