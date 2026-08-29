import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContinuityArchive } from "../extensions/continuity-archive.ts";

function entry(entryId, parentId, ordinal, text, filePaths = []) {
  return {
    sessionId: "session-1",
    entryId,
    parentId,
    ordinal,
    timestamp: `2026-01-01T00:00:0${ordinal}Z`,
    role: ordinal % 2 ? "assistant" : "toolResult",
    isError: false,
    text,
    filePaths,
  };
}

test("archive indexes idempotently, filters branches, and falls back after close", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-archive-"));
  const archive = new ContinuityArchive(root);
  try {
    await archive.open();
    archive.index([
      entry("e1", null, 1, "parser failed on fragmented header", ["src/parser.ts"]),
      entry("e2", "e1", 2, "fixed parser fragmented header", ["src/parser.ts"]),
      entry("other", "e1", 3, "fragmented header abandoned branch", ["src/other.ts"]),
    ]);
    archive.index([entry("e2", "e1", 2, "fixed parser fragmented header", ["src/parser.ts"])]);
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

test("blob spooling is content addressed, session scoped, and size bounded", async () => {
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
    assert.equal((await archive.readBlob(blob.id, "other-session")), undefined);
    const restored = await archive.readBlob(blob.id, "session-1");
    assert.match(restored.text, /full compiler output/);
    assert.doesNotMatch(restored.text, /hidden/);
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
