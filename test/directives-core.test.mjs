import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DIRECTIVE_REMINDER_CHARS,
  applyDirectiveOperation,
  buildDirectiveReminder,
  makeDeliverOperation,
  makeEnqueueOperation,
  makeRecoverOperation,
  makeRetireOperation,
  missingDeliveredDirectives,
  observeDirectiveDelivery,
  parseDirectiveOperation,
  replayDirectiveEvents,
} from "../extensions/directives-core.ts";

function directive(id, mode = "steer", text = "Keep the change focused") {
  return { id, mode, phase: "queued", text, createdAt: 1 };
}

test("directive operations validate and replay as an append-only ledger", () => {
  const id = "12345678-abcd-1234-abcd-123456789abc";
  const enqueue = makeEnqueueOperation(directive(id));
  const active = replayDirectiveEvents([
    { type: "user", text: "Initial prompt" },
    { type: "operation", value: enqueue },
    { type: "operation", value: makeDeliverOperation(id, "Expanded directive text") },
    { type: "user", text: "Expanded directive text" },
  ]);

  assert.equal(active.size, 1);
  assert.equal(active.get(id).phase, "delivered");
  assert.equal(active.get(id).deliveredText, "Expanded directive text");

  applyDirectiveOperation(active, makeRetireOperation([id]));
  assert.equal(active.size, 0);
  assert.equal(parseDirectiveOperation({ version: 1, op: "recover", id: "bad" }), undefined);
  assert.equal(parseDirectiveOperation({ version: 2, op: "retire", ids: [id] }), undefined);
});

test("observed user delivery matches exact text before queue-order fallback", () => {
  const steerId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const followId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const active = new Map([
    [steerId, directive(steerId, "steer", "Steer text")],
    [followId, directive(followId, "followUp", "/template raw")],
  ]);

  const selected = observeDirectiveDelivery(active, "Expanded follow-up text");
  assert.equal(selected.id, steerId);
  assert.equal(selected.phase, "delivered");

  const exact = observeDirectiveDelivery(active, "/template raw");
  assert.equal(exact.id, followId);
});

test("only delivered or recovered directives missing from context are reinforced", () => {
  const deliveredId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const queuedId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const recoveredId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const active = new Map([
    [deliveredId, { ...directive(deliveredId), phase: "delivered", deliveredText: "Do not change API names" }],
    [queuedId, directive(queuedId, "followUp", "Summarize afterward")],
    [recoveredId, { ...directive(recoveredId, "steer", "Preserve compatibility"), phase: "recovered" }],
  ]);

  const present = missingDeliveredDirectives(active, [
    { role: "user", content: [{ type: "text", text: "Do not change API names" }] },
  ]);
  assert.deepEqual(present.map((item) => item.id), [recoveredId]);

  const compacted = missingDeliveredDirectives(active, [
    { role: "compactionSummary", summary: "The user requested a careful refactor." },
  ]);
  assert.deepEqual(compacted.map((item) => item.id), [deliveredId, recoveredId]);

  applyDirectiveOperation(active, makeRecoverOperation(queuedId));
  assert.deepEqual(
    missingDeliveredDirectives(active, []).map((item) => item.id),
    [deliveredId, queuedId, recoveredId],
  );
});

test("compaction summary exact text counts as present", () => {
  const id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const active = new Map([
    [id, { ...directive(id), phase: "delivered", deliveredText: "Keep this exact constraint" }],
  ]);
  assert.deepEqual(missingDeliveredDirectives(active, [
    { role: "compactionSummary", summary: "Constraints: Keep this exact constraint" },
  ]), []);
});

test("directive reminders are identified, bounded, and omit queued items supplied by caller", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const reminder = buildDirectiveReminder([
    { ...directive(id, "steer", "x".repeat(50_000)), phase: "recovered" },
  ]);
  assert.match(reminder, /active-user-directives/);
  assert.match(reminder, /user-authored/);
  assert.match(reminder, /Directive truncated/);
  assert.ok(reminder.length <= MAX_DIRECTIVE_REMINDER_CHARS);
  assert.match(reminder, new RegExp(id));
});
