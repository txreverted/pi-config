import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  ASK_LIMITS,
  CUSTOM_CHOICE,
  askTimeoutMs,
  boundCustomAnswer,
  formatAnswers,
  normalizeContext,
  normalizeQuestions,
  optionDisplay,
  type AskAnswer,
  type AskQuestion,
} from "./ask-core.ts";
import { createAskComponent, type AskUiResult } from "./ask-ui.ts";
import { normalizeDisplayText } from "./ui-core.ts";

const TOOL_NAME = "ask_user_question";

const OptionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: ASK_LIMITS.label, description: "Concise option label" }),
  description: Type.Optional(
    Type.String({ minLength: 1, maxLength: ASK_LIMITS.description, description: "What this choice means or its main trade-off" }),
  ),
  preview: Type.Optional(
    Type.String({ minLength: 1, maxLength: ASK_LIMITS.preview, description: "Optional bounded Markdown preview for this choice" }),
  ),
  recommended: Type.Optional(Type.Boolean({ description: "Mark this as the recommended choice; at most one per question" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    maxLength: ASK_LIMITS.id,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
    description: "Short unique identifier, such as scope or storage",
  }),
  header: Type.Optional(Type.String({ minLength: 1, maxLength: ASK_LIMITS.header, description: "Short question tab label (maximum 12 graphemes)" })),
  question: Type.String({ minLength: 1, maxLength: ASK_LIMITS.question, description: "Clear question for the user" }),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      minItems: ASK_LIMITS.options.min,
      maxItems: ASK_LIMITS.options.max,
      description: "Choices to present. Omit for a free-form question; a custom-answer choice is always added.",
    }),
  ),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting more than one option" })),
});

interface AskDetails {
  context?: string;
  questions: AskQuestion[];
  answers: AskAnswer[];
  notes?: string;
  cancelled: boolean;
  timedOut: boolean;
}

function questionTitle(context: string | undefined, question: AskQuestion, index: number, total: number): string {
  const prefix = context && index === 0 ? `${context}\n\n` : "";
  const header = question.header ? `${question.header}: ` : "";
  return `${prefix}${index + 1}/${total} · ${header}${question.question}`;
}

function stoppedResult(
  context: string | undefined,
  questions: AskQuestion[],
  answers: AskAnswer[],
  timedOut: boolean,
  notes?: string,
) {
  const preserved = timedOut ? answers : [];
  const preservedNotes = timedOut ? notes : undefined;
  return {
    content: [{ type: "text" as const, text: timedOut
      ? `${formatAnswers(preserved, preservedNotes)}\n\nThe clarification questionnaire timed out. Keep the answers above, but do not infer missing answers.`
      : "User cancelled the clarification questionnaire. Do not infer answers from the cancellation." }],
    details: {
      context,
      questions,
      answers: preserved,
      ...(preservedNotes ? { notes: preservedNotes } : {}),
      cancelled: !timedOut,
      timedOut,
    } satisfies AskDetails,
  };
}

export default function askExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "ask user",
    description: "Ask the user 1-4 clarification questions when missing product intent, constraints, priorities, acceptance criteria, or preferences would materially change the work. Questions may offer 2-5 explained choices, allow multiple selections, or accept a free-form answer. The user can review, add notes, submit, or cancel the questionnaire.",
    promptSnippet: "Ask the user structured clarification questions before making consequential assumptions",
    promptGuidelines: [
      "Use ask_user_question before implementation when ambiguity about product intent, scope, constraints, UX, priorities, or acceptance criteria would materially change the result.",
      "Before using ask_user_question, inspect the repository and available documentation so you do not ask the user for facts you can determine yourself.",
      "Do not use ask_user_question for trivial uncertainties or choices that project conventions clearly resolve; proceed with a safe, reversible default instead.",
      "Group related clarification questions into one ask_user_question call (maximum four), explain option trade-offs, and mark at most one genuinely recommended option per question.",
      "Never author an Other or custom-answer option in ask_user_question; the tool always adds one automatically.",
    ],
    parameters: Type.Object({
      context: Type.Optional(
        Type.String({ minLength: 1, maxLength: ASK_LIMITS.context, description: "Brief explanation of why these decisions are needed" }),
      ),
      questions: Type.Array(QuestionSchema, {
        minItems: ASK_LIMITS.questions.min,
        maxItems: ASK_LIMITS.questions.max,
        description: "Related questions to ask in one interaction",
      }),
    }),
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("ask_user_question requires an interactive TUI or RPC client");

      const context = params.context === undefined ? undefined : normalizeContext(params.context);
      const questions = normalizeQuestions(params.questions as AskQuestion[]);
      const answers: AskAnswer[] = [];
      let notes: string | undefined;
      let timedOut = false;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timeout = askTimeoutMs();
      const timer = timeout === undefined ? undefined : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
      const dialogOptions = {
        signal: controller.signal,
        ...(timeout === undefined ? {} : { timeout }),
      };

      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      const askText = async (title: string, initial = ""): Promise<string | undefined> => {
        if (controller.signal.aborted) return undefined;
        const written = ctx.mode === "rpc"
          ? await ctx.ui.input(title, initial, dialogOptions)
          : await ctx.ui.editor(title, initial);
        return written === undefined || controller.signal.aborted ? undefined : boundCustomAnswer(written);
      };

      try {
        if (ctx.mode === "tui") {
          const result = await ctx.ui.custom<AskUiResult>((tui, theme, keybindings, done) => {
            const component = createAskComponent(tui, theme, keybindings, questions, context, done);
            const finishAbort = () => done(component.snapshot(true, timedOut));
            controller.signal.addEventListener("abort", finishAbort, { once: true });
            if (controller.signal.aborted) queueMicrotask(finishAbort);
            return component;
          });
          const boundedAnswers = result.answers.flatMap((answer) => {
            const bounded = boundCustomAnswer(answer.answer);
            return bounded ? [{ ...answer, answer: bounded }] : [];
          });
          const boundedNotes = result.notes === undefined ? undefined : boundCustomAnswer(result.notes);
          if (result.cancelled || result.timedOut) return stoppedResult(context, questions, boundedAnswers, result.timedOut, boundedNotes);
          return {
            content: [{ type: "text" as const, text: formatAnswers(boundedAnswers, boundedNotes) }],
            details: { context, questions, answers: boundedAnswers, ...(boundedNotes ? { notes: boundedNotes } : {}), cancelled: false, timedOut: false } satisfies AskDetails,
          };
        }

        for (let index = 0; index < questions.length; index++) {
          const question = questions[index];
          const title = questionTitle(context, question, index, questions.length);
          if (!question.options) {
            const answer = await askText(title);
            if (answer === undefined) return stoppedResult(context, questions, answers, timedOut, notes);
            answers.push({ id: question.id, question: question.question, answer, kind: "custom" });
            continue;
          }

          if (question.multiSelect) {
            const selected = new Set<number>();
            let custom: string | undefined;
            while (true) {
              const choices = question.options.map((option, optionIndex) => `${selected.has(optionIndex) ? "[x]" : "[ ]"} ${optionIndex + 1}. ${optionDisplay(option)}`);
              const customChoice = `${custom ? "[x]" : "[ ]"} ${CUSTOM_CHOICE}`;
              const doneChoice = `Done selecting (${selected.size + (custom ? 1 : 0)})`;
              choices.push(customChoice, doneChoice);
              const selectedChoice = await ctx.ui.select(title, choices, dialogOptions);
              if (selectedChoice === undefined || controller.signal.aborted) return stoppedResult(context, questions, answers, timedOut, notes);
              if (selectedChoice === doneChoice) {
                if (selected.size === 0 && !custom) continue;
                const indexes = [...selected].sort((a, b) => a - b);
                const labels = indexes.map((optionIndex) => question.options![optionIndex].label);
                if (custom) labels.push(custom);
                answers.push({ id: question.id, question: question.question, answer: labels.join(", "), kind: indexes.length ? "option" : "custom", optionIndexes: indexes.map((optionIndex) => optionIndex + 1) });
                break;
              }
              if (selectedChoice === customChoice) {
                const answer = await askText(`${index + 1}/${questions.length} · Write your answer`, custom ?? "");
                if (answer === undefined) return stoppedResult(context, questions, answers, timedOut, notes);
                custom = answer;
                continue;
              }
              const optionIndex = choices.indexOf(selectedChoice);
              selected.has(optionIndex) ? selected.delete(optionIndex) : selected.add(optionIndex);
            }
            continue;
          }

          const choices = question.options.map((option, optionIndex) => `${optionIndex + 1}. ${optionDisplay(option)}`);
          const customChoice = `${choices.length + 1}. ${CUSTOM_CHOICE}`;
          choices.push(customChoice);
          const selected = await ctx.ui.select(title, choices, dialogOptions);
          if (selected === undefined || controller.signal.aborted) return stoppedResult(context, questions, answers, timedOut, notes);
          if (selected === customChoice) {
            const answer = await askText(`${index + 1}/${questions.length} · Write your answer`);
            if (answer === undefined) return stoppedResult(context, questions, answers, timedOut, notes);
            answers.push({ id: question.id, question: question.question, answer, kind: "custom" });
            continue;
          }
          const optionIndex = choices.indexOf(selected);
          const option = question.options[optionIndex];
          if (!option) throw new Error("Selected answer no longer matches the available options");
          answers.push({ id: question.id, question: question.question, answer: option.label, kind: "option", optionIndex: optionIndex + 1 });
        }

        if (ctx.mode === "rpc") {
          while (true) {
            const review = await ctx.ui.select("Review clarification answers", ["Submit answers", "Add general notes…"], dialogOptions);
            if (review === undefined || controller.signal.aborted) return stoppedResult(context, questions, answers, timedOut, notes);
            if (review === "Submit answers") break;
            if (review === "Add general notes…") {
              const written = await askText("General notes", notes ?? "");
              if (written === undefined) return stoppedResult(context, questions, answers, timedOut, notes);
              notes = written;
              continue;
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: formatAnswers(answers, notes) }],
          details: { context, questions, answers, ...(notes ? { notes } : {}), cancelled: false, timedOut: false } satisfies AskDetails,
        };
      } finally {
        cleanup();
      }
    },
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) return;
    const active = pi.getActiveTools();
    if (active.includes(TOOL_NAME)) pi.setActiveTools(active.filter((name) => name !== TOOL_NAME));
  });
}
