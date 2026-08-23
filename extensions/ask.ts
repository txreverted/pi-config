import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ASK_LIMITS,
  AskState,
  CUSTOM_ANSWER_LIMIT_TEXT,
  CUSTOM_CHOICE,
  boundCustomAnswer,
  formatAnswers,
  normalizeQuestions,
  type AskAnswer,
  type AskOption,
  type AskQuestion,
} from "./ask-core.ts";

const TOOL_NAME = "ask_user_question";

const OptionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: ASK_LIMITS.label, description: "Choice label" }),
  description: Type.String({ minLength: 1, maxLength: ASK_LIMITS.description, description: "Meaning or main trade-off" }),
}, { additionalProperties: false });

const QuestionSchema = Type.Object({
  header: Type.String({ minLength: 1, maxLength: ASK_LIMITS.header, description: "Short question label" }),
  question: Type.String({ minLength: 1, maxLength: ASK_LIMITS.question, description: "Question to display" }),
  options: Type.Array(OptionSchema, {
    minItems: ASK_LIMITS.options.min,
    maxItems: ASK_LIMITS.options.max,
    description: "Choices; Other is added automatically",
  }),
  multiSelect: Type.Boolean({ description: "Allow multiple choices" }),
}, { additionalProperties: false });

interface AskDetails {
  questions: AskQuestion[];
  answers: AskAnswer[];
  cancelled: boolean;
}

interface AskDialogResult {
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
  const written = await ctx.ui.input(prompt, `Up to ${CUSTOM_ANSWER_LIMIT_TEXT}`, signal ? { signal } : undefined);
  if (written === undefined || signal?.aborted) return null;
  if (typeof written !== "string") throw new Error("Ask UI returned an invalid custom answer");
  return boundCustomAnswer(written);
}

async function askQuestions(questions: AskQuestion[], signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<AskDialogResult> {
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
    const other = `${state.customAnswer ? "■" : "□"} ${CUSTOM_CHOICE}`;

    if (!question.multiSelect) {
      const selected = await ctx.ui.select(prompt, [...choices, other], dialogOptions);
      if (selected === undefined || signal?.aborted) return { answers: [], cancelled: true };
      if (selected === other) {
        const answer = await customAnswer(ctx, `${questionIndex + 1}/${questions.length} │ ${CUSTOM_CHOICE}`, signal);
        if (answer === null) return { answers: [], cancelled: true };
        state.write(answer);
        if (!answer) continue;
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
    description: `Ask 1-4 interactive questions with 2-4 choices, single or multi-select, and automatic Other answers limited to ${CUSTOM_ANSWER_LIMIT_TEXT}. TUI or RPC only.`,
    promptSnippet: "Ask structured questions when missing intent would change the work",
    promptGuidelines: [
      "Inspect available evidence first; use ask_user_question only when missing intent would materially change the work.",
      "Group consequential questions; use a safe reversible default for trivial uncertainty.",
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

      const result = await askQuestions(questions, signal, ctx);

      if (result.cancelled || result.answers.length !== questions.length) return cancelledResult(questions);
      return {
        content: [{ type: "text" as const, text: formatAnswers(result.answers) }],
        details: { questions, answers: result.answers, cancelled: false } satisfies AskDetails,
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") return;
    const active = pi.getActiveTools();
    if (active.includes(TOOL_NAME)) pi.setActiveTools(active.filter((name) => name !== TOOL_NAME));
  });
}
