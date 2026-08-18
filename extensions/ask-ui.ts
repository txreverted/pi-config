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
import { AskState, type AskAnswer, type AskQuestion } from "./ask-core.ts";

export interface AskUiResult {
  answers: AskAnswer[];
  cancelled: boolean;
}

function addWrapped(lines: string[], prefix: string, text: string, width: number): void {
  const prefixWidth = visibleWidth(prefix);
  const available = Math.max(1, width - prefixWidth);
  const wrapped = wrapTextWithAnsi(text, available);
  for (let index = 0; index < wrapped.length; index++) {
    lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[index]}`);
  }
}

function configuredKey(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
  fallback: string,
): string {
  if (typeof keybindings.getKeys !== "function") return fallback;
  return String(keybindings.getKeys(binding)[0] ?? fallback);
}

function fitRows(lines: string[], maxRows: number, theme: Theme): string[] {
  if (lines.length <= maxRows) return lines;
  if (maxRows <= 1) return [lines[0]];
  if (maxRows < 5) return [lines[0], ...Array.from({ length: maxRows - 2 }, () => theme.fg("dim", " ─")), lines.at(-1)!];
  const footerCount = Math.min(2, maxRows - 2);
  const headerCount = Math.min(3, maxRows - footerCount - 1);
  const header = lines.slice(0, headerCount);
  const footer = lines.slice(-footerCount);
  const body = lines.slice(headerCount, -footerCount);
  const slots = maxRows - header.length - footer.length;
  const focus = Math.max(0, body.findIndex((line) =>
    line.includes(CURSOR_MARKER) || /(?:^|\s)>\s|Ready to submit|Enter to submit|Enter save/.test(stripTerminalSequences(line)),
  ));
  const start = Math.max(0, Math.min(focus - Math.floor(slots / 2), body.length - slots));
  const visible = body.slice(start, start + slots);
  if (slots >= 3 && start > 0) visible[0] = theme.fg("dim", " ... more above");
  if (slots >= 3 && start + slots < body.length) visible[visible.length - 1] = theme.fg("dim", " ... more below");
  const width = visibleWidth(lines[0] ?? "");
  return [...header, ...visible.map((line) => truncateToWidth(line, width, "")), ...footer];
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
      const rawNumber = /^[1-9]$/.test(data) ? Number(data) : undefined;
      const kittyNumber = /^\u001b\[(4[9]|5[0-7])(?:;1)?u$/.exec(data);
      const numberKey = rawNumber ?? (kittyNumber ? Number(kittyNumber[1]) - 48 : undefined);
      if (numberKey !== undefined) {
        const index = numberKey - 1;
        if (index > question.options.length) return;
        if (index === question.options.length) {
          editing = true;
          editor.setText(state.customAnswer ?? "");
        } else {
          state.choose(index);
          if (!question.multiSelect) state.movePage(1);
        }
        refresh();
        return;
      }
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
      const confirmKey = configuredKey(keybindings, "tui.select.confirm", "enter");
      const cancelKey = configuredKey(keybindings, "tui.select.cancel", "escape");
      const navigationKeys = [...new Set([
        configuredKey(keybindings, "tui.input.tab", "tab"),
        configuredKey(keybindings, "tui.select.up", "up"),
        configuredKey(keybindings, "tui.select.down", "down"),
      ])].join("/");
      const lines: string[] = [theme.fg("borderMuted", "─".repeat(renderWidth))];
      const tab = (label: string, active: boolean, complete: boolean) => {
        const text = ` ${complete ? "■" : "□"} ${label} `;
        return active
          ? theme.bg("selectedBg", theme.fg("text", `<${text}>`))
          : theme.fg(complete ? "success" : "muted", text);
      };
      const tabs = questions.map((question, index) => tab(question.header, index === state.page, state.isAnswered(index)));
      tabs.push(tab("Submit", state.review, state.allAnswered));
      addWrapped(lines, " ", tabs.join(" "), renderWidth);
      lines.push("");

      if (editing) {
        addWrapped(lines, " ", theme.fg("accent", theme.bold("Write your answer")), renderWidth);
        for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(truncateToWidth(` ${line}`, renderWidth, ""));
        addWrapped(lines, " ", theme.fg("dim", `${confirmKey} to save │ ${cancelKey} to go back`), renderWidth);
      } else if (state.review) {
        addWrapped(lines, " ", theme.fg("accent", theme.bold("Ready to submit")), renderWidth);
        lines.push("");
        for (const question of questions) {
          const answer = state.answers().find((candidate) => candidate.question === question.question);
          addWrapped(lines, " ", `${theme.fg("muted", `${question.header}:`)} ${answer?.answer ?? theme.fg("warning", "Unanswered")}`, renderWidth);
        }
        lines.push("");
        addWrapped(lines, " ", theme.fg(state.allAnswered ? "success" : "warning", state.allAnswered ? `${confirmKey} to submit` : "Answer every question before submitting"), renderWidth);
      } else {
        const question = state.question!;
        addWrapped(lines, " ", theme.fg("accent", theme.bold(question.question)), renderWidth);
        lines.push("");
        question.options.forEach((option, index) => {
          const focused = state.cursor === index;
          const selected = state.selectedIndexes.includes(index);
          const cursor = focused ? theme.fg("accent", "> ") : "  ";
          const mark = question.multiSelect ? `${selected ? "■" : "□"} ` : "";
          const color = focused || selected ? "accent" : "text";
          addWrapped(lines, cursor, theme.fg(color, `${mark}${index + 1}. ${option.label}`), renderWidth);
          addWrapped(lines, question.multiSelect ? "      " : "    ", theme.fg("muted", option.description), renderWidth);
        });
        const customIndex = question.options.length;
        const customCursor = state.cursor === customIndex ? theme.fg("accent", "> ") : "  ";
        const customMark = question.multiSelect ? `${state.customAnswer ? "■" : "□"} ` : "";
        addWrapped(lines, customCursor, theme.fg(state.cursor === customIndex || state.customAnswer ? "accent" : "text", `${customMark}${customIndex + 1}. Other`), renderWidth);
      }

      lines.push("");
      const help = state.review
        ? `${confirmKey} to submit │ ${navigationKeys} to navigate │ ${cancelKey} to cancel`
        : state.question?.multiSelect
          ? `space to toggle │ ${confirmKey} to continue │ ${navigationKeys} to navigate │ ${cancelKey} to cancel`
          : `${confirmKey} to select │ ${navigationKeys} to navigate │ ${cancelKey} to cancel`;
      addWrapped(lines, " ", theme.fg("dim", help), renderWidth);
      lines.push(theme.fg("borderMuted", "─".repeat(renderWidth)));
      const bounded = lines.map((line) => truncateToWidth(line, renderWidth, ""));
      return fitRows(bounded, Math.max(1, (tui.terminal?.rows ?? 30) - 2), theme);
    },
  };
}
