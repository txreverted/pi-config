import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  DEFAULT_MAX_BYTES,
  getAgentDir,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import indexedSearchExtension, {
  formatIndexedFindResult,
  formatIndexedGrepResult,
} from "../extensions/indexed-search.ts";

const execute = promisify(execFile);

function fakePi(searchSource = "builtin") {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  return {
    handlers,
    tools,
    commands,
    on(name, handler) { handlers.set(name, handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    setSearchSource(source) { searchSource = source; },
    getAllTools() {
      return ["grep", "find"].map((name) => ({ name, sourceInfo: { source: searchSource } }));
    },
  };
}

function context(cwd) {
  const statuses = [];
  const notices = [];
  return {
    cwd,
    statuses,
    notices,
    ui: {
      setStatus(key, text) { statuses.push({ key, text }); },
      notify(message, type) { notices.push({ message, type }); },
    },
  };
}

async function waitFor(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "pi indexed search "));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "packages", "app", "src"), { recursive: true });
  await mkdir(join(root, "empty-dir"));
  await writeFile(join(root, ".gitignore"), "ignored.ts\nreal-secret.txt\n");
  await writeFile(join(root, "src", "main.ts"), "export const id = 1;\nconst label = 'Needle';\nconst syntax = '\"OR\"';\n  const spaced  =  1;  \n");
  await writeFile(join(root, "src", "root.spec.ts"), "export const rootSpec = true;\n");
  await writeFile(join(root, "packages", "app", "src", "nested.spec.ts"), "export const nestedSpec = true;\n");
  await writeFile(join(root, "src", "naïve[unit].ts"), "export const unicode = 'café';\n");
  await writeFile(join(root, "untracked.ts"), "export const loose = 'Needle';\n");
  await writeFile(join(root, "#note.ts"), "export const hash = 'HashNeedle';\n");
  await writeFile(join(root, "!note.ts"), "export const bang = 'BangNeedle';\n");
  await writeFile(join(root, "Upper.TS"), "export const upper = 'CaseNeedle';\n");
  await writeFile(join(root, "ignored.ts"), "export const ignored = 'Needle';\n");
  await writeFile(join(root, "real-secret.txt"), "OutsideSecret\n");
  if (process.platform !== "win32") await symlink("../real-secret.txt", join(root, "src", "linked.ts"));
  await execute("git", ["init", "-q"], { cwd: root });
  await execute("git", ["add", ".gitignore", "src/main.ts", "src/naïve[unit].ts", ...(process.platform === "win32" ? [] : ["src/linked.ts"])], { cwd: root });
  return root;
}

async function waitForIndex(pi, ctx, message) {
  await waitFor(async () => {
    await pi.commands.get("search-index").handler("", ctx);
    return /Search index: ready/.test(ctx.notices.at(-1)?.message ?? "");
  }, message);
}

async function rescanIndex(pi, ctx, message) {
  await pi.commands.get("search-index").handler("rescan", ctx);
  await waitForIndex(pi, ctx, message);
}

async function start(root) {
  const pi = fakePi();
  const ctx = context(root);
  indexedSearchExtension(pi);
  assert.equal(pi.tools.size, 0, "extension factory must not start or register session tools");
  await pi.handlers.get("session_start")({}, ctx);
  await waitFor(() => pi.tools.get("grep") && pi.tools.get("find"), "indexed tools did not become ready");
  return { pi, ctx };
}

test("session index preserves native schemas and searches tracked and untracked code", async () => {
  const root = await repository();
  const { pi, ctx } = await start(root);
  try {
    const find = pi.tools.get("find");
    const grep = pi.tools.get("grep");
    assert.deepEqual(find.parameters, createFindToolDefinition(root).parameters);
    assert.deepEqual(grep.parameters, createGrepToolDefinition(root).parameters);

    const found = await find.execute("find", { pattern: "*.ts", limit: 20 }, undefined, undefined, ctx);
    const foundText = found.content[0].text;
    assert.match(foundText, /src\/main\.ts/);
    assert.match(foundText, /src\/naïve\[unit\]\.ts/);
    assert.match(foundText, /untracked\.ts/);
    assert.doesNotMatch(foundText, /ignored\.ts/);
    const emptyDirectory = await find.execute("find-empty", { pattern: "empty-dir", limit: 20 }, undefined, undefined, ctx);
    assert.match(emptyDirectory.content[0].text, /empty-dir\//);
    const hashPath = await find.execute("find-hash", { pattern: "#*.ts", limit: 20 }, undefined, undefined, ctx);
    assert.match(hashPath.content[0].text, /#note\.ts/);
    const bangPath = await find.execute("find-bang", { pattern: "!*.ts", limit: 20 }, undefined, undefined, ctx);
    assert.match(bangPath.content[0].text, /!note\.ts/);
    const smartCase = await find.execute("find-smart-case", { pattern: "*.ts", limit: 20 }, undefined, undefined, ctx);
    assert.match(smartCase.content[0].text, /Upper\.TS/);
    const strictCase = await find.execute("find-strict-case", { pattern: "*.Ts", limit: 20 }, undefined, undefined, ctx);
    assert.doesNotMatch(strictCase.content[0].text, /Upper\.TS/);
    const absoluteGlob = await find.execute("find-absolute", { pattern: join(root, "src", "*.ts"), limit: 20 }, undefined, undefined, ctx);
    assert.match(absoluteGlob.content[0].text, /src\/main\.ts/);

    const scoped = await find.execute("find-scoped", { pattern: "*.ts", path: "src", limit: 20 }, undefined, undefined, ctx);
    assert.match(scoped.content[0].text, /^main\.ts$/m);
    assert.doesNotMatch(scoped.content[0].text, /src\/main\.ts/);
    const pathGlob = await find.execute("find-path-glob", { pattern: "src/**/*.spec.ts", limit: 20 }, undefined, undefined, ctx);
    assert.match(pathGlob.content[0].text, /^src\/root\.spec\.ts$/m);
    assert.match(pathGlob.content[0].text, /^packages\/app\/src\/nested\.spec\.ts$/m);

    const literal = await grep.execute("grep", {
      pattern: "needle",
      literal: true,
      ignoreCase: true,
      context: 1,
      limit: 10,
    }, undefined, undefined, ctx);
    assert.match(literal.content[0].text, /src\/main\.ts:2:/);
    assert.match(literal.content[0].text, /untracked\.ts:1:/);
    assert.doesNotMatch(literal.content[0].text, /ignored\.ts/);
    const explicitIgnored = await grep.execute("grep-ignored", { pattern: "Needle", literal: true, path: "ignored.ts" }, undefined, undefined, ctx);
    assert.match(explicitIgnored.content[0].text, /ignored\.ts:1:/);
    if (process.platform !== "win32") {
      const linked = await grep.execute("grep-linked", { pattern: "OutsideSecret", literal: true }, undefined, undefined, ctx);
      assert.match(linked.content[0].text, /No matches found/);
    }

    const short = await grep.execute("grep-short", { pattern: "id", literal: true, path: "src", limit: 10 }, undefined, undefined, ctx);
    assert.match(short.content[0].text, /main\.ts:1:/);
    const quoted = await grep.execute("grep-quoted", { pattern: '\"OR\"', literal: true, limit: 10 }, undefined, undefined, ctx);
    assert.match(quoted.content[0].text, /src\/main\.ts:3:/);
    const unicode = await grep.execute("grep-unicode", { pattern: "café", literal: true, limit: 10 }, undefined, undefined, ctx);
    assert.match(unicode.content[0].text, /src\/naïve\[unit\]\.ts:1:/);
    const unicodeFold = await grep.execute("grep-unicode-fold", { pattern: "CAFÉ", literal: true, ignoreCase: true, limit: 10 }, undefined, undefined, ctx);
    assert.match(unicodeFold.content[0].text, /src\/naïve\[unit\]\.ts:1:/);
    const hashGlob = await grep.execute("grep-hash", { pattern: "HashNeedle", literal: true, glob: "#*.ts", limit: 10 }, undefined, undefined, ctx);
    assert.match(hashGlob.content[0].text, /#note\.ts:1:/);
    const bangGlob = await grep.execute("grep-bang", { pattern: "Needle", literal: true, glob: "!#note.ts", limit: 20 }, undefined, undefined, ctx);
    assert.doesNotMatch(bangGlob.content[0].text, /#note\.ts/);
    const globCase = await grep.execute("grep-glob-case", { pattern: "CaseNeedle", literal: true, glob: "*.ts", limit: 10 }, undefined, undefined, ctx);
    assert.match(globCase.content[0].text, /No matches found/);
    const whitespace = await grep.execute("grep-space", { pattern: "spaced", literal: true, limit: 10 }, undefined, undefined, ctx);
    assert.match(whitespace.content[0].text, /:4:   const spaced  =  1;  $/m);
    const exactLimit = await grep.execute("grep-limit", { pattern: "Needle", literal: true, limit: 1 }, undefined, undefined, ctx);
    assert.equal(exactLimit.details.matchLimitReached, 1);

    const regexFallback = await grep.execute("grep-regex", { pattern: "Need(le|ling)", limit: 10 }, undefined, undefined, ctx);
    assert.match(regexFallback.content[0].text, /src\/main\.ts:2:/);

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () => grep.execute("grep-aborted", { pattern: "Needle", literal: true }, aborted.signal, undefined, ctx),
      /Operation aborted/,
    );
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("watch invalidation refreshes create, change, rename, and delete operations", async () => {
  const root = await repository();
  const { pi, ctx } = await start(root);
  try {
    const grep = pi.tools.get("grep");
    const find = pi.tools.get("find");
    const created = join(root, "src", "created.ts");
    await writeFile(created, "export const fresh = 'Second';\n");
    await waitFor(async () => {
      const result = await grep.execute("created", { pattern: "Second", literal: true }, undefined, undefined, ctx);
      return /created\.ts:1:/.test(result.content[0].text);
    }, "created file was not searchable");

    const beforeChange = await stat(created);
    await writeFile(created, "export const fresh = 'Third!';\n");
    await utimes(created, beforeChange.atime, beforeChange.mtime);
    await rescanIndex(pi, ctx, "same-size change did not finish indexing");
    const changed = await grep.execute("changed", { pattern: "Third!", literal: true }, undefined, undefined, ctx);
    assert.match(changed.content[0].text, /created\.ts:1:/);

    const renamed = join(root, "src", "renamed.ts");
    await rename(created, renamed);
    await waitFor(async () => {
      const result = await find.execute("renamed", { pattern: "renamed.ts" }, undefined, undefined, ctx);
      return /src\/renamed\.ts/.test(result.content[0].text);
    }, "renamed file was not searchable");

    await rm(renamed);
    await waitFor(async () => {
      const result = await find.execute("deleted", { pattern: "renamed.ts" }, undefined, undefined, ctx);
      return /No files found/.test(result.content[0].text);
    }, "deleted file remained searchable");

    const large = join(root, "large.ts");
    await writeFile(large, `${"x".repeat(2 * 1024 * 1024)}LargeNeedle\n`);
    await rescanIndex(pi, ctx, "oversized file did not finish indexing");
    const largeResult = await grep.execute("large", { pattern: "LargeNeedle", literal: true }, undefined, undefined, ctx);
    assert.match(largeResult.content[0].text, /large\.ts:1:/);
    const invalid = join(root, "invalid.ts");
    await writeFile(invalid, Buffer.concat([Buffer.from([0xff]), Buffer.from("InvalidNeedle\n")]));
    await rescanIndex(pi, ctx, "invalid UTF-8 file did not finish indexing");
    const invalidResult = await grep.execute("invalid", { pattern: "InvalidNeedle", literal: true }, undefined, undefined, ctx);
    assert.match(invalidResult.content[0].text, /invalid\.ts:1:/);

    const metadataExcluded = join(root, "metadata-excluded.ts");
    const infoExclude = join(root, ".git", "info", "exclude");
    await writeFile(infoExclude, "metadata-excluded.ts\n");
    await writeFile(metadataExcluded, "export const metadata = 'MetadataNeedle';\n");
    await rescanIndex(pi, ctx, "Git exclude update did not finish indexing");
    const excluded = await find.execute("metadata-excluded", { pattern: "metadata-excluded.ts" }, undefined, undefined, ctx);
    assert.match(excluded.content[0].text, /No files found/);
    await writeFile(infoExclude, "");
    await waitFor(async () => {
      const result = await find.execute("metadata-included", { pattern: "metadata-excluded.ts" }, undefined, undefined, ctx);
      return /metadata-excluded\.ts/.test(result.content[0].text);
    }, "Git exclude removal was not detected");
    await waitForIndex(pi, ctx, "Git exclude removal did not finish indexing");

    await rm(join(root, "src", "main.ts"));
    await rescanIndex(pi, ctx, "tracked deletion did not finish indexing");
    const deletedTracked = await grep.execute("deleted-tracked", { pattern: "Needle", literal: true }, undefined, undefined, ctx);
    assert.doesNotMatch(deletedTracked.content[0].text, /src\/main\.ts/);
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("existing file changes avoid a full file enumeration", { skip: process.platform === "win32" }, async () => {
  const root = await repository();
  await createFindToolDefinition(root).execute("prepare-fd", { pattern: "__pi_prepare_fd__", limit: 1 });
  const realFd = join(getAgentDir(), "bin", "fd");
  await stat(realFd);
  const agentDir = await mkdtemp(join(tmpdir(), "pi-indexed-search-fast-path-"));
  const bin = join(agentDir, "bin");
  const calls = join(agentDir, "fd-calls");
  await mkdir(bin);
  await writeFile(join(bin, "fd"), `#!/bin/sh\nprintf x >> ${JSON.stringify(calls)}\nexec ${JSON.stringify(realFd)} "$@"\n`);
  await chmod(join(bin, "fd"), 0o755);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const pi = fakePi();
  const ctx = context(root);
  indexedSearchExtension(pi);
  try {
    await pi.handlers.get("session_start")({}, ctx);
    await waitFor(() => pi.tools.get("grep") && pi.tools.get("find"), "indexed tools did not become ready");
    const callsBefore = (await readFile(calls, "utf8")).length;
    await writeFile(join(root, "src", "main.ts"), "export const fastPath = 'FastPathNeedle';\n");
    await waitFor(async () => {
      const result = await pi.tools.get("grep").execute(
        "fast-path",
        { pattern: "FastPathNeedle", literal: true },
        undefined,
        undefined,
        ctx,
      );
      return /src\/main\.ts:1:/.test(result.content[0].text);
    }, "changed file was not refreshed through the index");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitForIndex(pi, ctx, "changed-file index did not settle");
    assert.equal((await readFile(calls, "utf8")).length, callsBefore);

    await rename(join(root, "src", "main.ts"), join(root, "src", "renamed-main.ts"));
    await waitFor(async () => {
      const result = await pi.tools.get("find").execute(
        "fast-path-rename",
        { pattern: "renamed-main.ts" },
        undefined,
        undefined,
        ctx,
      );
      return /src\/renamed-main\.ts/.test(result.content[0].text);
    }, "renamed file was not refreshed through a full scan");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitForIndex(pi, ctx, "renamed-file index did not settle");
    assert.ok((await readFile(calls, "utf8")).length > callsBefore);
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("parent Git ignore changes invalidate an index rooted in a repository subdirectory", async () => {
  const root = await repository();
  const nestedRoot = join(root, "src");
  await writeFile(join(root, ".gitignore"), "ignored.ts\nreal-secret.txt\nsrc/parent-rule.ts\n");
  await writeFile(join(nestedRoot, "parent-rule.ts"), "export const parentRule = true;\n");
  const { pi, ctx } = await start(nestedRoot);
  try {
    const find = pi.tools.get("find");
    const excluded = await find.execute("parent-excluded", { pattern: "parent-rule.ts" }, undefined, undefined, ctx);
    assert.match(excluded.content[0].text, /No files found/);
    await writeFile(join(root, ".gitignore"), "ignored.ts\nreal-secret.txt\n");
    await waitFor(async () => {
      const result = await find.execute("parent-included", { pattern: "parent-rule.ts" }, undefined, undefined, ctx);
      return /parent-rule\.ts/.test(result.content[0].text);
    }, "parent Git ignore change was not detected");
    await waitForIndex(pi, ctx, "nested index did not refresh after parent Git ignore change");
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("configured search overrides are never replaced", async () => {
  const root = await repository();
  const pi = fakePi("sdk");
  const ctx = context(root);
  indexedSearchExtension(pi);
  try {
    await pi.handlers.get("session_start")({}, ctx);
    assert.equal(pi.tools.size, 0);
    assert.equal(ctx.statuses.length, 0);
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("search tools replaced during indexing retain their later owner", async () => {
  const root = await repository();
  const pi = fakePi();
  const ctx = context(root);
  indexedSearchExtension(pi);
  try {
    await pi.handlers.get("session_start")({}, ctx);
    pi.setSearchSource("sdk");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(pi.tools.size, 0);
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("non-Git directories keep Pi native search instead of registering overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-indexed-search-no-git-"));
  const pi = fakePi();
  const ctx = context(root);
  indexedSearchExtension(pi);
  try {
    await pi.handlers.get("session_start")({}, ctx);
    await waitFor(() => ctx.notices.length > 0, "index failure was not reported");
    assert.equal(pi.tools.size, 0);
    assert.match(ctx.notices[0].message, /native search/);
  } finally {
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown terminates the index scanner process group", { skip: process.platform === "win32" }, async () => {
  const root = await repository();
  const agentDir = await mkdtemp(join(tmpdir(), "pi-indexed-search-agent-"));
  const bin = join(agentDir, "bin");
  const scannerPid = join(agentDir, "scanner.pid");
  const descendantPid = join(agentDir, "descendant.pid");
  await mkdir(bin);
  const fakeFd = join(bin, "fd");
  await writeFile(fakeFd, `#!/bin/sh\necho $$ > "${scannerPid}"\nsleep 30 &\necho $! > "${descendantPid}"\nwait\n`);
  await chmod(fakeFd, 0o755);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const pi = fakePi();
  const ctx = context(root);
  indexedSearchExtension(pi);
  try {
    await pi.handlers.get("session_start")({}, ctx);
    await waitFor(async () => {
      try {
        await readFile(scannerPid);
        await readFile(descendantPid);
        return true;
      } catch {
        return false;
      }
    }, "fake index scanner did not start");
    await pi.handlers.get("session_shutdown")({}, ctx);
    const pids = [Number(await readFile(scannerPid, "utf8")), Number(await readFile(descendantPid, "utf8"))];
    await waitFor(() => pids.every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }), "index scanner process group survived shutdown");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await pi.handlers.get("session_shutdown")({}, ctx);
    await rm(root, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("indexed output escapes unsafe paths and stays within Pi limits", () => {
  const found = formatIndexedFindResult({
    available: true,
    items: ["src/line\nbreak.ts", "src/ansi\u001b[31m.ts"],
    hasMore: false,
  }, 10);
  assert.match(found.content[0].text, /line\\nbreak/);
  assert.match(found.content[0].text, /ansi\\x1b\[31m/);
  assert.doesNotMatch(found.content[0].text, /\u001b/);

  const items = Array.from({ length: 100 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    lineNumber: index + 1,
    line: `${"x".repeat(2_000)}\u001b[31m\u202e`,
    before: Array.from({ length: 10 }, () => "b".repeat(2_000)),
    after: Array.from({ length: 10 }, () => "a".repeat(2_000)),
  }));
  const grepped = formatIndexedGrepResult({ available: true, items, hasMore: true }, 100);
  const text = grepped.content[0].text;
  assert.ok(Buffer.byteLength(text, "utf8") <= DEFAULT_MAX_BYTES);
  assert.ok(text.split("\n").length <= DEFAULT_MAX_LINES);
  assert.doesNotMatch(text, /\u001b|\u202e/);
  assert.match(text, /Output truncated/);
  assert.equal(grepped.details.matchLimitReached, 100);
  assert.equal(grepped.details.truncation.truncated, true);
  assert.equal(grepped.details.linesTruncated, true);
});
