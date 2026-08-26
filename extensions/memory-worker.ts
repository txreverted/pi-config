import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CHECKPOINT_SYSTEM_PROMPT, OBSERVER_SYSTEM_PROMPT } from "./memory-prompts.ts";

const role = process.env.PI_CONFIG_MEMORY_WORKER;
const inputPath = process.env.PI_CONFIG_MEMORY_INPUT;
const resultPath = process.env.PI_CONFIG_MEMORY_RESULT;

function enumString<const T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({ type: "string", enum: values });
}

const SourceIds = Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 32 });
const CheckpointText = Type.String({ minLength: 1, maxLength: 4_000 });
const CheckpointItemFields = { text: CheckpointText, sourceEntryIds: SourceIds };
const CheckpointItem = Type.Object(CheckpointItemFields, { additionalProperties: false });

const ObservationSchema = Type.Object({
  kind: enumString(["requirement", "decision", "action", "result", "blocker", "question", "fact"] as const),
  content: Type.String({ minLength: 1, maxLength: 4_000 }),
  sourceEntryIds: SourceIds,
  status: Type.Optional(enumString(["open", "done", "blocked", "superseded"] as const)),
  supersedes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })),
}, { additionalProperties: false });

const CheckpointSchema = Type.Object({
  objective: Type.Optional(CheckpointItem),
  requirements: Type.Array(Type.Object({
    ...CheckpointItemFields,
    status: enumString(["open", "done", "blocked", "superseded"] as const),
    evidence: Type.Optional(CheckpointText),
  }, { additionalProperties: false }), { maxItems: 40 }),
  decisions: Type.Array(Type.Object({
    ...CheckpointItemFields,
    rationale: Type.Optional(CheckpointText),
  }, { additionalProperties: false }), { maxItems: 40 }),
  currentAction: Type.Optional(CheckpointItem),
  completed: Type.Array(CheckpointItem, { maxItems: 40 }),
  verification: Type.Array(Type.Object({
    ...CheckpointItemFields,
    command: Type.Optional(CheckpointText),
    passed: Type.Boolean(),
  }, { additionalProperties: false }), { maxItems: 40 }),
  blockers: Type.Array(Type.Object({
    ...CheckpointItemFields,
    awaitingUser: Type.Boolean(),
  }, { additionalProperties: false }), { maxItems: 40 }),
  phase: enumString(["active", "blocked", "complete"] as const),
}, { additionalProperties: false });

interface WorkerResult {
  role: string;
  payload?: unknown;
  costUsd: number;
}

function atomicWrite(path: string, value: WorkerResult): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export default function memoryWorker(pi: ExtensionAPI): void {
  if ((role !== "observer" && role !== "checkpoint") || !inputPath || !resultPath) {
    throw new Error("Memory worker requires role, input, and result paths");
  }

  const input = readFileSync(inputPath, "utf8");
  let payload: unknown;
  let costUsd = 0;
  const flush = () => atomicWrite(resultPath, { role, ...(payload === undefined ? {} : { payload }), costUsd });
  flush();

  if (role === "observer") {
    pi.registerTool({
      name: "record_observations",
      label: "record observations",
      description: "Record every durable observation from the supplied transcript data, including an empty array when there are none.",
      parameters: Type.Object({ observations: Type.Array(ObservationSchema, { maxItems: 64 }) }, { additionalProperties: false }),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        payload = { observations: params.observations };
        flush();
        return {
          content: [{ type: "text" as const, text: `Recorded ${params.observations.length} observations. Stop now.` }],
          details: { count: params.observations.length },
          terminate: true,
        };
      },
    });
  } else {
    pi.registerTool({
      name: "record_checkpoint",
      label: "record checkpoint",
      description: "Record the complete current task checkpoint derived from the supplied memory data.",
      parameters: CheckpointSchema,
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        payload = params;
        flush();
        return {
          content: [{ type: "text" as const, text: "Recorded the task checkpoint. Stop now." }],
          details: { phase: params.phase },
          terminate: true,
        };
      },
    });
  }

  pi.on("before_agent_start", () => ({
    systemPrompt: role === "observer" ? OBSERVER_SYSTEM_PROMPT : CHECKPOINT_SYSTEM_PROMPT,
    message: {
      customType: "pi-config.memory.worker-input",
      content: input,
      display: false,
    },
  }));

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const total = event.message.usage.cost.total;
    if (Number.isFinite(total) && total > 0) costUsd += total;
  });

  pi.on("agent_end", () => {
    flush();
  });
}
