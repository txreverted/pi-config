import test from "node:test";
import assert from "node:assert/strict";
import {
  activityAgeMs,
  elapsedMs,
  formatRunDuration,
  healthForRun,
  isTerminalLifecycle,
  queuedMs,
} from "../extensions/orchestration-core.ts";

const thresholds = { quietAfterMs: 30_000, longRunningAfterMs: 120_000, needsAttentionAfterMs: 300_000 };

test("run timing uses queued, live, and frozen terminal timestamps", () => {
  const timing = { queuedAt: 1_000, startedAt: 2_000, lastActivityAt: 3_000 };
  assert.equal(queuedMs(timing, 10_000), 1_000);
  assert.equal(elapsedMs(timing, 10_000), 8_000);
  assert.equal(activityAgeMs(timing, 10_000), 7_000);
  assert.equal(elapsedMs({ ...timing, endedAt: 6_000 }, 10_000), 4_000);
  assert.equal(formatRunDuration(61_000), "1m01s");
  assert.equal(formatRunDuration(3_661_000), "1h01m");
});

test("health distinguishes quiet work from evidence that a run failed", () => {
  const timing = { queuedAt: 0, startedAt: 0, lastActivityAt: 0 };
  assert.equal(healthForRun("running", timing, 29_999, thresholds), "healthy");
  assert.equal(healthForRun("running", timing, 30_000, thresholds), "quiet");
  assert.equal(healthForRun("running", timing, 120_000, thresholds), "long_running");
  assert.equal(healthForRun("running", timing, 300_000, thresholds), "needs_attention");
  assert.equal(healthForRun("failed", timing, 1, thresholds), "dead");
  assert.equal(healthForRun("completed", timing, 999_999, thresholds), "healthy");
  assert.equal(isTerminalLifecycle("completed_with_warnings"), true);
  assert.equal(isTerminalLifecycle("running"), false);
});
