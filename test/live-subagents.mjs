import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  TERMINAL_SCOUT_OUTCOMES,
  emptyUsage,
  sumUsage,
  timeoutForKind,
} from "../extensions/subagents-core.ts";
import { runOrderedPool } from "../extensions/subagents-pool.ts";
import { resolveRepositoryRoot, sanitizeScoutError } from "../extensions/subagents-guard.ts";
import { runScoutSession } from "../extensions/subagents.ts";

function integerSetting(env, name, fallback, minimum, maximum) {
  const value = Number(env[name]?.trim() || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function requiredConfiguration(env = process.env) {
  if (env.PI_LIVE_SUBAGENTS !== "1") {
    throw new Error("Refusing paid benchmark: set PI_LIVE_SUBAGENTS=1.");
  }
  const reference = env.PI_LIVE_MODEL?.trim();
  const separator = reference?.indexOf("/") ?? -1;
  if (!reference || separator < 1 || separator === reference.length - 1) {
    throw new Error("Set PI_LIVE_MODEL to an explicit provider/model reference.");
  }
  return {
    provider: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
    count: integerSetting(env, "PI_LIVE_SCOUTS", "4", 2, 10),
    concurrency: integerSetting(env, "PI_LIVE_CONCURRENCY", "4", 2, 4),
    compare: env.PI_LIVE_COMPARE === "1",
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

export function summarizeBenchmarkRun({ concurrency, maximumActive, wallMs, outcomes }) {
  const results = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
  const usage = results.length > 0 ? sumUsage(results) : emptyUsage();
  const summedChildMs = results.reduce((total, result) => total + result.durationMs, 0);
  const outcomeCounts = Object.fromEntries(TERMINAL_SCOUT_OUTCOMES.map((name) => [
    name,
    results.filter((result) => result.outcome === name).length,
  ]));
  outcomeCounts.failed += outcomes.filter((outcome) => outcome.status === "rejected").length;
  return {
    concurrency,
    maximumActive,
    wallMs,
    summedChildMs,
    observedOverlap: ratio(summedChildMs, wallMs),
    tokens: usage.totalTokens,
    cost: usage.cost.total,
    outcomes: outcomeCounts,
  };
}

export function comparisonReport({ model, scouts, serial, candidate }) {
  return {
    model,
    scouts,
    candidateConcurrency: candidate.concurrency,
    speedup: ratio(serial.wallMs, candidate.wallMs),
    serial,
    candidate,
  };
}

async function createFixture(directory, count) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "shared.ts"), "export const sharedValue = 41;\n", "utf8");
  await Promise.all(Array.from({ length: count }, (_, index) => writeFile(
    join(directory, `module-${index}.ts`),
    `import { sharedValue } from "./shared.ts";\nexport function value${index}() { return sharedValue + ${index}; }\n`,
    "utf8",
  )));
}

async function runFixture({ fixture, count, concurrency, model, runtime }) {
  const tasks = Array.from({ length: count }, (_, index) => ({
    name: `module-${index}-scout`,
    kind: "survey",
    question: `Inspect module-${index}.ts and shared.ts. Report the exported function, its returned value, and exact line evidence.`,
  }));
  let active = 0;
  let maximumActive = 0;
  const repositoryRoot = await resolveRepositoryRoot(fixture);
  const started = Date.now();
  const outcomes = await runOrderedPool(
    tasks,
    async (task) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        return await runScoutSession({
          ...task,
          cwd: fixture,
          model: `${model.provider}/${model.id}`,
          thinking: "low",
          timeoutMs: timeoutForKind("survey"),
        }, model, runtime, undefined, repositoryRoot);
      } finally {
        active--;
      }
    },
    { concurrency },
  );
  return summarizeBenchmarkRun({
    concurrency,
    maximumActive,
    wallMs: Date.now() - started,
    outcomes,
  });
}

async function main() {
  const config = requiredConfiguration();
  const fixtureRoot = await mkdtemp(join(tmpdir(), "pi-config-live-subagents-"));
  const modelReference = `${config.provider}/${config.modelId}`;
  const mode = config.compare ? `serial versus ${config.concurrency}-way comparison` : `${config.concurrency}-way run`;
  console.error(`Paid benchmark: ${config.count} scouts using ${modelReference}; ${mode}. Findings are not logged.`);
  try {
    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    const model = runtime.getModel(config.provider, config.modelId);
    if (!model) throw new Error(`Model is unavailable: ${modelReference}.`);

    if (config.compare) {
      const serialFixture = join(fixtureRoot, "serial");
      const candidateFixture = join(fixtureRoot, "candidate");
      await Promise.all([
        createFixture(serialFixture, config.count),
        createFixture(candidateFixture, config.count),
      ]);
      const serial = await runFixture({
        fixture: serialFixture,
        count: config.count,
        concurrency: 1,
        model,
        runtime,
      });
      const candidate = await runFixture({
        fixture: candidateFixture,
        count: config.count,
        concurrency: config.concurrency,
        model,
        runtime,
      });
      console.log(JSON.stringify(comparisonReport({
        model: modelReference,
        scouts: config.count,
        serial,
        candidate,
      }), null, 2));
      return;
    }

    const fixture = join(fixtureRoot, "candidate");
    await createFixture(fixture, config.count);
    const candidate = await runFixture({
      fixture,
      count: config.count,
      concurrency: config.concurrency,
      model,
      runtime,
    });
    console.log(JSON.stringify({ model: modelReference, scouts: config.count, ...candidate }, null, 2));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(sanitizeScoutError(error));
    process.exitCode = 1;
  });
}
