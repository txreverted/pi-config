import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  type KeybindingsManager,
  matchesKey,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { boundCustomAnswer, CUSTOM_CHOICE, type AskAnswer, type AskQuestion } from "./ask-core.ts";

export interface AskUiResult {
  answers: AskAnswer[];
  cancelled: boolean;
}

export class AskState {
  page = 0;
  cursor = 0;
  readonly questions: readonly AskQuestion[];
  private readonly selected = new Map<number, Set<number>>();
  private readonly custom = new Map<number, string>();

  constructor(questions: readonly AskQuestion[]) { this.questions = questions; }

  get review(): boolean { return this.page === this.questions.length; }
  get question(): AskQuestion | undefined { return this.questions[this.page]; }
  get selectedIndexes(): readonly number[] { return [...(this.selected.get(this.page) ?? [])].sort((a, b) => a - b); }
  get customAnswer(): string | undefined { return this.custom.get(this.page); }

  movePage(delta: number): void {
    this.page = (this.page + delta + this.questions.length + 1) % (this.questions.length + 1);
    this.cursor = 0;
  }

  choose(index: number): void {
    const question = this.question;
    if (!question || index < 0 || index >= question.options.length) return;
    if (!question.multiSelect) {
      this.selected.set(this.page, new Set([index]));
      this.custom.delete(this.page);
      return;
    }
    const indexes = this.selected.get(this.page) ?? new Set<number>();
    indexes.has(index) ? indexes.delete(index) : indexes.add(index);
    this.selected.set(this.page, indexes);
  }

  write(value: unknown): void {
    if (!this.question) return;
    const answer = boundCustomAnswer(value);
    if (answer) this.custom.set(this.page, answer);
    else this.custom.delete(this.page);
    if (!this.question.multiSelect) this.selected.delete(this.page);
  }

  isAnswered(index: number): boolean {
    return (this.selected.get(index)?.size ?? 0) > 0 || Boolean(this.custom.get(index));
  }

  get allAnswered(): boolean { return this.questions.every((_question, index) => this.isAnswered(index)); }

  answers(): AskAnswer[] {
    return this.questions.flatMap((question, questionIndex) => {
      const indexes = [...(this.selected.get(questionIndex) ?? [])].sort((a, b) => a - b);
      const custom = this.custom.get(questionIndex);
      const labels = indexes.map((index) => question.options[index]?.label).filter((label): label is string => Boolean(label));
      if (custom) labels.push(custom);
      if (!labels.length) return [];
      return [{
        question: question.question,
        answer: labels.join(", "),
        optionIndexes: indexes.map((index) => index + 1),
        custom: Boolean(custom),
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

function fitRows(lines: string[], maxRows: number, theme: Theme): string[] {
  if (lines.length <= maxRows) return lines;
  if (maxRows <= 1) return [lines[0]];
  if (maxRows < 5) return [lines[0], ...Array.from({ length: maxRows - 2 }, () => theme.fg("dim", " ...")), lines.at(-1)!];
  const footerCount = Math.min(2, maxRows - 2);
  const headerCount = Math.min(3, maxRows - footerCount - 1);
  const header = lines.slice(0, headerCount);
  const footer = lines.slice(-footerCount);
  const body = lines.slice(headerCount, -footerCount);
  const slots = maxRows - header.length - footer.length;
  const focus = Math.max(0, body.findIndex((line) =>
    line.includes(CURSOR_MARKER) || /(?:^|\s)>\s|Enter to submit|Enter save/.test(stripTerminalSequences(line)),
  ));
  const start = Math.max(0, Math.min(focus - Math.floor(slots / 2), body.length - slots));
  return [...header, ...body.slice(start, start + slots), ...footer];
}

export function createAskComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  questions: readonly AskQuestion[],
  done: (result: AskUiResult) => void,
): Focusable & {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  snapshot(cancelled: boolean): AskUiResult;
} {
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
  let editing = false;
  let focused = false;
  const refresh = () => tui.requestRender();

  editor.onSubmit = (value) => {
    state.write(value);
    editing = false;
    editor.setText("");
    if (state.isAnswered(state.page)) state.movePage(1);
    refresh();
  };

  return {
    get focused() { return focused; },
    set focused(value: boolean) { focused = value; editor.focused = value; },
    invalidate() { editor.invalidate(); },
    snapshot(cancelled: boolean) { return { answers: state.answers(), cancelled }; },
    handleInput(data: string) {
      if (editing) {
        if (keybindings.matches(data, "tui.select.cancel")) {
          editing = false;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }
      if (keybindings.matches(data, "tui.select.cancel")) {
        done({ answers: state.answers(), cancelled: true });
        return;
      }
      if (keybindings.matches(data, "tui.input.tab") || matchesKey(data, Key.right)) {
        state.movePage(1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        state.movePage(-1);
        refresh();
        return;
      }
      if (state.review) {
        if (keybindings.matches(data, "tui.select.confirm") && state.allAnswered) {
          done({ answers: state.answers(), cancelled: false });
        }
        return;
      }

      const question = state.question!;
      const customIndex = question.options.length;
      if (keybindings.matches(data, "tui.select.up")) {
        state.cursor = Math.max(0, state.cursor - 1);
        refresh();
        return;
      }
      if (keybindings.matches(data, "tui.select.down")) {
        state.cursor = Math.min(customIndex, state.cursor + 1);
        refresh();
        return;
      }
      if (question.multiSelect && matchesKey(data, Key.space) && state.cursor < customIndex) {
        state.choose(state.cursor);
        refresh();
        return;
      }
      if (!keybindings.matches(data, "tui.select.confirm")) return;
      if (state.cursor === customIndex) {
        editing = true;
        editor.setText(state.customAnswer ?? "");
        refresh();
        return;
      }
      if (!question.multiSelect || !state.isAnswered(state.page)) state.choose(state.cursor);
      state.movePage(1);
      refresh();
    },
    render(width: number): string[] {
      const renderWidth = Math.max(1, Math.floor(width));
      const lines: string[] = [theme.fg("accent", "─".repeat(renderWidth))];
      const tabs = questions.map((question, index) => {
        const mark = state.isAnswered(index) ? "■" : "□";
        return theme.fg(index === state.page ? "accent" : "muted", `${mark} ${question.header}`);
      });
      tabs.push(theme.fg(state.review ? "accent" : "muted", "Review"));
      addWrapped(lines, " ", tabs.join(" | "), renderWidth);
      lines.push("");

      if (editing) {
        addWrapped(lines, " ", theme.fg("accent", "Write your answer"), renderWidth);
        for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(truncateToWidth(` ${line}`, renderWidth, ""));
        addWrapped(lines, " ", theme.fg("dim", "Enter save | Esc back"), renderWidth);
      } else if (state.review) {
        addWrapped(lines, " ", theme.bold("Review answers"), renderWidth);
        for (const question of questions) {
          const answer = state.answers().find((candidate) => candidate.question === question.question);
          addWrapped(lines, " ", `${theme.fg("muted", `${question.header}:`)} ${answer?.answer ?? theme.fg("warning", "Unanswered")}`, renderWidth);
        }
        lines.push("");
        addWrapped(lines, " ", theme.fg(state.allAnswered ? "success" : "warning", state.allAnswered ? "Enter to submit" : "Answer every question before submitting"), renderWidth);
      } else {
        const question = state.question!;
        addWrapped(lines, " ", theme.bold(question.question), renderWidth);
        lines.push("");
        question.options.forEach((option, index) => {
          const mark = state.selectedIndexes.includes(index) ? "■" : "□";
          const cursor = state.cursor === index ? theme.fg("accent", "> ") : "  ";
          addWrapped(lines, cursor, `├─ ${mark} ${option.label} - ${theme.fg("muted", option.description)}`, renderWidth);
        });
        const customMark = state.customAnswer ? "■" : "□";
        const customCursor = state.cursor === question.options.length ? theme.fg("accent", "> ") : "  ";
        addWrapped(lines, customCursor, `└─ ${customMark} ${CUSTOM_CHOICE}`, renderWidth);
      }

      lines.push("");
      addWrapped(lines, " ", theme.fg("dim", "Tab/left/right questions | Up/down choose | Space toggle | Enter confirm | Esc cancel"), renderWidth);
      lines.push(theme.fg("accent", "─".repeat(renderWidth)));
      const bounded = lines.map((line) => truncateToWidth(line, renderWidth, ""));
      return fitRows(bounded, Math.max(1, (tui.terminal?.rows ?? 30) - 2), theme);
    },
  };
}
