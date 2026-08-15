import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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
  assert.equal((await stat(result.fullOutputPath)).mode & 0o077, 0);

  await removeBoundedOutput(result.fullOutputPath);
  await assert.rejects(() => stat(result.fullOutputPath));
});

test("bounded process reports executable startup failures", async () => {
  await assert.rejects(
    () => runBoundedProcess("__pi_config_missing_executable__", [], {
      cwd: process.cwd(),
      tempPrefix: "pi-tools-test-missing",
    }),
    /Failed to start/,
  );
});

test("bounded process enforces timeouts and cancellation", async () => {
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
