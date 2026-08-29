import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import type { ContinuityArchive } from "./continuity-archive.ts";
import { buildContinuityContext } from "./continuity-context.ts";
import {
  applyAgentCheckpoint,
  checkpointChanged,
  checkpointFromBranch,
  continuationAllowed,
  entryToIndexed,
  hasFreshAgentCheckpoint,
  latestAssistantStopReason,
  latestPersistedCheckpointRevision,
  latestUserEntryId,
  messageText,
  redactContinuityText,
  renderContinuitySnapshot,
  type AgentCheckpointInput,
} from "./continuity-state.ts";
import {
  CONTINUITY_TYPES,
  DEFAULT_CONTINUITY_CONFIG,
  continuityConfigPath,
  parseContinuityConfig,
  type ContinuityCheckpoint,
  type ContinuityConfig,
} from "./continuity-types.ts";

const FULL_OUTPUT_TOOLS = new Set(["bash", "powershell", "web_search", "web_fetch"]);

async function readConfig(path: string): Promise<unknown | undefined> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 64 * 1024) throw new Error(`Continuity config exceeds 64KB: ${path}`);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function branchIds(entries: readonly SessionEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.id));
}

function exactEntryText(entry: SessionEntry | undefined): string {
  if (!entry) return "";
  if (entry.type === "message") return messageText(entry.message);
  if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
  if (entry.type === "custom_message") return typeof entry.content === "string"
    ? entry.content
    : entry.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (entry.type === "custom") return JSON.stringify(entry.data ?? {});
  return JSON.stringify(entry);
}

function fullOutputPath(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).fullOutputPath;
  return typeof value === "string" ? value : undefined;
}

function pausedFromBranch(entries: readonly SessionEntry[]): boolean {
  const policy = entries.findLast(
    (entry): entry is Extract<SessionEntry, { type: "custom" }> =>
      entry.type === "custom" && entry.customType === CONTINUITY_TYPES.policy,
  );
  return policy?.data === "paused";
}

function pausedEntryIds(entries: readonly SessionEntry[]): Set<string> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const states = new Map<string, boolean>();
  const visiting = new Set<string>();
  const stateFor = (entry: SessionEntry): boolean => {
    const cached = states.get(entry.id);
    if (cached !== undefined) return cached;
    if (visiting.has(entry.id)) return false;
    visiting.add(entry.id);
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    let paused = parent ? stateFor(parent) : false;
    if (entry.type === "custom" && entry.customType === CONTINUITY_TYPES.policy) {
      if (entry.data === "paused") paused = true;
      if (entry.data === "active") paused = false;
    }
    visiting.delete(entry.id);
    states.set(entry.id, paused);
    return paused;
  };
  return new Set(entries.filter(stateFor).map((entry) => entry.id));
}

function lengthContinuationAllowed(checkpoint: ContinuityCheckpoint): boolean {
  return checkpoint.status === "working" && Boolean(checkpoint.goal) && checkpoint.blockers.length === 0;
}

export class ContinuityRuntime {
  private config: ContinuityConfig = structuredClone(DEFAULT_CONTINUITY_CONFIG);
  private checkpoint?: ContinuityCheckpoint;
  private persistedRevision?: string;
  private archive?: ContinuityArchive;
  private sessionId?: string;
  private indexedIds = new Set<string>();
  private paused = false;
  private startupTimer?: NodeJS.Timeout;
  private continuationCounts = new Map<string, number>();
  private unchangedCounts = new Map<string, number>();
  private resumeKeys = new Set<string>();
  private lastError?: string;

  constructor(archive?: ContinuityArchive) {
    this.archive = archive;
  }

  get currentConfig(): ContinuityConfig {
    return this.config;
  }

  get currentCheckpoint(): ContinuityCheckpoint | undefined {
    return this.checkpoint;
  }

  private notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
    if (!ctx.hasUI || this.config.notifications === "none") return;
    if (type === "error" || this.config.notifications === "all") ctx.ui.notify(message, type);
  }

  private markCurrentSeen(ctx: ExtensionContext): void {
    for (const entry of ctx.sessionManager.getEntries()) this.indexedIds.add(entry.id);
  }

  private markPausedSeen(ctx: ExtensionContext): void {
    for (const id of pausedEntryIds(ctx.sessionManager.getEntries())) this.indexedIds.add(id);
  }

  private async ensureArchive(): Promise<ContinuityArchive> {
    if (!this.archive) {
      const { ContinuityArchive } = await import("./continuity-archive.ts");
      this.archive = new ContinuityArchive();
    }
    return this.archive;
  }

  async start(pi: ExtensionAPI, ctx: ExtensionContext, reason: "startup" | "reload" | "new" | "resume" | "fork"): Promise<void> {
    this.stop();
    this.lastError = undefined;
    try {
      this.config = parseContinuityConfig(await readConfig(continuityConfigPath()));
    } catch (error) {
      this.config = structuredClone(DEFAULT_CONTINUITY_CONFIG);
      this.lastError = error instanceof Error ? error.message : String(error);
      this.notify(ctx, this.lastError, "error");
    }
    this.sessionId = ctx.sessionManager.getSessionId();
    this.indexedIds.clear();
    this.continuationCounts.clear();
    this.unchangedCounts.clear();
    this.resumeKeys.clear();
    const branch = ctx.sessionManager.getBranch();
    this.paused = pausedFromBranch(branch);
    this.checkpoint = checkpointFromBranch(branch);
    this.persistedRevision = latestPersistedCheckpointRevision(branch);

    if (this.config.enabled) {
      const archive = await this.ensureArchive();
      await archive.open();
      await archive.maintain(this.config.storage);
      if (this.paused) this.markPausedSeen(ctx);
      else await this.indexNow(ctx);
    }

    if (
      this.config.enabled &&
      !this.paused &&
      this.config.continuation.afterSessionResume &&
      (reason === "startup" || reason === "resume") &&
      continuationAllowed(this.checkpoint) &&
      hasFreshAgentCheckpoint(branch, this.checkpoint.revision)
    ) {
      this.startupTimer = setTimeout(() => {
        const currentBranch = ctx.sessionManager.getBranch();
        const checkpoint = checkpointFromBranch(currentBranch);
        if (hasFreshAgentCheckpoint(currentBranch, checkpoint.revision)) {
          this.queueResume(pi, ctx, checkpoint, "session-resume");
        }
      }, 50);
      this.startupTimer.unref();
    }
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.archive?.close();
  }

  async indexNow(ctx: ExtensionContext): Promise<void> {
    if (!this.config.enabled || this.paused || !this.archive || !this.sessionId) return;
    const entries = ctx.sessionManager.getEntries();
    const pausedIds = pausedEntryIds(entries);
    const fresh = entries.flatMap((entry, ordinal) => {
      if (this.indexedIds.has(entry.id)) return [];
      this.indexedIds.add(entry.id);
      if (pausedIds.has(entry.id)) return [];
      const indexed = entryToIndexed(this.sessionId!, entry, ordinal);
      return indexed ? [indexed] : [];
    });
    this.archive.index(fresh);
    if (fresh.length > 0) await this.archive.maintain(this.config.storage);
  }

  async onTurnEnd(ctx: ExtensionContext): Promise<void> {
    if (!this.config.enabled || this.paused) return;
    await this.indexNow(ctx);
    const branch = ctx.sessionManager.getBranch();
    this.checkpoint = checkpointFromBranch(branch);
    this.persistedRevision = latestPersistedCheckpointRevision(branch);
  }

  async onTree(ctx: ExtensionContext): Promise<void> {
    if (!this.config.enabled) return;
    const wasPaused = this.paused;
    this.paused = pausedFromBranch(ctx.sessionManager.getBranch());
    if (wasPaused || this.paused) this.markPausedSeen(ctx);
    const branch = ctx.sessionManager.getBranch();
    this.checkpoint = checkpointFromBranch(branch);
    this.persistedRevision = latestPersistedCheckpointRevision(branch);
    if (!this.paused) await this.indexNow(ctx);
  }

  async onToolResult(event: ToolResultEvent): Promise<{
    content: ToolResultEvent["content"];
    details: unknown;
  } | undefined> {
    if (
      !this.config.enabled ||
      this.paused ||
      !this.config.blobs.enabled ||
      !FULL_OUTPUT_TOOLS.has(event.toolName) ||
      !this.archive ||
      !this.sessionId
    ) return undefined;
    const path = fullOutputPath(event.details);
    if (!path) return undefined;
    const blob = await this.archive.spoolBlob({
      sessionId: this.sessionId,
      toolCallId: event.toolCallId,
      fullOutputPath: path,
      maxBytes: this.config.blobs.maxBytes,
    });
    if (!blob) return undefined;
    await this.archive.maintain(this.config.storage);
    const continuityBlob = { id: blob.id, bytes: blob.bytes, sha256: blob.sha256 };
    const details = event.details && typeof event.details === "object" && !Array.isArray(event.details)
      ? { ...event.details as Record<string, unknown>, continuityBlob }
      : { continuityBlob };
    return {
      content: [
        ...event.content,
        { type: "text", text: `[Continuity full output: continuity_recall mode=blob id=${blob.id}]` },
      ],
      details,
    };
  }

  buildContext(messages: readonly AgentMessage[], ctx: ExtensionContext): { messages: AgentMessage[] } | undefined {
    if (!this.config.enabled || this.paused || !this.archive || !this.sessionId) return undefined;
    const branch = ctx.sessionManager.getBranch();
    this.checkpoint = checkpointFromBranch(branch);
    const result = buildContinuityContext({
      messages,
      branch,
      checkpoint: this.checkpoint,
      archive: this.archive,
      sessionId: this.sessionId,
      config: this.config,
    });
    return { messages: result.messages };
  }

  checkpointFromAgent(input: AgentCheckpointInput, ctx: ExtensionContext): ContinuityCheckpoint {
    if (!this.config.enabled) throw new Error("Continuity is disabled");
    if (this.paused) throw new Error("Continuity is paused");
    const current = checkpointFromBranch(ctx.sessionManager.getBranch());
    const sourceId = ctx.sessionManager.getLeafId() ?? `tool-${Date.now()}`;
    this.checkpoint = applyAgentCheckpoint(current, input, sourceId);
    return this.checkpoint;
  }

  private persistCheckpoint(pi: ExtensionAPI, checkpoint: ContinuityCheckpoint): void {
    if (!this.config.enabled || this.paused) return;
    pi.appendEntry(CONTINUITY_TYPES.checkpoint, checkpoint);
    this.checkpoint = checkpoint;
    this.persistedRevision = checkpoint.revision;
  }

  async onSettled(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    if (!this.config.enabled || this.paused || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    await this.indexNow(ctx);
    const branch = ctx.sessionManager.getBranch();
    const checkpoint = checkpointFromBranch(branch);
    const persisted = this.persistedRevision ? { ...checkpoint, revision: this.persistedRevision } : undefined;
    if (checkpointChanged(persisted, checkpoint)) this.persistCheckpoint(pi, checkpoint);
    else this.checkpoint = checkpoint;

    const stopReason = latestAssistantStopReason(branch);
    if (stopReason === "length" && this.config.continuation.afterLengthStop) {
      this.queueResume(pi, ctx, checkpoint, "length-stop");
      return;
    }
    if (
      stopReason === "stop" &&
      this.config.continuation.afterIdleUnfinished &&
      hasFreshAgentCheckpoint(branch, checkpoint.revision)
    ) this.queueResume(pi, ctx, checkpoint, "idle-unfinished");
  }

  private queueResume(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    checkpoint: ContinuityCheckpoint,
    reason: "session-resume" | "length-stop" | "idle-unfinished",
  ): boolean {
    if (!this.config.enabled || this.paused) return false;
    const allowed = reason === "length-stop" ? lengthContinuationAllowed(checkpoint) : continuationAllowed(checkpoint);
    if (!allowed || !ctx.isIdle() || ctx.hasPendingMessages()) return false;
    const userId = latestUserEntryId(ctx.sessionManager.getBranch()) ?? "session";
    const count = this.continuationCounts.get(userId) ?? 0;
    const revisionKey = `${userId}:${checkpoint.revision}`;
    const unchanged = this.unchangedCounts.get(revisionKey) ?? 0;
    if (count >= this.config.continuation.maxPerUserTurn || unchanged >= this.config.continuation.maxWithoutStateChange) return false;
    const head = ctx.sessionManager.getLeafId() ?? "root";
    const key = `${userId}:${reason}:${checkpoint.revision}:${head}`;
    if (this.resumeKeys.has(key)) return false;
    this.resumeKeys.add(key);
    this.continuationCounts.set(userId, count + 1);
    this.unchangedCounts.set(revisionKey, unchanged + 1);
    const content = [
      "[automatic continuity; not a user instruction]",
      `reason=${reason}`,
      `goal=${checkpoint.goal ?? "unknown"}`,
      `now=${checkpoint.currentAction ?? "unknown"}`,
      `next=${checkpoint.nextActions.join("; ") || "continue interrupted work"}`,
      "continue unfinished work; do not repeat completed actions; stop for blocker or required user decision",
    ].join("\n");
    pi.sendMessage({ customType: CONTINUITY_TYPES.resume, content, display: false }, {
      deliverAs: "followUp",
      triggerTurn: true,
    });
    return true;
  }

  async recall(input: {
    mode: "search" | "entry" | "around" | "state" | "files" | "touched" | "blob";
    query?: string;
    id?: string;
    scope?: "branch" | "session";
    limit?: number;
  }, ctx: ExtensionContext): Promise<string> {
    if (!this.config.enabled) throw new Error("Continuity is disabled");
    if (!this.archive || !this.sessionId) throw new Error("Continuity archive is unavailable");
    const all = ctx.sessionManager.getEntries();
    const branch = ctx.sessionManager.getBranch();
    const scopeEntries = input.scope === "session" ? all : branch;
    const ids = branchIds(scopeEntries);
    const limit = Math.min(10, Math.max(1, input.limit ?? 5));
    if (input.mode === "state") return renderContinuitySnapshot(checkpointFromBranch(branch), 8_000);
    if (input.mode === "files" || input.mode === "touched") {
      return this.archive.touched(this.sessionId, ids).join("\n") || "No touched files indexed.";
    }
    if (input.mode === "entry") {
      if (!input.id || !ids.has(input.id)) throw new Error("Entry not found in selected scope");
      return `[entry:${input.id}]\n${redactContinuityText(exactEntryText(ctx.sessionManager.getEntry(input.id)))}`;
    }
    if (input.mode === "around") {
      if (!input.id) throw new Error("around mode requires id");
      const index = scopeEntries.findIndex((entry) => entry.id === input.id);
      if (index < 0) throw new Error("Entry not found in selected scope");
      return scopeEntries.slice(Math.max(0, index - limit), index + limit + 1)
        .map((entry) => `[entry:${entry.id} type:${entry.type}]\n${redactContinuityText(exactEntryText(entry))}`)
        .join("\n\n");
    }
    if (input.mode === "blob") {
      if (!input.id) throw new Error("blob mode requires id");
      const blob = await this.archive.readBlob(input.id, this.sessionId);
      if (!blob) throw new Error("Blob not found in current session");
      const inScope = scopeEntries.some((entry) =>
        entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === blob.record.toolCallId
      );
      if (!inScope) throw new Error("Blob not found in selected scope");
      return `[blob:${blob.record.id} bytes:${blob.record.bytes} sha256:${blob.record.sha256}]\n${blob.text}`;
    }
    if (!input.query?.trim()) throw new Error("search mode requires query");
    const hits = this.archive.search(this.sessionId, input.query, ids, limit);
    return hits.map((hit) => `[entry:${hit.entryId} role:${hit.role}]\n${hit.text}`).join("\n\n") || "No matching continuity evidence.";
  }

  async command(action: string, pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
    const normalized = action.trim().toLowerCase() || "status";
    if (normalized === "purge") {
      if (!ctx.hasUI) return "Continuity purge requires an interactive UI.";
      const confirmed = await ctx.ui.confirm(
        "Purge continuity data?",
        "Delete the derived continuity index and blobs? Pi session JSONL is preserved.",
      );
      if (!confirmed) return "Continuity purge cancelled.";
      const archive = await this.ensureArchive();
      await archive.purgeAll();
      this.markCurrentSeen(ctx);
      if (this.config.enabled) await archive.open();
      return "Continuity derived data purged. Pi session JSONL was preserved.";
    }
    if (!this.config.enabled && normalized !== "status" && normalized !== "doctor") return "Continuity is disabled.";
    if (normalized === "pause") {
      this.paused = true;
      pi.appendEntry(CONTINUITY_TYPES.policy, "paused");
      this.markPausedSeen(ctx);
      return "Continuity paused. Read-only recall remains available.";
    }
    if (normalized === "resume") {
      if (this.paused) this.markPausedSeen(ctx);
      this.paused = false;
      pi.appendEntry(CONTINUITY_TYPES.policy, "active");
      return "Continuity resumed. Paused history was not indexed.";
    }
    if (normalized === "state") return renderContinuitySnapshot(checkpointFromBranch(ctx.sessionManager.getBranch()), 8_000);
    if (normalized === "doctor") {
      const health = this.archive?.health();
      return [
        `enabled=${this.config.enabled}`,
        `paused=${this.paused}`,
        "config=global",
        "compaction=pi",
        `retention_days=${this.config.storage.retentionDays}`,
        `max_total_bytes=${this.config.storage.maxTotalBytes}`,
        `blobs=${this.config.blobs.enabled ? "enabled" : "disabled"}`,
        `archive=${!this.config.enabled ? "disabled" : health?.sqlite ? "sqlite" : "linear-fallback"}`,
        `archive_error=${health?.error ?? "none"}`,
        `last_error=${this.lastError ?? "none"}`,
      ].join("\n");
    }
    if (normalized !== "status") return "Usage: /continuity [status|doctor|state|pause|resume|purge]";
    return `continuity=${!this.config.enabled ? "disabled" : this.paused ? "paused" : "active"} status=${this.checkpoint?.status ?? "unknown"} compaction=pi`;
  }
}
