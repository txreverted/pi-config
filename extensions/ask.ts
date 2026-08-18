import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  ASK_LIMITS,
  AskState,
  CUSTOM_CHOICE,
  boundCustomAnswer,
  formatAnswers,
  normalizeQuestions,
  type AskAnswer,
  type AskOption,
  type AskQuestion,
} from "./ask-core.ts";
import { createAskComponent, type AskUiResult } from "./ask-ui.ts";
import { normalizeDisplayText } from "./text-safety.ts";

const TOOL_NAME = "ask_user_question";

const OptionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: ASK_LIMITS.label, description: "Concise option label" }),
  description: Type.String({ minLength: 1, maxLength: ASK_LIMITS.description, description: "What this choice means or its main trade-off" }),
}, { additionalProperties: false });

const QuestionSchema = Type.Object({
  header: Type.String({ minLength: 1, maxLength: ASK_LIMITS.header, description: "Short tab label, maximum 12 characters" }),
  question: Type.String({ minLength: 1, maxLength: ASK_LIMITS.question, description: "Complete question to display" }),
  options: Type.Array(OptionSchema, {
    minItems: ASK_LIMITS.options.min,
    maxItems: ASK_LIMITS.options.max,
    description: "Choices to present. The tool adds Other automatically.",
  }),
  multiSelect: Type.Boolean({ description: "Allow more than one choice" }),
}, { additionalProperties: false });

interface AskDetails {
  questions: AskQuestion[];
  answers: AskAnswer[];
  cancelled: boolean;
}

function title(question: AskQuestion, index: number, total: number): string {
  return `${index + 1}/${total} │ ${question.header}: ${question.question}`;
}

function optionText(option: AskOption, index: number, selected = false): string {
  return `${selected ? "■" : "□"} ${index + 1}. ${option.label} │ ${option.description}`;
}

function cancelledResult(questions: AskQuestion[]) {
  return {
    content: [{ type: "text" as const, text: "User cancelled the clarification questions. Do not infer answers from the cancellation." }],
    details: { questions, answers: [], cancelled: true } satisfies AskDetails,
  };
}

async function customAnswer(ctx: ExtensionContext, prompt: string, signal: AbortSignal | undefined): Promise<string | undefined | null> {
  const written = await ctx.ui.input(prompt, "Type your answer", signal ? { signal } : undefined);
  if (written === undefined || signal?.aborted) return null;
  if (typeof written !== "string") throw new Error("Ask UI returned an invalid custom answer");
  return boundCustomAnswer(written);
}

async function askRpc(questions: AskQuestion[], signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<AskUiResult> {
  const state = new AskState(questions);
  const dialogOptions = signal ? { signal } : undefined;
  let returnToReview = false;
  const advance = () => {
    if (returnToReview) {
      returnToReview = false;
      state.goTo(questions.length);
    } else {
      state.movePage(1);
    }
  };
  while (true) {
    if (state.review) {
      const edits = questions.map((question, index) => `Edit ${index + 1}/${questions.length} │ ${question.header}`);
      const submit = "Submit answers";
      const selected = await ctx.ui.select("Review answers", [...edits, submit], dialogOptions);
      if (selected === undefined || signal?.aborted) return { answers: [], cancelled: true };
      if (selected === submit) {
        if (state.allAnswered) return { answers: state.answers(), cancelled: false };
        continue;
      }
      const editIndex = edits.indexOf(selected);
      if (editIndex < 0) throw new Error("Selected review action is invalid");
      state.goTo(editIndex);
      returnToReview = true;
      continue;
    }

    const question = state.question!;
    const questionIndex = state.page;
    const prompt = title(question, questionIndex, questions.length);
    const choices = question.options.map((option, optionIndex) =>
      optionText(option, optionIndex, state.selectedIndexes.includes(optionIndex)));
    const other = `└─ ${state.customAnswer ? "■" : "□"} ${CUSTOM_CHOICE}`;

    if (!question.multiSelect) {
      const selected = await ctx.ui.select(prompt, [...choices, other], dialogOptions);
      if (selected === undefined || signal?.aborted) return { answers: [], cancelled: true };
      if (selected === other) {
        const answer = await customAnswer(ctx, `${questionIndex + 1}/${questions.length} │ ${CUSTOM_CHOICE}`, signal);
        if (answer === null) return { answers: [], cancelled: true };
        if (!answer) continue;
        state.write(answer);
      } else {
        const optionIndex = choices.indexOf(selected);
        if (optionIndex < 0) throw new Error("Selected answer no longer matches the available options");
        state.choose(optionIndex);
      }
      advance();
      continue;
    }

    const done = `Done (${state.selectedIndexes.length + (state.customAnswer ? 1 : 0)} selected)`;
    const selected = await ctx.ui.select(prompt, [...choices, other, done], dialogOptions);
    if (selected === undefined || signal?.aborted) return { answers: [], cancelled: true };
    if (selected === done) {
      if (!state.isAnswered(questionIndex)) continue;
      advance();
      continue;
    }
    if (selected === other) {
      const answer = await customAnswer(ctx, `${questionIndex + 1}/${questions.length} │ ${CUSTOM_CHOICE}`, signal);
      if (answer === null) return { answers: [], cancelled: true };
      state.write(answer);
      continue;
    }
    const optionIndex = choices.indexOf(selected);
    if (optionIndex < 0) throw new Error("Selected answer no longer matches the available options");
    state.choose(optionIndex);
  }
}

export default function askExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "ask user",
    description: "Ask the user 1-4 Claude Code-like clarification questions. Each question has 2-4 explained choices, supports one or multiple selections, and includes an automatic Other answer. Requires interactive TUI or RPC UI.",
    promptSnippet: "Ask the user structured clarification questions before making consequential assumptions",
    promptGuidelines: [
      "Use ask_user_question before implementation when missing product intent, scope, constraints, priorities, UX, or acceptance criteria would materially change the work.",
      "Before using ask_user_question, inspect available code and documentation so you do not ask for facts you can determine yourself.",
      "Do not use ask_user_question for trivial uncertainties or choices that project conventions resolve; use a safe reversible default instead.",
      "Group related questions into one ask_user_question call and explain each option's main trade-off.",
      "Use ask_user_question in the parent before parallel_agents when delegated acceptance criteria or write ownership depend on missing user intent.",
    ],
    parameters: Type.Object({
      questions: Type.Array(QuestionSchema, {
        minItems: ASK_LIMITS.questions.min,
        maxItems: ASK_LIMITS.questions.max,
      }),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
        throw new Error("ask_user_question requires an interactive TUI or RPC client");
      }
      const questions = normalizeQuestions(params.questions);
      if (signal?.aborted) return cancelledResult(questions);

      let result: AskUiResult;
      if (ctx.mode === "rpc") {
        result = await askRpc(questions, signal, ctx);
      } else {
        let abort: (() => void) | undefined;
        try {
          result = await ctx.ui.custom<AskUiResult>((tui, theme, keybindings, done) => {
            const component = createAskComponent(tui, theme, keybindings, questions, done);
            abort = () => done(component.snapshot(true));
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) queueMicrotask(abort);
            return component;
          });
        } finally {
          if (abort) signal?.removeEventListener("abort", abort);
        }
      }

      if (result.cancelled || result.answers.length !== questions.length) return cancelledResult(questions);
      return {
        content: [{ type: "text" as const, text: formatAnswers(result.answers) }],
        details: { questions, answers: result.answers, cancelled: false } satisfies AskDetails,
      };
    },
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") return;
    const active = pi.getActiveTools();
    if (active.includes(TOOL_NAME)) pi.setActiveTools(active.filter((name) => name !== TOOL_NAME));
  });
}
