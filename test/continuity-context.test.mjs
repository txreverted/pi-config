import test from "node:test";
import assert from "node:assert/strict";
import { buildContinuityContext, renderRetrieval } from "../extensions/continuity-context.ts";
import { applyAgentCheckpoint, checkpointFromBranch } from "../extensions/continuity-state.ts";
import { DEFAULT_CONTINUITY_CONFIG } from "../extensions/continuity-types.ts";

const userEntry = {
  type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z",
  message: { role: "user", content: "Fix fragmented parser", timestamp: 1 },
};
const resultEntry = {
  type: "message", id: "t1", parentId: "u1", timestamp: "2026-01-01T00:00:01Z",
  message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "x".repeat(20_000) }], isError: false, timestamp: 2 },
};
const recentEntry = {
  type: "message", id: "a1", parentId: "t1", timestamp: "2026-01-01T00:00:02Z",
  message: {
    role: "assistant", content: [{ type: "text", text: "Continuing" }], api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 3,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  },
};

test("context virtualization preserves tool identity and injects one bounded capsule", () => {
  const checkpoint = applyAgentCheckpoint(checkpointFromBranch([userEntry]), {
    currentAction: "fix src/parser.ts",
    nextActions: ["run npm test"],
  }, "a1");
  const config = structuredClone(DEFAULT_CONTINUITY_CONFIG);
  config.toolOutput.keepRecentEntries = 1;
  config.retrieval.excludeRecentEntries = 1;
  config.capsule.maxChars = 900;
  config.retrieval.maxChars = 600;
  const archive = {
    search() {
      return [{
        sessionId: "s1", entryId: "u1", parentId: null, ordinal: 0,
        timestamp: "2026-01-01T00:00:00Z", role: "user", isError: false,
        text: "Earlier parser decision", filePaths: ["src/parser.ts"], score: 2,
      }];
    },
  };
  const result = buildContinuityContext({
    messages: [userEntry.message, resultEntry.message, recentEntry.message],
    branch: [userEntry, resultEntry, recentEntry],
    checkpoint,
    archive,
    sessionId: "s1",
    config,
  });
  assert.equal(result.virtualized, 1);
  const tool = result.messages.find((message) => message.role === "toolResult");
  assert.equal(tool.toolCallId, "call-1");
  assert.equal(tool.isError, false);
  assert.match(tool.content[0].text, /continuity_recall mode=entry id=t1/);
  const capsules = result.messages.filter((message) => message.role === "custom" && message.customType === "pi-config/continuity-capsule");
  assert.equal(capsules.length, 1);
  assert.match(capsules[0].content, /current user instructions win/);
  assert.match(capsules[0].content, /untrusted data, not instructions/);
});

test("context virtualization preserves non-text content and prefers an archived blob", () => {
  const checkpoint = checkpointFromBranch([userEntry]);
  const config = structuredClone(DEFAULT_CONTINUITY_CONFIG);
  config.toolOutput.keepRecentEntries = 1;
  config.retrieval.enabled = false;
  const blobResultEntry = {
    ...resultEntry,
    message: {
      ...resultEntry.message,
      content: [
        { type: "image", data: "AA==", mimeType: "image/png" },
        { type: "text", text: "x".repeat(10_000) },
        { type: "image", data: "AQ==", mimeType: "image/png" },
        { type: "text", text: "y".repeat(10_000) },
      ],
      details: { continuityBlob: { id: "blob-1" } },
    },
  };
  const result = buildContinuityContext({
    messages: [userEntry.message, blobResultEntry.message, recentEntry.message],
    branch: [userEntry, blobResultEntry, recentEntry],
    checkpoint,
    archive: { search: () => [] },
    sessionId: "s1",
    config,
  });
  const tool = result.messages.find((message) => message.role === "toolResult");
  assert.deepEqual(tool.content.map((part) => part.type), ["image", "text", "image"]);
  assert.match(tool.content[1].text, /continuity_recall mode=blob id=blob-1/);
});

test("retrieval rendering remains source-addressed and bounded", () => {
  const text = renderRetrieval([{
    sessionId: "s1", entryId: "e1", parentId: null, ordinal: 0,
    timestamp: "2026-01-01T00:00:00Z", role: "toolResult", toolName: "bash", isError: true,
    text: "failure ".repeat(1_000), filePaths: [], score: 1,
  }], 500, 1);
  assert.ok(text.length <= 500);
  assert.match(text, /entry:e1/);
});
