import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeBoundedOutput, runBoundedProcess } from "../extensions/tools-core.ts";

test("bounded process keeps small output in memory and removes its temporary file", async () => {
  const result = await runBoundedProcess(process.execPath, ["-e", "process.stdout.write('ok\\n')"], {
    cwd: process.cwd(),
    tempPrefix: "pi-tools-test-small",
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok\n");
  assert.equal(result.truncation, undefined);
  assert.equal(result.fullOutputPath, undefined);
});

test("bounded process streams complete truncated output to a private temporary file", async () => {
  const result = await runBoundedProcess(
    process.execPath,
    ["-e", "process.stdout.write('line\\n'.repeat(3000))"],
    { cwd: process.cwd(), tempPrefix: "pi-tools-test-large" },
  );

  assert.equal(result.code, 0);
  assert.equal(result.truncation?.truncated, true);
  assert.equal(result.truncation?.truncatedBy, "lines");
  assert.equal(result.truncation?.totalLines, 3000);
  assert.ok(result.fullOutputPath);
  assert.equal((await readFile(result.fullOutputPath, "utf8")).split("\n").length, 3001);
  if (process.platform !== "win32") assert.equal((await stat(result.fullOutputPath)).mode & 0o077, 0);

  await removeBoundedOutput(result.fullOutputPath);
  await assert.rejects(() => stat(result.fullOutputPath));
});

test("bounded process stops at a hard stdout limit", async () => {
  const hardLimit = 64 * 1024;
  const result = await runBoundedProcess(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(1024 * 1024))"],
    { cwd: process.cwd(), maxOutputBytes: hardLimit, tempPrefix: "pi-tools-test-hard-limit" },
  );

  assert.equal(result.outputLimitReached, hardLimit);
  assert.equal(result.truncation?.totalBytes, hardLimit);
  assert.ok(result.fullOutputPath);
  assert.equal((await stat(result.fullOutputPath)).size, hardLimit);
  await removeBoundedOutput(result.fullOutputPath);
});

test("bounded process applies the hard output limit to stderr and combined streams", async () => {
  const hardLimit = 64 * 1024;
  for (const script of [
    "process.stderr.write('e'.repeat(128 * 1024))",
    "process.stdout.write('o'.repeat(48 * 1024)); process.stderr.write('e'.repeat(48 * 1024))",
  ]) {
    const result = await runBoundedProcess(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      maxOutputBytes: hardLimit,
      tempPrefix: "pi-tools-test-combined-limit",
    });

    assert.equal(result.outputLimitReached, hardLimit);
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= hardLimit + 128);
    if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
  }
});

test("bounded process reports executable startup failures", async () => {
  await assert.rejects(
    () => runBoundedProcess("__pi_config_missing_executable__", [], {
      cwd: process.cwd(),
      tempPrefix: "pi-tools-test-missing",
    }),
    /Failed to start/,
  );
  await assert.rejects(
    () => runBoundedProcess(process.execPath, ["bad\0argument"], {
      cwd: process.cwd(),
      tempPrefix: "pi-tools-test-nul",
    }),
    /NUL bytes/,
  );
});

test("bounded process rejects invalid resource bounds before spawning", async () => {
  const tempPrefix = `pi-tools-test-invalid-bound-${process.pid}`;
  try {
    for (const options of [
      { maxOutputBytes: 0 },
      { maxMemoryBytes: 0 },
      { memoryPollMs: 0 },
      { timeoutMs: 0 },
    ]) {
      await assert.rejects(
        () => runBoundedProcess("__pi_config_invalid_bound_must_not_spawn__", [], {
          cwd: process.cwd(),
          tempPrefix,
          ...options,
        }),
        /positive integer/,
      );
    }
    assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith(`${tempPrefix}-`)), []);
  } finally {
    const leaked = (await readdir(tmpdir())).filter((name) => name.startsWith(`${tempPrefix}-`));
    await Promise.all(leaked.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true })));
  }
});

test("bounded process terminates when the working-set monitor crosses its limit", async () => {
  await assert.rejects(
    () => runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      maxMemoryBytes: 1,
      memoryPollMs: 1,
      memoryUsage: async () => 2,
      tempPrefix: "pi-tools-test-memory-limit",
    }),
    /exceeded the 1-byte memory limit/,
  );
});

test("bounded process ignores best-effort working-set sampler failures", async () => {
  const result = await runBoundedProcess(process.execPath, ["-e", "process.stdout.write('ok')"], {
    cwd: process.cwd(),
    memoryPollMs: 1,
    memoryUsage: async () => { throw new Error("sampler failed"); },
    tempPrefix: "pi-tools-test-memory-sampler-failure",
  });
  assert.equal(result.stdout, "ok");
});

test("bounded process enforces timeouts and cancellation", async () => {
  const immediateController = new AbortController();
  const immediate = runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: process.cwd(),
    signal: immediateController.signal,
    tempPrefix: "pi-tools-test-immediate-abort",
  });
  immediateController.abort();
  await assert.rejects(() => immediate, /aborted/);

  await assert.rejects(
    () => runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      timeoutMs: 30,
      tempPrefix: "pi-tools-test-timeout",
    }),
    /timed out/,
  );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    () => runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      signal: controller.signal,
      tempPrefix: "pi-tools-test-abort",
    }),
    /aborted/,
  );
});
