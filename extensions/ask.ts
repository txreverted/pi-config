import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  ASK_LIMITS,
  CUSTOM_CHOICE,
  boundCustomAnswer,
  formatAnswers,
  normalizeContext,
  normalizeQuestions,
  optionDisplay,
  type AskAnswer,
  type AskQuestion,
} from "./ask-core.ts";
import { normalizeDisplayText } from "./ui-core.ts";

const TOOL_NAME = "ask_user_question";

const OptionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: ASK_LIMITS.label, description: "Concise option label" }),
  description: Type.Optional(
    Type.String({ minLength: 1, maxLength: ASK_LIMITS.description, description: "What this choice means or its main trade-off" }),
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
  question: Type.String({ minLength: 1, maxLength: ASK_LIMITS.question, description: "Clear question for the user" }),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      minItems: ASK_LIMITS.options.min,
      maxItems: ASK_LIMITS.options.max,
      description: "Choices to present. Omit for a free-form question; a custom-answer choice is always added.",
    }),
  ),
});

interface AskDetails {
  context?: string;
  questions: AskQuestion[];
  answers: AskAnswer[];
  cancelled: boolean;
}

function questionTitle(context: string | undefined, question: AskQuestion, index: number, total: number): string {
  const prefix = context && index === 0 ? `${context}\n\n` : "";
  return `${prefix}${index + 1}/${total} · ${question.question}`;
}

export default function askExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "ask user",
    description: "Ask the user 1-4 clarification questions when missing product intent, constraints, priorities, acceptance criteria, or preferences would materially change the work. Questions may offer 2-5 explained choices or accept a free-form answer. The user can always write a custom answer or cancel the questionnaire.",
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
      const askCustomAnswer = async (title: string): Promise<string | undefined> => {
        if (signal?.aborted) return undefined;
        const written = ctx.mode === "rpc"
          ? await ctx.ui.input(title, "", { signal })
          : await ctx.ui.editor(title, "");
        return written === undefined || signal?.aborted ? undefined : boundCustomAnswer(written);
      };

      for (let index = 0; index < questions.length; index++) {
        const question = questions[index];
        const title = questionTitle(context, question, index, questions.length);

        if (!question.options) {
          const answer = await askCustomAnswer(title);
          if (answer === undefined) {
            return {
              content: [{ type: "text", text: "User cancelled the clarification questionnaire. Do not infer answers from the cancellation." }],
              details: { context, questions, answers: [], cancelled: true } satisfies AskDetails,
            };
          }
          answers.push({
            id: question.id,
            question: question.question,
            answer,
            kind: "custom",
          });
          continue;
        }

        const choices = question.options.map((option, optionIndex) => `${optionIndex + 1}. ${optionDisplay(option)}`);
        const customChoice = `${choices.length + 1}. ${CUSTOM_CHOICE}`;
        choices.push(customChoice);
        const selected = await ctx.ui.select(title, choices, { signal });
        if (selected === undefined) {
          return {
            content: [{ type: "text", text: "User cancelled the clarification questionnaire. Do not infer answers from the cancellation." }],
            details: { context, questions, answers: [], cancelled: true } satisfies AskDetails,
          };
        }

        if (selected === customChoice) {
          const answer = await askCustomAnswer(`${index + 1}/${questions.length} · Write your answer`);
          if (answer === undefined) {
            return {
              content: [{ type: "text", text: "User cancelled the clarification questionnaire. Do not infer answers from the cancellation." }],
              details: { context, questions, answers: [], cancelled: true } satisfies AskDetails,
            };
          }
          answers.push({
            id: question.id,
            question: question.question,
            answer,
            kind: "custom",
          });
          continue;
        }

        const optionIndex = choices.indexOf(selected);
        const option = question.options[optionIndex];
        if (!option) throw new Error("Selected answer no longer matches the available options");
        answers.push({
          id: question.id,
          question: question.question,
          answer: option.label,
          kind: "option",
          optionIndex: optionIndex + 1,
        });
      }

      return {
        content: [{ type: "text", text: formatAnswers(answers) }],
        details: { context, questions, answers, cancelled: false } satisfies AskDetails,
      };
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
