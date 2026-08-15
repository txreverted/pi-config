export interface AskOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AskQuestion {
  id: string;
  question: string;
  options?: AskOption[];
}

export interface AskAnswer {
  id: string;
  question: string;
  answer: string;
  kind: "option" | "custom";
  optionIndex?: number;
}

export const CUSTOM_CHOICE = "Write a different answer…";

const RESERVED_LABELS = new Set([
  "other",
  "type something",
  "type something.",
  "write a different answer",
  "write a different answer…",
]);

function normalizedLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeQuestions(input: readonly AskQuestion[]): AskQuestion[] {
  if (input.length < 1 || input.length > 4) throw new Error("Ask between 1 and 4 questions at a time");

  const ids = new Set<string>();
  return input.map((question, questionIndex) => {
    const id = question.id.trim();
    const prompt = question.question.trim();
    if (!id) throw new Error(`Question ${questionIndex + 1} requires an id`);
    if (ids.has(id)) throw new Error(`Question ids must be unique: ${id}`);
    ids.add(id);
    if (!prompt) throw new Error(`Question ${id} cannot be empty`);

    if (question.options === undefined) return { id, question: prompt };
    if (question.options.length < 2 || question.options.length > 5) {
      throw new Error(`Question ${id} must provide 2-5 options, or omit options for a free-form answer`);
    }

    const labels = new Set<string>();
    let recommendedCount = 0;
    const options = question.options.map((option, optionIndex) => {
      const label = option.label.trim();
      const description = option.description?.trim();
      const normalized = normalizedLabel(label);
      if (!label) throw new Error(`Option ${optionIndex + 1} for ${id} requires a label`);
      if (RESERVED_LABELS.has(normalized)) {
        throw new Error(`Option label "${label}" is reserved; the tool adds a custom-answer choice automatically`);
      }
      if (labels.has(normalized)) throw new Error(`Option labels for ${id} must be unique: ${label}`);
      labels.add(normalized);
      if (option.recommended) recommendedCount++;
      return {
        label,
        ...(description ? { description } : {}),
        ...(option.recommended ? { recommended: true } : {}),
      };
    });
    if (recommendedCount > 1) throw new Error(`Question ${id} may recommend at most one option`);

    return { id, question: prompt, options };
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

export function formatAnswers(answers: readonly AskAnswer[]): string {
  const lines = ["User answered the clarification questions:"];
  for (const answer of answers) {
    lines.push(`- ${answer.id}: ${answer.question}`);
    lines.push(`  Answer: ${indent(answer.answer)}`);
  }
  return lines.join("\n");
}
