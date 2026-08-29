import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

export const CONTINUITY_TYPES = {
  checkpoint: "pi-config/continuity-checkpoint",
  policy: "pi-config/continuity-policy",
  resume: "pi-config/continuity-resume",
  capsule: "pi-config/continuity-capsule",
} as const;

export type TaskStatus = "unknown" | "working" | "blocked" | "waiting" | "done";
export type CheckCategory = "test" | "build" | "lint" | "typecheck" | "other";

export interface ContinuityFile {
  path: string;
  action: "read" | "created" | "modified" | "deleted";
  sourceEntryIds: string[];
}

export interface ContinuityCheck {
  command: string;
  category: CheckCategory;
  status: "unknown" | "passed" | "failed";
  sourceEntryIds: string[];
}

export interface ContinuityCheckpoint {
  schema: 1;
  id: string;
  taskId: string;
  revision: string;
  status: TaskStatus;
  goal?: string;
  currentAction?: string;
  nextActions: string[];
  doneWhen: string[];
  blockers: string[];
  constraints: string[];
  decisions: string[];
  rejectedApproaches: string[];
  completed: string[];
  files: ContinuityFile[];
  checks: ContinuityCheck[];
  preferences: string[];
  environment: string[];
  sourceEntryIds: string[];
  createdAt: string;
  origin: "automatic" | "agent" | "compaction";
}

const TaskStatusSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("working"),
  Type.Literal("blocked"),
  Type.Literal("waiting"),
  Type.Literal("done"),
]);
const CheckCategorySchema = Type.Union([
  Type.Literal("test"),
  Type.Literal("build"),
  Type.Literal("lint"),
  Type.Literal("typecheck"),
  Type.Literal("other"),
]);
const SourceEntryIdsSchema = Type.Array(Type.String());

export const ContinuityCheckpointSchema = Type.Object({
  schema: Type.Literal(1),
  id: Type.String(),
  taskId: Type.String(),
  revision: Type.String(),
  status: TaskStatusSchema,
  goal: Type.Optional(Type.String()),
  currentAction: Type.Optional(Type.String()),
  nextActions: Type.Array(Type.String()),
  doneWhen: Type.Array(Type.String()),
  blockers: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  decisions: Type.Array(Type.String()),
  rejectedApproaches: Type.Array(Type.String()),
  completed: Type.Array(Type.String()),
  files: Type.Array(Type.Object({
    path: Type.String(),
    action: Type.Union([
      Type.Literal("read"),
      Type.Literal("created"),
      Type.Literal("modified"),
      Type.Literal("deleted"),
    ]),
    sourceEntryIds: SourceEntryIdsSchema,
  }, { additionalProperties: false })),
  checks: Type.Array(Type.Object({
    command: Type.String(),
    category: CheckCategorySchema,
    status: Type.Union([Type.Literal("unknown"), Type.Literal("passed"), Type.Literal("failed")]),
    sourceEntryIds: SourceEntryIdsSchema,
  }, { additionalProperties: false })),
  preferences: Type.Array(Type.String()),
  environment: Type.Array(Type.String()),
  sourceEntryIds: SourceEntryIdsSchema,
  createdAt: Type.String(),
  origin: Type.Union([Type.Literal("automatic"), Type.Literal("agent"), Type.Literal("compaction")]),
}, { additionalProperties: false });

export interface IndexedEntry {
  sessionId: string;
  entryId: string;
  parentId: string | null;
  ordinal: number;
  timestamp: string;
  role: string;
  toolName?: string;
  isError: boolean;
  text: string;
  filePaths: string[];
}

export interface RecallHit extends IndexedEntry {
  score: number;
}

export interface ContinuityConfig {
  enabled: boolean;
  storage: { retentionDays: number; maxTotalBytes: number };
  retrieval: {
    enabled: boolean;
    maxHits: number;
    maxChars: number;
    autoExpandHits: number;
    excludeRecentEntries: number;
  };
  capsule: { maxChars: number };
  toolOutput: {
    enabled: boolean;
    minChars: number;
    errorMinChars: number;
    keepRecentEntries: number;
    headChars: number;
    tailChars: number;
    maxPerCall: number;
  };
  blobs: { enabled: boolean; maxBytes: number };
  continuation: {
    afterLengthStop: boolean;
    afterIdleUnfinished: boolean;
    afterSessionResume: boolean;
    maxPerUserTurn: number;
    maxWithoutStateChange: number;
  };
  notifications: "none" | "errors" | "all";
}

export const DEFAULT_CONTINUITY_CONFIG: ContinuityConfig = {
  enabled: true,
  storage: { retentionDays: 30, maxTotalBytes: 256 * 1024 * 1024 },
  retrieval: {
    enabled: true,
    maxHits: 4,
    maxChars: 3_600,
    autoExpandHits: 2,
    excludeRecentEntries: 24,
  },
  capsule: { maxChars: 2_200 },
  toolOutput: {
    enabled: true,
    minChars: 16_000,
    errorMinChars: 32_000,
    keepRecentEntries: 24,
    headChars: 2_400,
    tailChars: 2_400,
    maxPerCall: 32,
  },
  blobs: { enabled: false, maxBytes: 10 * 1024 * 1024 },
  continuation: {
    afterLengthStop: true,
    afterIdleUnfinished: false,
    afterSessionResume: false,
    maxPerUserTurn: 4,
    maxWithoutStateChange: 1,
  },
  notifications: "errors",
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

export function parseContinuityConfig(value: unknown, base = DEFAULT_CONTINUITY_CONFIG): ContinuityConfig {
  const root = object(value) ?? {};
  const storage = object(root.storage) ?? {};
  const retrieval = object(root.retrieval) ?? {};
  const capsule = object(root.capsule) ?? {};
  const toolOutput = object(root.toolOutput) ?? {};
  const blobs = object(root.blobs) ?? {};
  const continuation = object(root.continuation) ?? {};
  return {
    enabled: bool(root.enabled, base.enabled),
    storage: {
      retentionDays: finite(storage.retentionDays, base.storage.retentionDays, 1, 3_650),
      maxTotalBytes: finite(
        storage.maxTotalBytes,
        base.storage.maxTotalBytes,
        16 * 1024 * 1024,
        10 * 1024 * 1024 * 1024,
      ),
    },
    retrieval: {
      enabled: bool(retrieval.enabled, base.retrieval.enabled),
      maxHits: finite(retrieval.maxHits, base.retrieval.maxHits, 1, 10),
      maxChars: finite(retrieval.maxChars, base.retrieval.maxChars, 500, 20_000),
      autoExpandHits: finite(retrieval.autoExpandHits, base.retrieval.autoExpandHits, 0, 5),
      excludeRecentEntries: finite(retrieval.excludeRecentEntries, base.retrieval.excludeRecentEntries, 4, 200),
    },
    capsule: { maxChars: finite(capsule.maxChars, base.capsule.maxChars, 600, 8_000) },
    toolOutput: {
      enabled: bool(toolOutput.enabled, base.toolOutput.enabled),
      minChars: finite(toolOutput.minChars, base.toolOutput.minChars, 4_000, 200_000),
      errorMinChars: finite(toolOutput.errorMinChars, base.toolOutput.errorMinChars, 4_000, 300_000),
      keepRecentEntries: finite(toolOutput.keepRecentEntries, base.toolOutput.keepRecentEntries, 4, 200),
      headChars: finite(toolOutput.headChars, base.toolOutput.headChars, 200, 10_000),
      tailChars: finite(toolOutput.tailChars, base.toolOutput.tailChars, 200, 10_000),
      maxPerCall: finite(toolOutput.maxPerCall, base.toolOutput.maxPerCall, 1, 100),
    },
    blobs: {
      enabled: bool(blobs.enabled, base.blobs.enabled),
      maxBytes: finite(blobs.maxBytes, base.blobs.maxBytes, 64 * 1024, 100 * 1024 * 1024),
    },
    continuation: {
      afterLengthStop: bool(continuation.afterLengthStop, base.continuation.afterLengthStop),
      afterIdleUnfinished: bool(continuation.afterIdleUnfinished, base.continuation.afterIdleUnfinished),
      afterSessionResume: bool(continuation.afterSessionResume, base.continuation.afterSessionResume),
      maxPerUserTurn: finite(continuation.maxPerUserTurn, base.continuation.maxPerUserTurn, 0, 24),
      maxWithoutStateChange: finite(
        continuation.maxWithoutStateChange,
        base.continuation.maxWithoutStateChange,
        0,
        5,
      ),
    },
    notifications: choice(root.notifications, ["none", "errors", "all"] as const, base.notifications),
  };
}

export function continuityAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function continuityConfigPath(): string {
  return join(continuityAgentDir(), "continuity.json");
}
