import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IndexedEntry, RecallHit } from "./continuity-types.ts";
import { continuityAgentDir, type ContinuityConfig } from "./continuity-types.ts";
import { normalizeContinuityText, redactContinuityText } from "./continuity-state.ts";

export interface BlobRecord {
  id: string;
  sessionId: string;
  toolCallId: string;
  path: string;
  bytes: number;
  sha256: string;
  createdAt: number;
}

export interface MaintenanceResult {
  removedEntries: number;
  removedBlobs: number;
  bytes: number;
}

function searchExpression(query: string): string | undefined {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_./:-]{2,}/gu) ?? [])].slice(0, 12);
  return terms.length > 0 ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ") : undefined;
}

function entryBytes(entry: IndexedEntry): number {
  return Buffer.byteLength(entry.text, "utf8") + Buffer.byteLength(JSON.stringify(entry.filePaths), "utf8");
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

  private blobPath(path: string): string | undefined {
    const root = resolve(this.blobRoot);
    const target = resolve(path);
    return target.startsWith(`${root}${sep}`) ? target : undefined;
  }

  private async removeBlobFile(path: string): Promise<void> {
    const target = this.blobPath(path);
    if (target) await rm(target, { force: true });
  }

  async open(): Promise<void> {
    try {
      await mkdir(this.blobRoot, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700).catch(() => undefined);
      await chmod(this.blobRoot, 0o700).catch(() => undefined);
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
      `);
      const blobColumns = this.database.prepare("PRAGMA table_info(blobs)").all() as Array<{ name: string }>;
      if (blobColumns.length > 0 && !blobColumns.some(({ name }) => name === "created_at")) {
        this.database.exec("DROP TABLE blobs");
        await rm(this.blobRoot, { recursive: true, force: true });
        await mkdir(this.blobRoot, { recursive: true, mode: 0o700 });
      }
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tool_call_id TEXT NOT NULL,
          path TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        PRAGMA user_version=2;
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

  async purgeAll(): Promise<void> {
    this.close();
    this.fallback.clear();
    await rm(this.root, { recursive: true, force: true });
    this.error = undefined;
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
    if (!expression || branchIds.size === 0) return [];
    if (this.database) {
      try {
        const rows = this.database.prepare(`
          WITH branch_ids(entry_id) AS (SELECT value FROM json_each(?))
          SELECT e.*, bm25(entry_fts) AS rank
          FROM entry_fts
          JOIN entries e USING (session_id, entry_id)
          JOIN branch_ids b ON b.entry_id = e.entry_id
          WHERE entry_fts MATCH ? AND entry_fts.session_id = ?
          ORDER BY rank
          LIMIT ?
        `).all(JSON.stringify([...branchIds]), expression, sessionId, limit) as Array<Record<string, unknown>>;
        return rows.map((row) => ({
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

  async maintain(storage: ContinuityConfig["storage"], now = Date.now()): Promise<MaintenanceResult> {
    const cutoff = now - storage.retentionDays * 86_400_000;
    let removedEntries = 0;
    let removedBlobs = 0;
    for (const [key, entry] of this.fallback) {
      if ((Date.parse(entry.timestamp) || 0) < cutoff) {
        this.fallback.delete(key);
        if (!this.database) removedEntries++;
      }
    }
    if (!this.database) {
      const values = [...this.fallback.entries()].sort(([, left], [, right]) => left.timestamp.localeCompare(right.timestamp));
      let bytes = values.reduce((total, [, entry]) => total + entryBytes(entry), 0);
      for (const [key, entry] of values) {
        if (bytes <= storage.maxTotalBytes) break;
        this.fallback.delete(key);
        bytes -= entryBytes(entry);
        removedEntries++;
      }
      return { removedEntries, removedBlobs, bytes };
    }

    const expiredBlobs = this.database.prepare("SELECT id, path FROM blobs WHERE created_at < ?").all(cutoff) as Array<{ id: string; path: string }>;
    for (const blob of expiredBlobs) await this.removeBlobFile(blob.path);
    this.database.prepare("DELETE FROM blobs WHERE created_at < ?").run(cutoff);
    removedBlobs += expiredBlobs.length;

    const cutoffIso = new Date(cutoff).toISOString();
    const expiredEntries = this.database.prepare("SELECT session_id, entry_id FROM entries WHERE timestamp < ?").all(cutoffIso) as Array<{ session_id: string; entry_id: string }>;
    const deleteEntry = this.database.prepare("DELETE FROM entries WHERE session_id = ? AND entry_id = ?");
    const deleteFts = this.database.prepare("DELETE FROM entry_fts WHERE session_id = ? AND entry_id = ?");
    for (const entry of expiredEntries) {
      deleteFts.run(entry.session_id, entry.entry_id);
      deleteEntry.run(entry.session_id, entry.entry_id);
    }
    removedEntries += expiredEntries.length;

    const total = () => Number((this.database!.prepare(`
      SELECT
        COALESCE((SELECT SUM(length(CAST(text AS BLOB)) + length(CAST(file_paths AS BLOB))) FROM entries), 0) +
        COALESCE((SELECT SUM(bytes) FROM blobs), 0) AS bytes
    `).get() as { bytes: number }).bytes);
    let bytes = total();
    if (bytes > storage.maxTotalBytes) {
      const candidates = this.database.prepare(`
        SELECT 'entry' AS kind, session_id, entry_id AS id, NULL AS path,
          length(CAST(text AS BLOB)) + length(CAST(file_paths AS BLOB)) AS bytes,
          CAST(strftime('%s', timestamp) AS INTEGER) * 1000 AS created_at
        FROM entries
        UNION ALL
        SELECT 'blob' AS kind, session_id, id, path, bytes, created_at FROM blobs
        ORDER BY created_at, kind
      `).all() as Array<{ kind: "entry" | "blob"; session_id: string; id: string; path: string | null; bytes: number }>;
      const deleteBlob = this.database.prepare("DELETE FROM blobs WHERE id = ?");
      for (const candidate of candidates) {
        if (bytes <= storage.maxTotalBytes) break;
        if (candidate.kind === "blob") {
          if (candidate.path) await this.removeBlobFile(candidate.path);
          deleteBlob.run(candidate.id);
          removedBlobs++;
        } else {
          deleteFts.run(candidate.session_id, candidate.id);
          deleteEntry.run(candidate.session_id, candidate.id);
          this.fallback.delete(`${candidate.session_id}:${candidate.id}`);
          removedEntries++;
        }
        bytes -= Number(candidate.bytes);
      }
      bytes = total();
    }
    return { removedEntries, removedBlobs, bytes };
  }

  async spoolBlob(input: {
    sessionId: string;
    toolCallId: string;
    fullOutputPath: string;
    maxBytes: number;
  }): Promise<BlobRecord | undefined> {
    if (!this.database) return undefined;
    try {
      const source = await realpath(input.fullOutputPath);
      const metadata = await stat(source);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > input.maxBytes) return undefined;
      const data = redactContinuityText(await readFile(source, "utf8"));
      const bytes = Buffer.byteLength(data, "utf8");
      if (bytes === 0 || bytes > input.maxBytes) return undefined;
      const sha256 = createHash("sha256").update(data).digest("hex");
      const id = createHash("sha256")
        .update(`${input.sessionId}\n${input.toolCallId}\n${sha256}`)
        .digest("hex")
        .slice(0, 24);
      const directory = this.blobPath(join(this.blobRoot, input.sessionId.replace(/[^A-Za-z0-9._-]/g, "_")));
      if (!directory) return undefined;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700).catch(() => undefined);
      const path = join(directory, `${id}.txt`);
      await writeFile(path, data, { mode: 0o600, flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const record = { id, sessionId: input.sessionId, toolCallId: input.toolCallId, path, bytes, sha256, createdAt: Date.now() };
      this.database.prepare(`
        INSERT OR REPLACE INTO blobs (id, session_id, tool_call_id, path, bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.sessionId, input.toolCallId, path, bytes, sha256, record.createdAt);
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
        createdAt: Number(row.created_at),
      };
      const path = this.blobPath(record.path);
      if (!path) return undefined;
      const resolvedPath = await realpath(path);
      if (!this.blobPath(resolvedPath)) return undefined;
      return { text: redactContinuityText(await readFile(resolvedPath, "utf8")), record };
    } catch {
      return undefined;
    }
  }

  static bounded(text: string, maxChars: number): string {
    return normalizeContinuityText(text, maxChars);
  }
}
