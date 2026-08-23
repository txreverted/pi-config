import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  comparisonReport,
  requiredConfiguration,
  summarizeBenchmarkRun,
} from "./live-subagents.mjs";

const PAID_ENV = {
  PI_LIVE_SUBAGENTS: "1",
  PI_LIVE_MODEL: "openai/gpt-5.6-sol",
};

function result(outcome, durationMs, totalTokens, totalCost, output = "") {
  return {
    outcome,
    durationMs,
    output,
    usage: {
      input: totalTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      reasoning: 0,
      totalTokens,
      cost: {
        input: totalCost,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: totalCost,
      },
    },
  };
}

test("live benchmark gates paid runs and defaults to one four-way pass", () => {
  assert.throws(
    () => requiredConfiguration({}),
    /Refusing paid benchmark: set PI_LIVE_SUBAGENTS=1/,
  );
  assert.throws(
    () => requiredConfiguration({ PI_LIVE_SUBAGENTS: "1" }),
    /Set PI_LIVE_MODEL to an explicit provider\/model reference/,
  );
  assert.throws(
    () => requiredConfiguration({ ...PAID_ENV, PI_LIVE_MODEL: "openai/" }),
    /explicit provider\/model/,
  );
  assert.deepEqual(requiredConfiguration(PAID_ENV), {
    provider: "openai",
    modelId: "gpt-5.6-sol",
    count: 4,
    concurrency: 4,
    compare: false,
  });
  assert.equal(requiredConfiguration({ ...PAID_ENV, PI_LIVE_COMPARE: "true" }).compare, false);
  assert.equal(requiredConfiguration({ ...PAID_ENV, PI_LIVE_COMPARE: "1" }).compare, true);
});

test("live benchmark validates scout and candidate concurrency settings", () => {
  for (const value of ["1", "11", "2.5", "many"]) {
    assert.throws(
      () => requiredConfiguration({ ...PAID_ENV, PI_LIVE_SCOUTS: value }),
      /PI_LIVE_SCOUTS must be an integer from 2 through 10/,
    );
  }
  for (const value of ["1", "5", "2.5", "many"]) {
    assert.throws(
      () => requiredConfiguration({ ...PAID_ENV, PI_LIVE_CONCURRENCY: value }),
      /PI_LIVE_CONCURRENCY must be an integer from 2 through 4/,
    );
  }
  assert.equal(requiredConfiguration({ ...PAID_ENV, PI_LIVE_SCOUTS: "10" }).count, 10);
  assert.equal(requiredConfiguration({ ...PAID_ENV, PI_LIVE_CONCURRENCY: "2" }).concurrency, 2);
});

test("benchmark reports aggregate diagnostics without retaining findings", () => {
  const marker = "repository finding must not be logged";
  const summary = summarizeBenchmarkRun({
    concurrency: 4,
    maximumActive: 3,
    wallMs: 100,
    outcomes: [
      { status: "fulfilled", value: result("succeeded", 300, 12, 0.4, marker) },
      { status: "fulfilled", value: result("partial", 200, 8, 0.1, marker) },
      { status: "rejected", reason: new Error(marker) },
    ],
  });
  assert.deepEqual(summary, {
    concurrency: 4,
    maximumActive: 3,
    wallMs: 100,
    summedChildMs: 500,
    observedOverlap: 5,
    tokens: 20,
    cost: 0.5,
    outcomes: {
      succeeded: 1,
      partial: 1,
      failed: 1,
      timed_out: 0,
      aborted: 0,
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(marker));
});

test("comparison report exposes serial and candidate metrics without a speed gate", () => {
  const serial = {
    concurrency: 1,
    maximumActive: 1,
    wallMs: 400,
    summedChildMs: 380,
    observedOverlap: 0.95,
    tokens: 20,
    cost: 0.2,
    outcomes: { succeeded: 4, partial: 0, failed: 0, timed_out: 0, aborted: 0 },
  };
  const candidate = {
    ...serial,
    concurrency: 4,
    maximumActive: 4,
    wallMs: 100,
    summedChildMs: 360,
    observedOverlap: 3.6,
    tokens: 22,
    cost: 0.22,
  };
  assert.deepEqual(comparisonReport({
    model: "openai/gpt-5.6-sol",
    scouts: 4,
    serial,
    candidate,
  }), {
    model: "openai/gpt-5.6-sol",
    scouts: 4,
    candidateConcurrency: 4,
    speedup: 4,
    serial,
    candidate,
  });
  assert.equal(comparisonReport({
    model: "provider/model",
    scouts: 2,
    serial,
    candidate: { ...candidate, wallMs: 0 },
  }).speedup, 0);
});

test("the paid benchmark remains outside checks and CI", async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(packageJson.scripts.check, /bench:subagents:live/);
  for (const setting of [
    "bench:subagents:live",
    "PI_LIVE_SUBAGENTS",
    "PI_LIVE_MODEL",
    "PI_LIVE_SCOUTS",
    "PI_LIVE_CONCURRENCY",
    "PI_LIVE_COMPARE",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(setting));
  }
});
