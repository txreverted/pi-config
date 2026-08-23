import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryCredentialStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveRepositoryRoot } from "../extensions/subagents-guard.ts";
import { runOrderedPool } from "../extensions/subagents-pool.ts";
import { runScoutSession, SCOUT_TOOLS } from "../extensions/subagents.ts";

function taskIndex(context) {
  const text = context.messages
    .flatMap((message) => message.role === "user" && Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return Number(/module-(\d+)\.ts/.exec(text)?.[1] ?? 0);
}

function latestToolText(context) {
  const message = [...context.messages].reverse().find((entry) => entry.role === "toolResult");
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

test("real in-memory child sessions overlap through the faux provider and remain isolated", { timeout: 10_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagents-faux-"));
  const count = 4;
  try {
    await mkdir(join(cwd, ".git"));
    await Promise.all(Array.from({ length: count }, (_, index) => writeFile(
      join(cwd, `module-${index}.ts`),
      `export const module${index} = ${index};\n`,
      "utf8",
    )));

    const faux = fauxProvider({ provider: "pi-config-faux" });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "offline-faux" }));
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    const model = faux.getModel();
    const repositoryRoot = await resolveRepositoryRoot(cwd);

    let arrivals = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
    const seenTools = [];
    const seenPrompts = [];
    faux.setResponses([
      ...Array.from({ length: count }, () => async (context) => {
        arrivals++;
        seenTools.push((context.tools ?? []).map((tool) => tool.name).sort());
        seenPrompts.push(context.systemPrompt);
        if (arrivals === count) releaseBarrier();
        await barrier;
        const index = taskIndex(context);
        return fauxAssistantMessage(
          fauxToolCall("read", { path: `module-${index}.ts` }, { id: `read-module-${index}` }),
          { stopReason: "toolUse" },
        );
      }),
      ...Array.from({ length: count }, () => (context) => {
        const index = taskIndex(context);
        return fauxAssistantMessage(fauxText(`module-${index}.ts:1 exports module${index}.`));
      }),
    ]);

    const progress = Array.from({ length: count }, () => []);
    const tasks = Array.from({ length: count }, (_, index) => ({
      name: `module-${index}-scout`,
      kind: "survey",
      question: `Inspect module-${index}.ts and report its export with exact line evidence.`,
    }));
    const outcomes = await runOrderedPool(
      tasks,
      (task, index) => runScoutSession({
        ...task,
        cwd,
        model: `${model.provider}/${model.id}`,
        thinking: "low",
        timeoutMs: 5_000,
      }, model, runtime, (update) => progress[index].push(update), repositoryRoot),
      { concurrency: count },
    );

    assert.equal(arrivals, count, "all first provider requests must reach the barrier together");
    assert.equal(faux.state.callCount, count * 2);
    assert.deepEqual(seenTools, Array.from({ length: count }, () => [...SCOUT_TOOLS].sort()));
    assert.equal(seenPrompts.every((prompt) => /read-only repository scout/.test(prompt)), true);
    const results = outcomes.map((outcome) => {
      assert.equal(outcome.status, "fulfilled");
      return outcome.value;
    });
    assert.deepEqual(results.map((result) => result.outcome), Array.from({ length: count }, () => "succeeded"));
    assert.deepEqual(results.map((result) => result.toolUses), Array.from({ length: count }, () => 1));
    assert.deepEqual(results.map((result) => result.turns), Array.from({ length: count }, () => 2));
    assert.deepEqual(results.map((result) => result.output), tasks.map((_, index) => `module-${index}.ts:1 exports module${index}.`));
    assert.equal(progress.every((updates) => updates.some((update) => update.phase === "running" && update.toolUses === 1)), true);
    assert.equal(progress.every((updates) => updates.length < 20), true, "token deltas must not become outer progress updates");
    const files = await readdir(cwd, { recursive: true });
    assert.equal(files.some((path) => path.endsWith(".jsonl")), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a real child session cannot see direct or broad-list protected state", { timeout: 10_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagents-faux-guard-"));
  try {
    await mkdir(join(cwd, ".git"));
    await mkdir(join(cwd, ".codex"));
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, ".env"), "API_KEY=super-secret-value\n", "utf8");
    await writeFile(join(cwd, ".codex", "session.json"), "private-state\n", "utf8");
    await writeFile(join(cwd, "src", "auth.ts"), "export const visible = true;\n", "utf8");

    const faux = fauxProvider({ provider: "pi-config-guard-faux" });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "offline-faux" }));
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(faux.provider);
    const model = faux.getModel();
    const seenToolResults = [];
    faux.setResponses([
      () => fauxAssistantMessage(
        fauxToolCall("read", { path: ".env" }, { id: "blocked-read" }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        seenToolResults.push(latestToolText(context));
        return fauxAssistantMessage(
          fauxToolCall("ls", { path: "." }, { id: "broad-list" }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        seenToolResults.push(latestToolText(context));
        return fauxAssistantMessage(fauxText("Protected state stayed outside model-visible tool output."));
      },
    ]);

    const result = await runScoutSession({
      name: "guard-scout",
      kind: "survey",
      question: "Inspect public repository structure without exposing any private runtime state.",
      cwd,
      model: `${model.provider}/${model.id}`,
      thinking: "low",
      timeoutMs: 5_000,
    }, model, runtime);

    assert.equal(result.outcome, "succeeded");
    assert.match(seenToolResults[0], /protected paths|private state|unavailable/i);
    assert.doesNotMatch(seenToolResults.join("\n"), /super-secret-value|private-state/);
    assert.match(seenToolResults[1], /src\//);
    assert.match(seenToolResults[1], /Protected paths removed/);
    assert.doesNotMatch(seenToolResults[1], /\.env|\.git|\.codex|session\.json/);
    const files = await readdir(cwd, { recursive: true });
    assert.equal(files.some((path) => path.endsWith(".jsonl")), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("real child sessions cooperatively distinguish parent abort and timeout without persistence", { timeout: 10_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagents-cancel-"));
  try {
    await mkdir(join(cwd, ".git"));
    await writeFile(join(cwd, "module.ts"), "export const value = 1;\n", "utf8");
    const faux = fauxProvider({ provider: "pi-config-cancel-faux" });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "offline-faux" }));
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(faux.provider);
    const model = faux.getModel();

    const run = async (mode) => {
      let enteredResolve;
      const entered = new Promise((resolve) => { enteredResolve = resolve; });
      let providerAborted = false;
      faux.setResponses([async (_context, options) => {
        enteredResolve();
        await new Promise((resolve) => options.signal.addEventListener("abort", () => {
          providerAborted = true;
          resolve();
        }, { once: true }));
        return fauxAssistantMessage(fauxText("late output must not change the terminal outcome"));
      }]);
      const controller = new AbortController();
      const progress = [];
      const execution = runScoutSession({
        name: `${mode}-scout`,
        kind: "survey",
        question: "Inspect module.ts and report its export with exact line evidence.",
        cwd,
        model: `${model.provider}/${model.id}`,
        thinking: "low",
        timeoutMs: mode === "timeout" ? 500 : 5_000,
        signal: controller.signal,
      }, model, runtime, (update) => progress.push(update));
      await entered;
      if (mode === "abort") controller.abort();
      const result = await execution;
      const progressCount = progress.length;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(progress.length, progressCount, "disposed sessions must suppress late progress");
      assert.equal(providerAborted, true);
      return result;
    };

    assert.equal((await run("abort")).outcome, "aborted");
    assert.equal((await run("timeout")).outcome, "timed_out");
    const files = await readdir(cwd, { recursive: true });
    assert.equal(files.some((path) => path.endsWith(".jsonl")), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
