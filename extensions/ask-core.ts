import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { safeDisplayLine, safeDisplayText } from "./text-safety.ts";

export const ASK_LIMITS = {
  header: 12,
  question: 500,
  label: 80,
  description: 240,
  questions: { min: 1, max: 4 },
  options: { min: 2, max: 4 },
  customAnswerBytes: 2_000,
} as const;

export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  header: string;
  question: string;
  options: AskOption[];
  multiSelect: boolean;
}

export interface AskAnswer {
  question: string;
  answer: string;
  optionIndexes: number[];
  custom: boolean;
}

export const CUSTOM_CHOICE = "Other";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const RESERVED_LABELS = new Set(["other", "type something", "write a different answer"]);

function assertLength(value: string, maximum: number, name: string): void {
  const maximumBytes = Math.max(1_024, maximum * 16);
  if (Buffer.byteLength(value, "utf8") > maximumBytes || [...GRAPHEMES.segment(value)].length > maximum) {
    throw new Error(`${name} must be at most ${maximum} characters`);
  }
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? safeDisplayLine(value) : "";
}

export function normalizeQuestions(value: unknown): AskQuestion[] {
  if (!Array.isArray(value) || value.length < ASK_LIMITS.questions.min || value.length > ASK_LIMITS.questions.max) {
    throw new Error(`Ask between ${ASK_LIMITS.questions.min} and ${ASK_LIMITS.questions.max} questions at a time`);
  }

  const prompts = new Set<string>();
  return value.map((entry, questionIndex) => {
    if (!entry || typeof entry !== "object") throw new Error(`Question ${questionIndex + 1} is invalid`);
    const input = entry as Record<string, unknown>;
    const header = normalizedText(input.header);
    const question = normalizedText(input.question);
    if (!header) throw new Error(`Question ${questionIndex + 1} requires a header`);
    if (!question) throw new Error(`Question ${questionIndex + 1} cannot be empty`);
    assertLength(header, ASK_LIMITS.header, `Question ${questionIndex + 1} header`);
    assertLength(question, ASK_LIMITS.question, `Question ${questionIndex + 1}`);
    if (prompts.has(question.toLowerCase())) throw new Error(`Questions must be unique: ${question}`);
    prompts.add(question.toLowerCase());
    if (typeof input.multiSelect !== "boolean") throw new Error(`Question ${questionIndex + 1} requires multiSelect`);
    if (!Array.isArray(input.options) || input.options.length < ASK_LIMITS.options.min || input.options.length > ASK_LIMITS.options.max) {
      throw new Error(`Question ${questionIndex + 1} must provide ${ASK_LIMITS.options.min}-${ASK_LIMITS.options.max} options`);
    }

    const labels = new Set<string>();
    const options = input.options.map((entry, optionIndex): AskOption => {
      if (!entry || typeof entry !== "object") throw new Error(`Option ${optionIndex + 1} for question ${questionIndex + 1} is invalid`);
      const option = entry as Record<string, unknown>;
      const label = normalizedText(option.label);
      const description = normalizedText(option.description);
      if (!label) throw new Error(`Option ${optionIndex + 1} for question ${questionIndex + 1} requires a label`);
      if (!description) throw new Error(`Option ${optionIndex + 1} for question ${questionIndex + 1} requires a description`);
      assertLength(label, ASK_LIMITS.label, `Option ${optionIndex + 1} label`);
      assertLength(description, ASK_LIMITS.description, `Option ${optionIndex + 1} description`);
      const normalized = label.toLowerCase();
      if (RESERVED_LABELS.has(normalized)) throw new Error(`Option label "${label}" is reserved`);
      if (labels.has(normalized)) throw new Error(`Option labels must be unique: ${label}`);
      labels.add(normalized);
      return { label, description };
    });

    return { header, question, options, multiSelect: input.multiSelect };
  });
}

function utf8Prefix(value: string, maximum: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maximum) break;
    bytes += size;
    result += character;
  }
  return result;
}

export function boundCustomAnswer(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const answer = safeDisplayText(value).trim();
  if (!answer) return undefined;
  if (Buffer.byteLength(answer, "utf8") <= ASK_LIMITS.customAnswerBytes) return answer;
  const notice = "\n\n[Answer truncated to fit the ask tool output limit.]";
  return utf8Prefix(answer, ASK_LIMITS.customAnswerBytes - Buffer.byteLength(notice, "utf8")) + notice;
}

function indent(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").join("\n    ");
}

export function formatAnswers(answers: readonly AskAnswer[]): string {
  const lines = ["User answered the clarification questions:"];
  for (const answer of answers) {
    lines.push(`- ${safeDisplayLine(answer.question)}`);
    lines.push(`  Answer: ${indent(safeDisplayText(answer.answer))}`);
  }
  const output = lines.join("\n");
  const notice = "\n\n[Clarification answers truncated to stay within Pi's tool output limits.]";
  const truncated = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice, "utf8"),
    maxLines: DEFAULT_MAX_LINES - 2,
  });
  return truncated.truncated ? truncated.content + notice : output;
}
