import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { safeDisplayLine, safeDisplayText } from "./text-safety.ts";

export const ASK_LIMITS = {
  context: 500,
  id: 50,
  header: 12,
  question: 500,
  label: 80,
  description: 240,
  preview: 2_000,
  questions: { min: 1, max: 4 },
  options: { min: 2, max: 5 },
  customAnswerBytes: 2_000,
  outputBytes: DEFAULT_MAX_BYTES,
} as const;

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
  recommended?: boolean;
}

export interface AskQuestion {
  id: string;
  header?: string;
  question: string;
  options?: AskOption[];
  multiSelect?: boolean;
}

export interface AskAnswer {
  id: string;
  question: string;
  answer: string;
  kind: "option" | "custom";
  optionIndex?: number;
  optionIndexes?: number[];
}

export const CUSTOM_CHOICE = "Write a different answer…";

const TIMEOUTS = { "60s": 60_000, "5m": 300_000, "10m": 600_000 } as const;

export function askTimeoutMs(value = process.env.PI_CONFIG_ASK_TIMEOUT): number | undefined {
  if (value === "off") return undefined;
  if (value === undefined || value === "") return TIMEOUTS["5m"];
  if (value in TIMEOUTS) return TIMEOUTS[value as keyof typeof TIMEOUTS];
  throw new Error("PI_CONFIG_ASK_TIMEOUT must be off, 60s, 5m, or 10m");
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const RESERVED_LABELS = new Set([
  "other",
  "type something",
  "type something.",
  "write a different answer",
  "write a different answer…",
]);

function normalizedLabel(value: string): string {
  return safeDisplayLine(value).toLowerCase();
}

function assertLength(value: string, limit: number, name: string): void {
  if ([...GRAPHEMES.segment(value)].length > limit) throw new Error(`${name} must be at most ${limit} characters`);
}

export function normalizeContext(value: string): string {
  const context = safeDisplayLine(value);
  if (!context) throw new Error("Question context cannot be empty after sanitation");
  assertLength(context, ASK_LIMITS.context, "Question context");
  return context;
}

export function normalizeQuestions(input: readonly AskQuestion[]): AskQuestion[] {
  if (input.length < ASK_LIMITS.questions.min || input.length > ASK_LIMITS.questions.max) {
    throw new Error(`Ask between ${ASK_LIMITS.questions.min} and ${ASK_LIMITS.questions.max} questions at a time`);
  }

  const ids = new Set<string>();
  return input.map((question, questionIndex) => {
    const id = safeDisplayLine(question.id);
    const header = question.header === undefined ? undefined : safeDisplayLine(question.header);
    const prompt = safeDisplayLine(question.question);
    if (!id) throw new Error(`Question ${questionIndex + 1} requires an id`);
    assertLength(id, ASK_LIMITS.id, `Question ${questionIndex + 1} id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new Error(`Question ${questionIndex + 1} id may contain only letters, digits, dots, underscores, and hyphens`);
    }
    if (ids.has(id)) throw new Error(`Question ids must be unique: ${id}`);
    ids.add(id);
    if (question.header !== undefined && !header) throw new Error(`Question ${id} has an empty header after sanitation`);
    if (header) assertLength(header, ASK_LIMITS.header, `Question ${id} header`);
    if (!prompt) throw new Error(`Question ${id} cannot be empty`);
    assertLength(prompt, ASK_LIMITS.question, `Question ${id}`);
    if (question.multiSelect && question.options === undefined) throw new Error(`Question ${id} cannot use multiSelect without options`);

    if (question.options === undefined) return { id, ...(header ? { header } : {}), question: prompt };
    if (question.options.length < ASK_LIMITS.options.min || question.options.length > ASK_LIMITS.options.max) {
      throw new Error(`Question ${id} must provide ${ASK_LIMITS.options.min}-${ASK_LIMITS.options.max} options, or omit options for a free-form answer`);
    }

    const labels = new Set<string>();
    let recommendedCount = 0;
    const options = question.options.map((option, optionIndex) => {
      const label = safeDisplayLine(option.label);
      const description = option.description === undefined ? undefined : safeDisplayLine(option.description);
      const preview = option.preview === undefined ? undefined : safeDisplayText(option.preview).trim();
      const normalized = normalizedLabel(label);
      if (!label) throw new Error(`Option ${optionIndex + 1} for ${id} requires a label`);
      assertLength(label, ASK_LIMITS.label, `Option ${optionIndex + 1} label for ${id}`);
      if (option.description !== undefined && !description) {
        throw new Error(`Option ${optionIndex + 1} for ${id} has an empty description after sanitation`);
      }
      if (description) assertLength(description, ASK_LIMITS.description, `Option ${optionIndex + 1} description for ${id}`);
      if (option.preview !== undefined && !preview) {
        throw new Error(`Option ${optionIndex + 1} for ${id} has an empty preview after sanitation`);
      }
      if (preview) assertLength(preview, ASK_LIMITS.preview, `Option ${optionIndex + 1} preview for ${id}`);
      if (RESERVED_LABELS.has(normalized)) {
        throw new Error(`Option label "${label}" is reserved; the tool adds a custom-answer choice automatically`);
      }
      if (labels.has(normalized)) throw new Error(`Option labels for ${id} must be unique: ${label}`);
      labels.add(normalized);
      if (option.recommended) recommendedCount++;
      return {
        label,
        ...(description ? { description } : {}),
        ...(preview ? { preview } : {}),
        ...(option.recommended ? { recommended: true } : {}),
      };
    });
    if (recommendedCount > 1) throw new Error(`Question ${id} may recommend at most one option`);

    return {
      id,
      ...(header ? { header } : {}),
      question: prompt,
      options,
      ...(question.multiSelect ? { multiSelect: true } : {}),
    };
  });
}

export function optionDisplay(option: AskOption): string {
  const recommendation = option.recommended ? " (recommended)" : "";
  const description = option.description ? ` — ${option.description}` : "";
  return `${option.label}${recommendation}${description}`;
}

function indent(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").join("\n    ");
}

function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
}

export function boundCustomAnswer(value: string): string | undefined {
  const sanitized = safeDisplayText(value).trim();
  if (!sanitized) return undefined;
  if (Buffer.byteLength(sanitized, "utf8") <= ASK_LIMITS.customAnswerBytes) return sanitized;

  const notice = "\n\n[Custom answer truncated to fit the clarification tool output limit.]";
  return `${utf8Prefix(sanitized, ASK_LIMITS.customAnswerBytes - Buffer.byteLength(notice, "utf8"))}${notice}`;
}

export function formatAnswers(answers: readonly AskAnswer[], notes?: string): string {
  const lines = ["User answered the clarification questions:"];
  for (const answer of answers) {
    lines.push(`- ${safeDisplayLine(answer.id)}: ${safeDisplayLine(answer.question)}`);
    lines.push(`  Answer: ${indent(safeDisplayText(answer.answer))}`);
  }

  if (notes) {
    lines.push("- General notes:");
    lines.push(`  ${indent(safeDisplayText(notes))}`);
  }

  const formatted = lines.join("\n");
  const notice = "\n\n[Clarification answers truncated to stay within Pi's tool output limits.]";
  const truncated = truncateHead(formatted, {
    maxBytes: ASK_LIMITS.outputBytes - Buffer.byteLength(notice, "utf8"),
    maxLines: DEFAULT_MAX_LINES - 2,
  });
  return truncated.truncated ? `${truncated.content}${notice}` : formatted;
}
