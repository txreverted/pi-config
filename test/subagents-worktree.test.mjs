import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import writableAgentPolicy, { stripChildCommandEnvironment } from "../extensions/subagents-policy.ts";
import { agentDiff, applyAgentDiff, createAgentWorktree, discardAgentWorktree, recoverAgentWorktree } from "../extensions/subagents-worktree.ts";

const execFile = promisify(execFileCallback);
async function git(cwd, ...args) { return execFile("git", args, { cwd }); }

test("writable worktrees isolate changes and apply only onto clean parent paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-worktree-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "pi-agent-state-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  let first;
  let second;
  let dotted;
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "file.txt"), "base\n");
    await git(root, "add", "file.txt");
    await git(root, "commit", "-qm", "base");
    first = await createAgentWorktree(root, "writer-one");
    second = await createAgentWorktree(root, "writer-two");
    dotted = await createAgentWorktree(root, "writer-one.json");
    await writeFile(join(first.worktree, "file.txt"), "first\n");
    await writeFile(join(first.worktree, "new.bin"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(first.worktree, "empty.txt"), "");
    await writeFile(join(second.worktree, "file.txt"), "second\n");
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "base\n");
    const patch = await agentDiff(first);
    await writeFile(join(root, "file.txt"), "dirty\n");
    await assert.rejects(() => applyAgentDiff(first, patch), /dirty paths/);
    await writeFile(join(root, "file.txt"), "base\n");
    await applyAgentDiff(first, patch);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "first\n");
    assert.deepEqual(await readFile(join(root, "new.bin")), Buffer.from([0, 1, 2, 255]));
    assert.equal(await readFile(join(root, "empty.txt"), "utf8"), "");
    const appliedWorktree = first.worktree;
    await discardAgentWorktree(first);
    first = undefined;
    await assert.rejects(access(appliedWorktree));
  } finally {
    if (first) await discardAgentWorktree(first).catch(() => {});
    if (second) await discardAgentWorktree(second).catch(() => {});
    if (dotted) await discardAgentWorktree(dotted).catch(() => {});
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentRoot, { recursive: true, force: true })]);
  }
});

test("worktree recovery keeps the exact base across divergent parent history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-recovery-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "pi-agent-state-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  let workspace;
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "base.txt"), "A\n");
    await git(root, "add", "base.txt");
    await git(root, "commit", "-qm", "A");
    const commitA = (await git(root, "rev-parse", "HEAD")).stdout.trim();
    await writeFile(join(root, "history.txt"), "B\n");
    await git(root, "add", "history.txt");
    await git(root, "commit", "-qm", "B");
    workspace = await createAgentWorktree(root, "recover-worker");
    await writeFile(join(workspace.worktree, "worker.txt"), "worker\n");

    await git(root, "reset", "--hard", commitA);
    await writeFile(join(root, "divergent.txt"), "C\n");
    await git(root, "add", "divergent.txt");
    await git(root, "commit", "-qm", "C");

    const recovered = await recoverAgentWorktree(root, "recover-worker");
    const patch = await agentDiff(recovered);
    assert.match(patch, /worker\.txt/);
    assert.doesNotMatch(patch, /history\.txt|divergent\.txt/);
  } finally {
    if (workspace) await discardAgentWorktree(workspace).catch(() => {});
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentRoot, { recursive: true, force: true })]);
  }
});

test("dirty checks handle tracked filenames containing newlines", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-newline-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "pi-agent-state-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentRoot;
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
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentRoot, { recursive: true, force: true })]);
  }
});

test("worker worktrees reject dirty parent checkouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-dirty-launch-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "pi-agent-state-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "file.txt"), "base\n");
    await git(root, "add", "file.txt");
    await git(root, "commit", "-qm", "base");
    await writeFile(join(root, "file.txt"), "dirty\n");
    await assert.rejects(() => createAgentWorktree(root, "dirty-writer"), /clean parent checkout/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentRoot, { recursive: true, force: true })]);
  }
});

test("read-only agent tools remain inside their delegated workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-read-policy-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-agent-read-outside-"));
  const previous = {
    child: process.env.PI_CONFIG_SUBAGENT_CHILD,
    workspace: process.env.PI_CONFIG_AGENT_WORKSPACE,
    worktree: process.env.PI_CONFIG_AGENT_WORKTREE,
    cwd: process.env.PI_CONFIG_AGENT_CWD,
  };
  try {
    await symlink(outside, join(root, "escape"));
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    process.env.PI_CONFIG_AGENT_WORKSPACE = await realpath(root);
    process.env.PI_CONFIG_AGENT_CWD = await realpath(root);
    delete process.env.PI_CONFIG_AGENT_WORKTREE;
    let handler;
    writableAgentPolicy({ registerTool() {}, on(name, value) { if (name === "tool_call") handler = value; } });
    assert.equal(await handler({ toolName: "read", input: { path: root } }), undefined);
    assert.match((await handler({ toolName: "read", input: { path: outside } })).reason, /inside/);
    assert.match((await handler({ toolName: "read", input: { path: join(root, "escape") } })).reason, /inside/);
    assert.equal(await handler({ toolName: "git_status", input: {} }), undefined);
    assert.match((await handler({ toolName: "bash", input: { command: "pwd" } })).reason, /not allowed/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const name = `PI_CONFIG_AGENT_${key.toUpperCase()}`;
      if (key === "child") continue;
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (previous.child === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD; else process.env.PI_CONFIG_SUBAGENT_CHILD = previous.child;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test("writable policy runs tools without approval while blocking path and symlink escapes", async () => {
  assert.deepEqual(stripChildCommandEnvironment({
    PATH: "/bin", LANG: "en_US.UTF-8", API_TOKEN: "x", COOKIE: "y", PI_CONFIG_BROKER_TOKEN: "z",
    PGPASSWORD: "password", DATABASE_URL: "postgres://user:password@example.test/db",
    HTTPS_PROXY: "https://user:password@proxy.example.test", HOME: "/home/user", NODE_OPTIONS: "--require=/tmp/hook.js",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json", AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/id",
  }), { PATH: "/bin", LANG: "en_US.UTF-8" });
  assert.deepEqual(stripChildCommandEnvironment({ Path: "C:\\bin", SystemRoot: "C:\\Windows", SECRET: "x" }, "win32"), {
    Path: "C:\\bin", SystemRoot: "C:\\Windows",
  });
  const root = await mkdtemp(join(tmpdir(), "pi-agent-policy-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-agent-outside-"));
  const previous = { child: process.env.PI_CONFIG_SUBAGENT_CHILD, worktree: process.env.PI_CONFIG_AGENT_WORKTREE, cwd: process.env.PI_CONFIG_AGENT_CWD };
  try {
    await symlink(join(outside, "target"), join(root, "link"));
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    const workspace = await realpath(root);
    process.env.PI_CONFIG_AGENT_WORKTREE = workspace;
    process.env.PI_CONFIG_AGENT_CWD = workspace;
    let handler;
    writableAgentPolicy({ registerTool() {}, on(name, value) { if (name === "tool_call") handler = value; } });
    assert.equal(await handler({ toolName: "bash", toolCallId: "b", input: { command: "printf ok" } }), undefined);
    assert.equal(await handler({ toolName: "write", toolCallId: "w", input: { path: join(workspace, "new.txt") } }), undefined);
    assert.match((await handler({ toolName: "write", toolCallId: "w", input: { path: `@${join(outside, "new.txt")}` } })).reason, /inside/);
    assert.match((await handler({ toolName: "read", toolCallId: "r", input: { path: outside } })).reason, /inside/);
    assert.match((await handler({ toolName: "write", toolCallId: "w", input: { path: join(workspace, "link") } })).reason, /symlink/);
    assert.match((await handler({ toolName: "unknown", toolCallId: "u", input: {} })).reason, /not allowed/);
  } finally {
    if (previous.child === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD; else process.env.PI_CONFIG_SUBAGENT_CHILD = previous.child;
    if (previous.worktree === undefined) delete process.env.PI_CONFIG_AGENT_WORKTREE; else process.env.PI_CONFIG_AGENT_WORKTREE = previous.worktree;
    if (previous.cwd === undefined) delete process.env.PI_CONFIG_AGENT_CWD; else process.env.PI_CONFIG_AGENT_CWD = previous.cwd;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});
