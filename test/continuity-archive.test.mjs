import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ContinuityArchive } from "../extensions/continuity-archive.ts";

function entry(entryId, parentId, ordinal, text, timestamp = "2026-08-30T00:00:00Z", filePaths = []) {
  return {
    sessionId: "session-1",
    entryId,
    parentId,
    ordinal,
    timestamp,
    role: ordinal % 2 ? "assistant" : "toolResult",
    isError: false,
    text,
    filePaths,
  };
}

test("archive indexes idempotently and filters branches before ranking and limiting", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-archive-"));
  const archive = new ContinuityArchive(root);
  try {
    await archive.open();
    archive.index([
      entry("e1", null, 1, "parser failed on fragmented header", undefined, ["src/parser.ts"]),
      entry("e2", "e1", 2, "fixed parser fragmented header", undefined, ["src/parser.ts"]),
      ...Array.from({ length: 150 }, (_, index) => entry(
        `other-${index}`,
        "e1",
        index + 3,
        `fragmented header fragmented header abandoned branch ${index}`,
        undefined,
        ["src/other.ts"],
      )),
    ]);
    archive.index([entry("e2", "e1", 2, "fixed parser fragmented header", undefined, ["src/parser.ts"])]);
    const hits = archive.search("session-1", "fragmented header", new Set(["e1", "e2"]), 5);
    assert.deepEqual(hits.map(({ entryId }) => entryId).sort(), ["e1", "e2"]);
    assert.deepEqual(archive.touched("session-1", new Set(["e1", "e2"])), ["src/parser.ts"]);

    archive.close();
    const fallback = archive.search("session-1", "parser failed", new Set(["e1"]), 5);
    assert.equal(fallback[0]?.entryId, "e1");
  } finally {
    archive.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("blob spooling redacts before persistence and remains session scoped and size bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-blob-"));
  const source = join(root, "source.log");
  const archive = new ContinuityArchive(join(root, "state"));
  try {
    await writeFile(source, "full compiler output\nsecret=hidden\n", "utf8");
    await archive.open();
    const blob = await archive.spoolBlob({
      sessionId: "session-1",
      toolCallId: "tool-1",
      fullOutputPath: source,
      maxBytes: 1_000,
    });
    assert.ok(blob);
    assert.equal(await archive.readBlob(blob.id, "other-session"), undefined);
    const restored = await archive.readBlob(blob.id, "session-1");
    assert.match(restored.text, /full compiler output/);
    assert.doesNotMatch(restored.text, /hidden/);
    assert.doesNotMatch(await readFile(blob.path, "utf8"), /hidden/);
    assert.equal(blob.bytes, Buffer.byteLength(restored.text, "utf8"));
    assert.equal(blob.sha256, createHash("sha256").update(restored.text).digest("hex"));
    assert.equal(await archive.spoolBlob({
      sessionId: "session-1",
      toolCallId: "tool-2",
      fullOutputPath: source,
      maxBytes: 2,
    }), undefined);
  } finally {
    archive.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("archive maintenance expires old data, enforces its logical quota, and purges all derived state", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-maintenance-"));
  const source = join(root, "source.log");
  const state = join(root, "state");
  const archive = new ContinuityArchive(state);
  try {
    await writeFile(source, "retained compiler output", "utf8");
    await archive.open();
    archive.index([
      entry("old", null, 1, "old searchable evidence", "2026-01-01T00:00:00Z"),
      entry("new", "old", 2, "new searchable evidence", "2026-08-29T00:00:00Z"),
    ]);
    const blob = await archive.spoolBlob({
      sessionId: "session-1", toolCallId: "tool-1", fullOutputPath: source, maxBytes: 1_000,
    });
    assert.ok(blob);

    const expired = await archive.maintain({ retentionDays: 30, maxTotalBytes: 1_000 }, Date.parse("2026-08-30T00:00:00Z"));
    assert.ok(expired.removedEntries >= 1);
    assert.deepEqual(archive.search("session-1", "old searchable", new Set(["old"]), 5), []);
    assert.equal(archive.search("session-1", "new searchable", new Set(["new"]), 5)[0]?.entryId, "new");

    const bounded = await archive.maintain({ retentionDays: 365, maxTotalBytes: 1 }, Date.parse("2026-08-30T00:00:00Z"));
    assert.ok(bounded.bytes <= 1);
    assert.equal(await archive.readBlob(blob.id, "session-1"), undefined);

    await archive.purgeAll();
    await assert.rejects(access(join(state, "index.sqlite")));
    await archive.open();
    assert.deepEqual(archive.search("session-1", "searchable", new Set(["new"]), 5), []);
  } finally {
    archive.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("opening a legacy archive removes raw blobs during schema migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-legacy-"));
  const blobRoot = join(root, "blobs", "session-1");
  const blobPath = join(blobRoot, "legacy.txt");
  await mkdir(blobRoot, { recursive: true });
  await writeFile(blobPath, "secret=legacy", "utf8");
  const database = new DatabaseSync(join(root, "index.sqlite"));
  database.exec(`
    CREATE TABLE entries (
      session_id TEXT NOT NULL, entry_id TEXT NOT NULL, parent_id TEXT, ordinal INTEGER NOT NULL,
      timestamp TEXT NOT NULL, role TEXT NOT NULL, tool_name TEXT, is_error INTEGER NOT NULL,
      text TEXT NOT NULL, file_paths TEXT NOT NULL, PRIMARY KEY (session_id, entry_id)
    );
    CREATE VIRTUAL TABLE entry_fts USING fts5(session_id UNINDEXED, entry_id UNINDEXED, text);
    CREATE TABLE blobs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
      path TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "session-1", "kept", null, 0, "2026-08-30T00:00:00Z", "user", null, 0,
    "already redacted evidence", "[]",
  );
  database.prepare("INSERT INTO entry_fts VALUES (?, ?, ?)").run(
    "session-1", "kept", "already redacted evidence",
  );
  database.prepare("INSERT INTO blobs VALUES (?, ?, ?, ?, ?, ?)").run(
    "legacy", "session-1", "tool-1", blobPath, 13, "abc",
  );
  database.close();

  const archive = new ContinuityArchive(root);
  try {
    await archive.open();
    assert.equal(await archive.readBlob("legacy", "session-1"), undefined);
    await assert.rejects(access(blobPath));
    assert.equal(archive.search("session-1", "redacted evidence", new Set(["kept"]), 1)[0]?.entryId, "kept");
  } finally {
    archive.close();
    await rm(root, { recursive: true, force: true });
  }
});
