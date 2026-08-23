import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createScoutGuardExtension,
  inspectScoutPath,
  protectScoutToolResult,
  redactScoutText,
  resolveRepositoryRoot,
  sanitizeScoutError,
  sanitizeScoutToolResult,
  scoutSelectorIsProtected,
} from "../extensions/subagents-guard.ts";
import { SCOUT_TOOLS, toolBudgetForKind } from "../extensions/subagents-core.ts";

async function withFixture(run, { git = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-guard-"));
  const cwd = join(root, "packages", "app");
  await mkdir(cwd, { recursive: true });
  if (git) await mkdir(join(root, ".git"));
  try {
    return await run({ root: await realpath(root), cwd: await realpath(cwd) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function loadGuard(cwd, kind, repositoryRoot) {
  const handlers = new Map();
  const extension = createScoutGuardExtension({ cwd, kind, repositoryRoot });
  assert.equal(typeof extension, "object");
  assert.equal(extension.hidden, true);
  assert.equal(typeof extension.factory, "function");
  await extension.factory({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  return handlers;
}

function toolCall(toolName, input = {}) {
  return { type: "tool_call", toolCallId: `${toolName}-call`, toolName, input };
}

function toolResult(overrides = {}) {
  return {
    type: "tool_result",
    toolCallId: "read-result",
    toolName: "read",
    input: { path: "src/auth.ts" },
    content: [{ type: "text", text: "ordinary output" }],
    details: { truncation: { truncated: false } },
    usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0.1 } },
    isError: false,
    ...overrides,
  };
}

test("repository roots use the nearest Git marker and otherwise fall back to cwd", async () => {
  await withFixture(async ({ root, cwd }) => {
    assert.equal(await resolveRepositoryRoot(cwd), root);
  });
  await withFixture(async ({ cwd }) => {
    assert.equal(await resolveRepositoryRoot(cwd), cwd);
  }, { git: false });
});

test("path inspection rejects traversal, outside paths, and symlink escapes", async () => {
  await withFixture(async ({ root, cwd }) => {
    const outside = await mkdtemp(join(tmpdir(), "pi-subagents-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "not for the scout");
      await symlink(outside, join(root, "escape"), "junction");
      await mkdir(join(root, "inside"));
      await symlink(join(root, "inside"), join(root, "internal-link"), "junction");

      assert.equal((await inspectScoutPath(root, cwd, "../sibling.ts")).reason, "traversal");
      assert.equal((await inspectScoutPath(root, cwd, join(outside, "secret.txt"))).reason, "outside_repository");
      assert.equal((await inspectScoutPath(root, cwd, join(root, "escape", "secret.txt"))).reason, "symlink_escape");
      assert.equal((await inspectScoutPath(root, cwd, join(root, "escape", "not-created-yet.txt"))).reason, "symlink_escape");
      assert.equal((await inspectScoutPath(root, cwd, join(root, "internal-link", "future.ts"))).allowed, true);
      assert.equal((await inspectScoutPath(root, cwd, "bad\0path")).reason, "invalid_path");
      assert.equal((await inspectScoutPath(root, cwd, 42)).reason, "invalid_path");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("protected private paths and images are blocked while source names remain allowed", async () => {
  await withFixture(async ({ root, cwd }) => {
    const protectedPaths = [
      ".git/config",
      ".ssh/config",
      ".pi/settings.json",
      ".codex/session.json",
      ".env",
      ".env.local",
      "keys/deploy.pem",
      "keys/deploy.key",
      "credentials",
      "credentials.json",
      "auth.json",
      "auth.jsonl",
      "settings.json",
      "settings.jsonl",
      "models.json",
      "models.jsonl",
      "trust.json",
      "trust.jsonl",
      "session.json",
      "session.jsonl",
      "sessions.json",
      "sessions.jsonl",
      "transcript.json",
      "transcript.jsonl",
      "transcripts.json",
      "transcripts.jsonl",
      "sessions/private-state.txt",
      "transcripts/private-state.txt",
      "id_rsa",
      "id_ed25519",
    ];
    for (const path of protectedPaths) {
      const result = await inspectScoutPath(root, cwd, join(root, path));
      assert.equal(result.reason, "protected_path", path);
    }
    for (const path of ["diagram.PNG", "assets/photo.jpeg", "vector.svg"]) {
      const result = await inspectScoutPath(root, cwd, join(root, path));
      assert.equal(result.reason, "image", path);
    }
    for (const path of ["src/auth.ts", "src/settings.ts", "src/session.ts", "src/credentials.ts"]) {
      assert.equal((await inspectScoutPath(root, cwd, join(root, path))).allowed, true, path);
    }
  });
});

test("protected grep globs and find selectors cannot bypass path checks", () => {
  for (const selector of [".env*", "**/.ssh/**", "sessions/**", "transcripts/**", "**/*.pem", "**/{credentials.json,*.ts}", "auth.json"]) {
    assert.equal(scoutSelectorIsProtected(selector), true, selector);
  }
  for (const selector of ["**/*.ts", "src/**/auth.ts", "settings.ts", undefined]) {
    assert.equal(scoutSelectorIsProtected(selector), false, String(selector));
  }
});

test("redaction removes private keys, provider tokens, and literal secret assignments", () => {
  const input = [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "private-key-material",
    "-----END OPENSSH PRIVATE KEY-----",
    "openai=sk-abcdefghijklmnopqrstuvwxyz",
    "github=ghp_abcdefghijklmnopqrstuvwxyz",
    "fine=github_pat_abcdefghijklmnopqrstuvwxyz_123456",
    "API_KEY=super-secret-value",
    "const accessToken = 'access-token-value';",
    "\"password\": \"correct horse battery staple\"",
    "clientSecret: hunter2",
    "NPM_TOKEN=npm-secret-value",
    "GITHUB_TOKEN=abcdefghijklmnopqrstuvwxyz",
    "token: 'plain-secret-token-value'",
    "token = nextToken",
    "nextToken = previousToken",
    "const secretary = 'ordinary-source';",
    "const secret = process.env.SECRET;",
    "password = change-me",
  ].join("\n");
  const redacted = redactScoutText(input);

  for (const secret of [
    "private-key-material",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz",
    "github_pat_abcdefghijklmnopqrstuvwxyz_123456",
    "super-secret-value",
    "access-token-value",
    "correct horse battery staple",
    "hunter2",
    "npm-secret-value",
    "abcdefghijklmnopqrstuvwxyz",
    "plain-secret-token-value",
  ]) {
    assert.equal(redacted.includes(secret), false, secret);
  }
  assert.match(redacted, /\[REDACTED PRIVATE KEY\]/);
  assert.match(redacted, /\[REDACTED PROVIDER TOKEN\]/);
  assert.match(redacted, /API_KEY=\[REDACTED SECRET\]/);
  assert.match(redacted, /const secretary = 'ordinary-source'/);
  assert.match(redacted, /const secret = process\.env\.SECRET/);
  assert.match(redacted, /password = change-me/);
  assert.match(redacted, /token = nextToken/);
  assert.match(redacted, /nextToken = previousToken/);
});

test("errors are terminal-safe, secret-safe, single-line, and bounded", () => {
  const sanitized = sanitizeScoutError(new Error(`provider failed\n  at call (file.ts:1)\u001b[31m sk-abcdefghijklmnopqrstuvwxyz`));
  assert.equal(sanitized, "provider failed");
  assert.doesNotMatch(sanitizeScoutError(`bad sk-abcdefghijklmnopqrstuvwxyz\u001b[31m`), /sk-|\u001b/);
  assert.ok(Array.from(sanitizeScoutError("x".repeat(800))).length <= 500);
});

test("tool-result patches preserve text blocks and metadata middleware while blocking images", () => {
  const usage = { input: 1, output: 2, totalTokens: 3, cost: { total: 0.1 } };
  const event = toolResult({
    content: [
      { type: "text", text: "before sk-abcdefghijklmnopqrstuvwxyz" },
      { type: "image", data: "base64-secret", mimeType: "image/png" },
      { type: "text", text: "after" },
    ],
    usage,
  });
  const patch = sanitizeScoutToolResult(event);
  assert.equal(patch.isError, true);
  assert.equal(patch.content.some((block) => block.type === "image"), false);
  assert.equal(patch.content.some((block) => block.type === "text" && block.text === "after"), true);
  assert.doesNotMatch(patch.content.map((block) => block.text ?? "").join("\n"), /sk-|base64-secret/);
  assert.equal("details" in patch, false);
  assert.equal("usage" in patch, false);
  assert.deepEqual(event.usage, usage);

  const unchanged = toolResult();
  assert.equal(sanitizeScoutToolResult(unchanged), undefined);
  const errorPatch = sanitizeScoutToolResult(toolResult({
    isError: true,
    content: [{ type: "text", text: "failure sk-abcdefghijklmnopqrstuvwxyz\n  at unsafe (x:1)" }],
  }));
  assert.equal(errorPatch.content[0].text, "failure [REDACTED PROVIDER TOKEN]");
  assert.equal("isError" in errorPatch, false);
});

test("broad grep, find, and ls results hide protected descendants and symlink escapes", async () => {
  await withFixture(async ({ root }) => {
    const outside = await mkdtemp(join(tmpdir(), "pi-subagents-result-outside-"));
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, ".codex"));
      await writeFile(join(root, "src", "auth.ts"), "export const visible = true;\n");
      await writeFile(join(root, ".env"), "API_KEY=super-secret-value\n");
      await writeFile(join(root, ".codex", "session.json"), "private state\n");
      await writeFile(join(outside, "escaped.txt"), "outside\n");
      await symlink(outside, join(root, "escape"), "junction");

      const cases = [
        toolResult({
          toolName: "grep",
          input: { path: root, pattern: "visible|secret" },
          content: [{ type: "text", text: [
            ".env:1: API_KEY=super-secret-value",
            ".codex/session.json:1: private state",
            "src/auth.ts:1: export const visible = true;",
          ].join("\n") }],
        }),
        toolResult({
          toolName: "find",
          input: { path: root, pattern: "**" },
          content: [{ type: "text", text: ".env\n.codex/session.json\nescape/escaped.txt\nsrc/auth.ts" }],
        }),
        toolResult({
          toolName: "ls",
          input: { path: root },
          content: [{ type: "text", text: ".codex/\n.env\n.git/\nescape/\nsrc/" }],
        }),
      ];

      for (const event of cases) {
        const patch = await protectScoutToolResult(root, root, event);
        const text = patch.content.map((block) => block.text ?? "").join("\n");
        assert.match(text, /Protected paths removed/);
        assert.doesNotMatch(text, /\.env|\.codex|\.git|super-secret|escaped/);
        if (event.toolName !== "ls") assert.match(text, /src\/auth\.ts/);
        else assert.match(text, /src\//);
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("broad-result path checks overlap within the bound, deduplicate, and preserve output order", async () => {
  await withFixture(async ({ root }) => {
    const paths = Array.from({ length: 20 }, (_, index) => `src/file-${String(index).padStart(2, "0")}.ts`);
    const firstWaveStarted = Promise.withResolvers();
    const releaseFirstWave = Promise.withResolvers();
    const inspected = [];
    let active = 0;
    let maximumActive = 0;

    const inspectResultPath = async (_repositoryRoot, resultBase, candidate) => {
      inspected.push(candidate);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (inspected.length === 16) firstWaveStarted.resolve();
      try {
        await releaseFirstWave.promise;
        if (candidate === paths[5]) throw new Error("inspection failed");
        if (candidate === paths[17]) {
          return { allowed: false, reason: "protected_path", message: "blocked" };
        }
        return {
          allowed: true,
          absolutePath: join(resultBase, candidate),
          canonicalPath: join(resultBase, candidate),
        };
      } finally {
        active -= 1;
      }
    };

    const pending = protectScoutToolResult(
      root,
      root,
      toolResult({
        toolName: "find",
        input: { path: root, pattern: "**/*.ts" },
        content: [
          { type: "text", text: paths.join("\n") },
          { type: "text", text: [paths[1], paths[5], paths[19]].join("\n") },
        ],
      }),
      inspectResultPath,
    );

    await firstWaveStarted.promise;
    assert.equal(active, 16);
    assert.equal(maximumActive, 16);
    releaseFirstWave.resolve();

    const patch = await pending;
    assert.equal(maximumActive, 16);
    assert.deepEqual(inspected.slice(0, 16), paths.slice(0, 16));
    assert.equal(inspected.length, paths.length);
    assert.equal(new Set(inspected).size, paths.length);
    assert.equal(
      patch.content[0].text,
      paths.filter((path) => path !== paths[5] && path !== paths[17]).join("\n"),
    );
    assert.equal(
      patch.content[1].text,
      `${paths[1]}\n${paths[19]}\n[Protected paths removed from scout tool output.]`,
    );
  });
});

test("a pre-resolved repository root is reused by the inline guard", async () => {
  await withFixture(async ({ root, cwd }) => {
    const sharedSource = join(root, "shared.ts");
    await writeFile(sharedSource, "export const shared = true;\n");

    const localRootCall = (await loadGuard(cwd, "survey")).get("tool_call");
    const sharedRootCall = (await loadGuard(cwd, "survey", root)).get("tool_call");
    const withoutSharedRoot = await localRootCall(toolCall("read", { path: sharedSource }));
    assert.equal(withoutSharedRoot.block, true);
    assert.equal(await sharedRootCall(toolCall("read", { path: sharedSource })), undefined);
  }, { git: false });
});

test("the inline guard enforces path policy and each per-kind tool budget", async () => {
  await withFixture(async ({ root, cwd }) => {
    assert.deepEqual(SCOUT_TOOLS, ["read", "grep", "find", "ls"]);
    for (const kind of ["survey", "trace", "audit"]) {
      const toolBudget = toolBudgetForKind(kind);
      const handlers = await loadGuard(cwd, kind);
      const call = handlers.get("tool_call");
      const result = handlers.get("tool_result");
      assert.equal(typeof call, "function");
      assert.equal(typeof result, "function");
      assert.equal(await call(toolCall("bash", { command: "pwd" })), undefined);

      const protectedCall = await call(toolCall("grep", { path: ".", pattern: ".", glob: ".env*" }));
      assert.equal(protectedCall.block, true);
      assert.match(protectedCall.reason, /protected paths/);
      for (let index = 1; index < toolBudget; index += 1) {
        assert.equal(await call(toolCall("ls", { path: root })), undefined);
      }
      const exhausted = await call(toolCall("read", { path: join(root, "src", "auth.ts") }));
      assert.deepEqual(exhausted, {
        block: true,
        reason: `Scout tool budget exhausted after ${toolBudget} calls. Synthesize the evidence already collected.`,
      });
      assert.deepEqual(await call(toolCall("find", { path: ".", pattern: "**/*.ts" })), exhausted);

      assert.equal(await result(toolResult()), undefined);
      const blockedPath = await (await loadGuard(cwd, kind)).get("tool_call")(
        toolCall("read", { path: join(root, ".git", "config") }),
      );
      assert.equal(blockedPath.block, true);
      assert.equal(blockedPath.terminate, undefined);
    }
  });
});
