import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  applyWorkerPatch,
  createWorkerWorkspace,
  discardWorkerWorkspace,
  inspectWorkerPatch,
  recoverWorkerWorkspace,
} from "../extensions/subagents/worktree.ts";

const exec = promisify(execFile);

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "pi-config-subagent-worktree-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitignore"), ".pi/\nnode_modules/\n");
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "outside.ts"), "export const outside = 1;\n");
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  return root;
}

test("worker patches are isolated, hashed, recovered, and applied after inspection", async () => {
  const root = await repository();
  let workspace;
  try {
    workspace = await createWorkerWorkspace(root, "run", "worker", ["src/**"]);
    await writeFile(join(workspace.worktree, "src", "a.ts"), "export const a = 2;\n");
    const inspected = await inspectWorkerPatch(workspace);
    assert.equal(inspected.scopeValid, true);
    assert.deepEqual(inspected.changedFiles, ["src/a.ts"]);
    assert.match(inspected.hash, /^[0-9a-f]{64}$/);
    assert.equal(await readFile(join(root, "src", "a.ts"), "utf8"), "export const a = 1;\n");

    const recovered = await recoverWorkerWorkspace(root, "run", "worker");
    assert.equal(recovered.worktree, workspace.worktree);
    await assert.rejects(() => applyWorkerPatch(workspace, "0".repeat(64)), /changed after inspection/);
    await applyWorkerPatch(workspace, inspected.hash);
    assert.equal(await readFile(join(root, "src", "a.ts"), "utf8"), "export const a = 2;\n");
  } finally {
    if (workspace) await discardWorkerWorkspace(workspace).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("worker scope violations never touch the parent checkout", async () => {
  const root = await repository();
  let workspace;
  try {
    workspace = await createWorkerWorkspace(root, "run", "bad", ["src/**"]);
    await writeFile(join(workspace.worktree, "outside.ts"), "export const outside = 2;\n");
    const inspected = await inspectWorkerPatch(workspace);
    assert.equal(inspected.scopeValid, false);
    assert.deepEqual(inspected.outsideScope, ["outside.ts"]);
    await assert.rejects(() => applyWorkerPatch(workspace, inspected.hash), /outside its scope/);
    assert.equal(await readFile(join(root, "outside.ts"), "utf8"), "export const outside = 1;\n");
  } finally {
    if (workspace) await discardWorkerWorkspace(workspace).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("workers reject dirty parent checkouts", async () => {
  const root = await repository();
  try {
    await writeFile(join(root, "src", "a.ts"), "dirty\n");
    await assert.rejects(() => createWorkerWorkspace(root, "run", "worker", ["src/**"]), /clean parent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
