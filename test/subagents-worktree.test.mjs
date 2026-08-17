import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import writableAgentPolicy, { stripChildCommandEnvironment } from "../extensions/subagents-policy.ts";
import { agentDiff, applyAgentDiff, createAgentWorktree, discardAgentWorktree } from "../extensions/subagents-worktree.ts";

const execFile = promisify(execFileCallback);
async function git(cwd, ...args) { return execFile("git", args, { cwd }); }

test("writable worktrees isolate changes and apply only onto clean parent paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-worktree-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent-dir");
  let first;
  let second;
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "file.txt"), "base\n");
    await git(root, "add", "file.txt");
    await git(root, "commit", "-qm", "base");
    first = await createAgentWorktree(root, "writer-one");
    second = await createAgentWorktree(root, "writer-two");
    await writeFile(join(first.worktree, "file.txt"), "first\n");
    await writeFile(join(first.worktree, "new.bin"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(second.worktree, "file.txt"), "second\n");
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "base\n");
    const patch = await agentDiff(first);
    await writeFile(join(root, "file.txt"), "dirty\n");
    await assert.rejects(() => applyAgentDiff(first, patch), /dirty paths/);
    await writeFile(join(root, "file.txt"), "base\n");
    await applyAgentDiff(first, patch);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "first\n");
    assert.deepEqual(await readFile(join(root, "new.bin")), Buffer.from([0, 1, 2, 255]));
  } finally {
    if (first) await discardAgentWorktree(first).catch(() => {});
    if (second) await discardAgentWorktree(second).catch(() => {});
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("dirty checks handle tracked filenames containing newlines", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-newline-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent-dir");
  let workspace;
  const filename = "line\nbreak.txt";
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, filename), "base\n");
    await git(root, "add", "--", filename);
    await git(root, "commit", "-qm", "base");
    workspace = await createAgentWorktree(root, "newline-writer");
    await writeFile(join(workspace.worktree, filename), "agent\n");
    const patch = await agentDiff(workspace);
    await writeFile(join(root, filename), "parent\n");
    await assert.rejects(() => applyAgentDiff(workspace, patch), /dirty paths/);
  } finally {
    if (workspace) await discardAgentWorktree(workspace).catch(() => {});
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("writable policy strips secrets and blocks path and symlink escapes before approval", async () => {
  assert.deepEqual(stripChildCommandEnvironment({ PATH: "/bin", API_TOKEN: "x", COOKIE: "y", PI_CONFIG_BROKER_TOKEN: "z" }), { PATH: "/bin" });
  const root = await mkdtemp(join(tmpdir(), "pi-agent-policy-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-agent-outside-"));
  const previous = { child: process.env.PI_CONFIG_SUBAGENT_CHILD, worktree: process.env.PI_CONFIG_AGENT_WORKTREE, cwd: process.env.PI_CONFIG_AGENT_CWD };
  try {
    await symlink(join(outside, "target"), join(root, "link"));
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    process.env.PI_CONFIG_AGENT_WORKTREE = root;
    process.env.PI_CONFIG_AGENT_CWD = root;
    let handler;
    writableAgentPolicy({ registerTool() {}, on(name, value) { if (name === "tool_call") handler = value; } });
    assert.match((await handler({ toolName: "read", toolCallId: "r", input: { path: outside } })).reason, /inside/);
    assert.match((await handler({ toolName: "write", toolCallId: "w", input: { path: join(root, "link") } })).reason, /symlink/);
    assert.match((await handler({ toolName: "unknown", toolCallId: "u", input: {} })).reason, /not allowed/);
  } finally {
    if (previous.child === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD; else process.env.PI_CONFIG_SUBAGENT_CHILD = previous.child;
    if (previous.worktree === undefined) delete process.env.PI_CONFIG_AGENT_WORKTREE; else process.env.PI_CONFIG_AGENT_WORKTREE = previous.worktree;
    if (previous.cwd === undefined) delete process.env.PI_CONFIG_AGENT_CWD; else process.env.PI_CONFIG_AGENT_CWD = previous.cwd;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});
