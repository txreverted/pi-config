import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_CONTEXT_MESSAGE,
  MEMORY_DETAILS_TYPE,
  MEMORY_OBSERVATIONS_ENTRY,
  MEMORY_RESUME_MESSAGE,
  foldObservations,
  formatSourceEntries,
  isSourceEntry,
  midRunCompactionThreshold,
  normalizeCheckpoint,
  normalizeObservations,
  renderCompactionMemory,
  searchObservations,
  selectSourceSlice,
  serializeSourceEntries,
  shouldContinueAfterCompaction,
  snapCompactionCutoff,
} from "../extensions/memory-core.ts";
import { checkpointInput, observerInput } from "../extensions/memory-prompts.ts";

const user = (id, text) => ({
  type: "message",
  id,
  message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
});
const assistant = (id, content) => ({
  type: "message",
  id,
  message: { role: "assistant", content, timestamp: 2, usage: { totalTokens: 0 } },
});
const toolResult = (id, call, text) => ({
  type: "message",
  id,
  message: { role: "toolResult", toolCallId: call, toolName: "bash", content: [{ type: "text", text }], timestamp: 3 },
});
const batch = (id, coversUpToId, observations) => ({
  type: "custom",
  id,
  customType: MEMORY_OBSERVATIONS_ENTRY,
  data: { version: 1, coversUpToId, observations },
});
const observation = (id, content, sourceEntryIds, overrides = {}) => ({
  id,
  kind: "fact",
  content,
  sourceEntryIds,
  tokenCount: Math.ceil(content.length / 4),
  ...overrides,
});

function checkpoint(overrides = {}) {
  return {
    objective: { id: "goal", text: "Implement memory", sourceEntryIds: ["u1"] },
    requirements: [{ id: "r1", text: "Keep branches isolated", sourceEntryIds: ["u1"], status: "open" }],
    decisions: [],
    currentAction: { id: "a1", text: "Add tests", sourceEntryIds: ["u1"] },
    completed: [],
    verification: [],
    blockers: [],
    phase: "active",
    sourceEntryIds: ["u1"],
    ...overrides,
  };
}

test("chunk selection never separates a tool call from its result", () => {
  const entries = [
    user("u1", "x".repeat(40)),
    assistant("a1", [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "x".repeat(80) } }]),
    toolResult("t1", "call-1", "y".repeat(40)),
    user("u2", "z".repeat(40)),
  ];
  const first = selectSourceSlice(entries, undefined, 10);
  assert.deepEqual(first.entries.map(({ id }) => id), ["u1"]);
  const second = selectSourceSlice(entries, "u1", 10);
  assert.deepEqual(second.entries.map(({ id }) => id), ["a1", "t1"]);
});

test("observer normalization validates sources, assigns deterministic ids, and deduplicates", () => {
  const raw = {
    kind: "requirement",
    content: " Preserve exact source ids. ",
    sourceEntryIds: ["u1"],
    status: "open",
  };
  const first = normalizeObservations([raw, raw], new Set(["u1"]));
  const second = normalizeObservations([raw], new Set(["u1"]));
  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].content, "Preserve exact source ids.");
  assert.throws(() => normalizeObservations([{ ...raw, sourceEntryIds: ["other"] }], new Set(["u1"])), /outside its assigned chunk/);
  assert.throws(() => normalizeObservations([{ ...raw, kind: "instruction" }], new Set(["u1"])), /invalid observation kind/);
  assert.throws(() => normalizeObservations([{ ...raw, supersedes: ["unknown"] }], new Set(["u1"])), /outside its supplied context/);
  const replacement = normalizeObservations([{ ...raw, supersedes: ["old"] }], new Set(["u1"]), new Set(["old"]));
  assert.deepEqual(replacement[0].supersedes, ["old"]);
});

test("observation folding follows the supplied active branch and keeps empty coverage batches", () => {
  const shared = observation("o1", "shared", ["u1"]);
  const left = observation("o2", "left branch", ["u2"]);
  const right = observation("o3", "right branch", ["u3"]);
  const leftBranch = [user("u1", "root"), batch("b1", "u1", [shared]), user("u2", "left"), batch("b2", "u2", [left])];
  const rightBranch = [user("u1", "root"), batch("b1", "u1", [shared]), user("u3", "right"), batch("b3", "u3", [right]), batch("b4", "u3", [])];
  const replacedBranch = [...leftBranch, user("u4", "replace"), batch("b5", "u4", [observation("o4", "replacement", ["u4"], { supersedes: ["o2"] })])];
  assert.deepEqual(foldObservations(leftBranch).map(({ id }) => id), ["o1", "o2"]);
  assert.deepEqual(foldObservations(rightBranch).map(({ id }) => id), ["o1", "o3"]);
  assert.deepEqual(foldObservations(replacedBranch).map(({ id }) => id), ["o1", "o4"]);
});

test("compaction cutoff snaps to an observed boundary without double-representing the tail", () => {
  const body = "x".repeat(40);
  const entries = [
    user("u1", body), user("u2", body), batch("b1", "u2", [observation("o1", "early", ["u2"])]),
    user("u3", body), user("u4", body), batch("b2", "u4", [observation("o2", "late", ["u4"])]),
    user("u5", body), user("u6", body),
  ];
  const cutoff = snapCompactionCutoff(entries, "u6", 20);
  assert.equal(cutoff.firstKeptEntryId, "u5");
  assert.equal(cutoff.tailTokens, 20);
  assert.deepEqual(foldObservations(entries, "u4").map(({ id }) => id), ["o1", "o2"]);
});

test("compaction cutoff optimization still rejects a boundary followed by a tool result", () => {
  const entries = [
    user("u1", "root"),
    batch("b1", "u1", [observation("o1", "root", ["u1"])]),
    toolResult("t1", "call-1", "result"),
    assistant("a1", [{ type: "text", text: "done" }]),
  ];
  assert.deepEqual(snapCompactionCutoff(entries, "a1", 1), { firstKeptEntryId: "a1" });
});

test("checkpoint normalization rejects unknown source ids and renders stable task context", () => {
  const rawCheckpoint = {
    objective: { text: "Implement memory", sourceEntryIds: ["u1"] },
    requirements: [{ text: "Keep branches isolated", status: "open", sourceEntryIds: ["u1"] }],
    decisions: [],
    currentAction: { text: "Add tests", sourceEntryIds: ["u1"] },
    completed: [],
    verification: [],
    blockers: [],
    phase: "active",
  };
  assert.throws(() => normalizeCheckpoint({
    ...rawCheckpoint,
    objective: { text: "Implement memory", sourceEntryIds: ["u1", "ghost"] },
  }, new Set(["u1"])), /outside the active branch/);
  const normalized = normalizeCheckpoint(rawCheckpoint, new Set(["u1"]));
  assert.deepEqual(normalized.objective.sourceEntryIds, ["u1"]);
  assert.equal(normalized.requirements[0].status, "open");

  const rendered = renderCompactionMemory(normalized, [
    observation("o1", "The user requires branch isolation", ["u1"], { kind: "requirement", status: "open" }),
  ]);
  assert.match(rendered.summary, /## Active task/);
  assert.match(rendered.summary, /Keep branches isolated/);
  assert.match(rendered.summary, /o1 \[requirement open\]/);
  assert.deepEqual(rendered.includedObservationIds, ["o1"]);
});

test("memory search is bounded, supports exclusion, and exact source rendering stays active-branch scoped", () => {
  const observations = [
    observation("o1", "Authentication failed with TS2322 in src/auth.ts", ["u1"], { kind: "blocker" }),
    observation("o2", "Deployment uses Fly", ["u2"]),
  ];
  assert.deepEqual(searchObservations(observations, "auth TS2322").map(({ observation }) => observation.id), ["o1"]);
  assert.deepEqual(searchObservations(observations, "auth", { excludeIds: new Set(["o1"]) }), []);
  assert.deepEqual(searchObservations(observations, "the and to"), []);
  const longQuery = `${Array.from({ length: 600 }, (_, index) => `unrelated${index}`).join(" ")} authentication`;
  assert.deepEqual(searchObservations(observations, longQuery).map(({ observation }) => observation.id), ["o1"]);
  const many = Array.from({ length: 10 }, (_, index) => observation(`m${index}`, `Authentication record ${index}`, ["u1"]));
  assert.equal(searchObservations(many, "authentication").length, 5);
  const output = formatSourceEntries([user("u1", "Exact requirement\n  with spacing")]);
  assert.match(output, /Source entry u1/);
  assert.match(output, /Exact requirement\n  with spacing/);
});

test("automatic continuation is gated by retry, phase, blockers, open work, and a hard cap", () => {
  assert.equal(shouldContinueAfterCompaction(checkpoint(), { willRetry: false, continuationCount: 0 }), true);
  assert.equal(shouldContinueAfterCompaction(checkpoint(), { willRetry: true, continuationCount: 0 }), false);
  assert.equal(shouldContinueAfterCompaction(checkpoint({ phase: "complete", currentAction: undefined, requirements: [] }), { willRetry: false, continuationCount: 0 }), false);
  assert.equal(shouldContinueAfterCompaction(checkpoint({ blockers: [{ id: "b", text: "Need choice", sourceEntryIds: ["u1"], awaitingUser: true }] }), { willRetry: false, continuationCount: 0 }), false);
  assert.equal(shouldContinueAfterCompaction(checkpoint(), { willRetry: false, continuationCount: 2 }), false);
});

test("synthetic memory messages are excluded from future observation chunks", () => {
  assert.equal(isSourceEntry({ type: "custom_message", id: "r", customType: MEMORY_RESUME_MESSAGE }), false);
  assert.equal(isSourceEntry({ type: "custom_message", id: "c", customType: MEMORY_CONTEXT_MESSAGE }), false);
  assert.equal(isSourceEntry({ type: "custom_message", id: "a", customType: "ask" }), true);
  const serialized = serializeSourceEntries([
    assistant("a1", [{ type: "thinking", thinking: "private rationale" }, { type: "text", text: "visible result" }]),
  ]);
  assert.match(serialized, /visible result/);
  assert.doesNotMatch(serialized, /private rationale/);
});

test("mid-run threshold reserves substantial response and compaction headroom", () => {
  assert.equal(midRunCompactionThreshold(128_000), 95_232);
  assert.equal(midRunCompactionThreshold(272_000), 231_200);
  assert.equal(midRunCompactionThreshold(1_050_000), 984_464);
});

test("memory prompts expose bounded prior state, recent transcript, and manual compaction focus", () => {
  const observer = observerInput("new transcript", [{ id: "old", content: "old state" }]);
  assert.match(observer, /PREVIOUS OBSERVATIONS/);
  assert.match(observer, /"id": "old"/);
  const checkpoint = checkpointInput({ phase: "active" }, [], "recent completion", "focus on verification");
  assert.match(checkpoint, /RECENT TRANSCRIPT DATA[\s\S]*recent completion/);
  assert.match(checkpoint, /REQUESTED COMPACTION FOCUS[\s\S]*focus on verification/);
});

test("memory compaction details retain the expected stable discriminator", () => {
  assert.equal(MEMORY_DETAILS_TYPE, "pi-config.memory.compaction");
});
