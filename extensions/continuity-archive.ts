import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IndexedEntry, RecallHit } from "./continuity-types.ts";
import { continuityAgentDir } from "./continuity-types.ts";
import { normalizeContinuityText, redactContinuityText } from "./continuity-state.ts";

export interface BlobRecord {
  id: string;
  sessionId: string;
  toolCallId: string;
  path: string;
  bytes: number;
  sha256: string;
}

function searchExpression(query: string): string | undefined {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_./:-]{2,}/gu) ?? [])].slice(0, 12);
  return terms.length > 0 ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ") : undefined;
}

export class ContinuityArchive {
  private database?: DatabaseSync;
  private readonly root: string;
  private readonly blobRoot: string;
  private readonly fallback = new Map<string, IndexedEntry>();
  private error?: string;

  constructor(root = join(continuityAgentDir(), "continuity")) {
    this.root = root;
    this.blobRoot = join(root, "blobs");
  }

  async open(): Promise<void> {
    try {
      await mkdir(this.blobRoot, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700).catch(() => undefined);
      const path = join(this.root, "index.sqlite");
      this.database = new DatabaseSync(path);
      this.database.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS entries (
          session_id TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          parent_id TEXT,
          ordinal INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          role TEXT NOT NULL,
          tool_name TEXT,
          is_error INTEGER NOT NULL,
          text TEXT NOT NULL,
          file_paths TEXT NOT NULL,
          PRIMARY KEY (session_id, entry_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
          session_id UNINDEXED,
          entry_id UNINDEXED,
          text,
          tokenize='unicode61'
        );
        CREATE TABLE IF NOT EXISTS blobs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tool_call_id TEXT NOT NULL,
          path TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL
        );
      `);
      await chmod(path, 0o600).catch(() => undefined);
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.database?.close();
      this.database = undefined;
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  health(): { sqlite: boolean; fallbackEntries: number; error?: string } {
    return { sqlite: Boolean(this.database), fallbackEntries: this.fallback.size, error: this.error };
  }

  index(entries: readonly IndexedEntry[]): void {
    for (const entry of entries) this.fallback.set(`${entry.sessionId}:${entry.entryId}`, entry);
    if (!this.database || entries.length === 0) return;
    const insert = this.database.prepare(`
      INSERT INTO entries (
        session_id, entry_id, parent_id, ordinal, timestamp, role, tool_name, is_error, text, file_paths
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, entry_id) DO UPDATE SET
        parent_id=excluded.parent_id,
        ordinal=excluded.ordinal,
        timestamp=excluded.timestamp,
        role=excluded.role,
        tool_name=excluded.tool_name,
        is_error=excluded.is_error,
        text=excluded.text,
        file_paths=excluded.file_paths
    `);
    const removeFts = this.database.prepare("DELETE FROM entry_fts WHERE session_id = ? AND entry_id = ?");
    const insertFts = this.database.prepare("INSERT INTO entry_fts (session_id, entry_id, text) VALUES (?, ?, ?)");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        insert.run(
          entry.sessionId,
          entry.entryId,
          entry.parentId,
          entry.ordinal,
          entry.timestamp,
          entry.role,
          entry.toolName ?? null,
          entry.isError ? 1 : 0,
          entry.text,
          JSON.stringify(entry.filePaths),
        );
        removeFts.run(entry.sessionId, entry.entryId);
        insertFts.run(entry.sessionId, entry.entryId, entry.text);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  search(sessionId: string, query: string, branchIds: ReadonlySet<string>, limit: number): RecallHit[] {
    const expression = searchExpression(query);
    if (!expression) return [];
    if (this.database) {
      try {
        const rows = this.database.prepare(`
          SELECT e.*, bm25(entry_fts) AS rank
          FROM entry_fts
          JOIN entries e USING (session_id, entry_id)
          WHERE entry_fts MATCH ? AND entry_fts.session_id = ?
          ORDER BY rank
          LIMIT ?
        `).all(expression, sessionId, Math.max(limit * 25, 100)) as Array<Record<string, unknown>>;
        return rows
          .filter((row) => branchIds.has(String(row.entry_id)))
          .slice(0, limit)
          .map((row) => ({
            sessionId: String(row.session_id),
            entryId: String(row.entry_id),
            parentId: row.parent_id === null ? null : String(row.parent_id),
            ordinal: Number(row.ordinal),
            timestamp: String(row.timestamp),
            role: String(row.role),
            toolName: row.tool_name === null ? undefined : String(row.tool_name),
            isError: Number(row.is_error) !== 0,
            text: String(row.text),
            filePaths: JSON.parse(String(row.file_paths)) as string[],
            score: -Number(row.rank),
          }));
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    }

    const terms = expression.replaceAll('"', "").split(" OR ");
    return [...this.fallback.values()]
      .filter((entry) => entry.sessionId === sessionId && branchIds.has(entry.entryId))
      .map((entry) => ({
        ...entry,
        score: terms.reduce((score, term) => score + entry.text.toLowerCase().split(term).length - 1, 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.ordinal - left.ordinal)
      .slice(0, limit);
  }

  touched(sessionId: string, branchIds: ReadonlySet<string>): string[] {
    const paths = new Set<string>();
    for (const entry of this.fallback.values()) {
      if (entry.sessionId !== sessionId || !branchIds.has(entry.entryId)) continue;
      for (const path of entry.filePaths) paths.add(path);
    }
    return [...paths].sort();
  }

  async spoolBlob(input: {
    sessionId: string;
    toolCallId: string;
    fullOutputPath: string;
    maxBytes: number;
  }): Promise<BlobRecord | undefined> {
    try {
      const source = await realpath(input.fullOutputPath);
      const metadata = await stat(source);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > input.maxBytes) return undefined;
      const data = await readFile(source);
      const sha256 = createHash("sha256").update(data).digest("hex");
      const id = createHash("sha256")
        .update(`${input.sessionId}\n${input.toolCallId}\n${sha256}`)
        .digest("hex")
        .slice(0, 24);
      const directory = join(this.blobRoot, input.sessionId.replace(/[^A-Za-z0-9._-]/g, "_"));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${id}.txt`);
      await writeFile(path, data, { mode: 0o600, flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const record = { id, sessionId: input.sessionId, toolCallId: input.toolCallId, path, bytes: data.length, sha256 };
      this.database?.prepare(`
        INSERT OR REPLACE INTO blobs (id, session_id, tool_call_id, path, bytes, sha256)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.sessionId, input.toolCallId, path, data.length, sha256);
      return record;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }

  async readBlob(id: string, sessionId: string): Promise<{ text: string; record: BlobRecord } | undefined> {
    if (!this.database) return undefined;
    const row = this.database.prepare("SELECT * FROM blobs WHERE id = ? AND session_id = ?").get(id, sessionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    try {
      const record: BlobRecord = {
        id: String(row.id),
        sessionId: String(row.session_id),
        toolCallId: String(row.tool_call_id),
        path: String(row.path),
        bytes: Number(row.bytes),
        sha256: String(row.sha256),
      };
      return { text: redactContinuityText(await readFile(record.path, "utf8")), record };
    } catch {
      return undefined;
    }
  }

  static bounded(text: string, maxChars: number): string {
    return normalizeContinuityText(text, maxChars);
  }
}
