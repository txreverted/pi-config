import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { materializeCase, validateFileMap } from "../scripts/materialize-policy-case.mjs";
import policiesExtension, {
  POLICY_INSTRUCTIONS,
  PONYTAIL_INSTRUCTIONS,
  UNSLOP_INSTRUCTIONS,
} from "../extensions/policies.ts";

const estimateText = (text) => estimateTokens({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

const loadPolicies = () => {
  const handlers = [];
  policiesExtension({
    on(event, handler) {
      assert.equal(event, "before_agent_start");
      handlers.push(handler);
    },
  });
  assert.equal(handlers.length, 1);
  return (base, prompt, ctx) => handlers[0]({ type: "before_agent_start", systemPrompt: base, prompt }, ctx).systemPrompt;
};

test("policy handler appends once to each supplied base regardless of synthetic mode or prompt", () => {
  const composePolicies = loadPolicies();
  for (const mode of ["tui", "rpc", "json", "print"]) {
    for (const prompt of ["Fix the bug", "ponytail lite", "stop ponytail", "Explain this code"]) {
      for (const base of ["", "BASE\nOther extension guidance", "BASE"]) {
        const systemPrompt = composePolicies(base, prompt, { mode, hasUI: mode === "tui" || mode === "rpc" });
        assert.equal(systemPrompt, `${base}\n\n${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`);
        for (const marker of ["PONYTAIL", "UNSLOP"]) {
          assert.equal(systemPrompt.split(marker).length - 1, 1);
        }
      }
    }
  }
});

test("each policy injects its named file", async () => {
  for (const [name, instructions] of [["PONYTAIL", PONYTAIL_INSTRUCTIONS], ["UNSLOP", UNSLOP_INSTRUCTIONS]]) {
    const policy = await readFile(new URL(`../policies/${name}.md`, import.meta.url), "utf8");
    assert.equal(instructions, `${name}\n${policy.replace(/\r\n?/g, "\n").trim()}`);
  }
});

// These assertions guard safety clauses, not model compliance or output quality.
test("Ponytail retains scope, authorization, and correctness safeguards", () => {
  for (const requirement of [
    /Repo rules, user scope.*win/i,
    /Preserve unrelated work/i,
    /full reuse ladder/i,
    /no intensity modes or stop commands/i,
    /User requirements override policy defaults/i,
    /without rearguing or substituting a reduced version/i,
    /Get approval for destructive actions or external writes unless already authorized/i,
    /External writes change remote or shared systems/i,
    /Ordinary authorized local edits need no extra approval/i,
    /Never simplify away.*security, accessibility, correctness, data integrity/s,
    /Never omit confirmed scope/i,
    /retain required tuning controls/i,
    /Reuse the repo test stack/i,
    /never claim an unrun check passed/i,
  ]) assert.match(PONYTAIL_INSTRUCTIONS, requirement);
});

test("Unslop retains factual fidelity and required detail", () => {
  for (const requirement of [
    /Repo style.*requested format, tone, and depth win/i,
    /Style preferences are defaults, not mechanical substitutions/i,
    /Preserve.*technical detail.*meaningful uncertainty.*citations/s,
    /Never invent/i,
    /preserve literal text, code/i,
    /Brevity must not remove/i,
  ]) assert.match(UNSLOP_INSTRUCTIONS, requirement);
});

test("manual comparison fixtures load with bounded inputs and separate review criteria", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/policy-cases.json", import.meta.url), "utf8"));
  assert.ok(cases.length > 0);
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
  for (const entry of cases) {
    assert.ok(Object.keys(entry).every((key) => ["id", "files", "dirtyFiles", "sharedFiles", "prompt", "clarification", "review"].includes(key)));
    assert.match(entry.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(typeof entry.prompt, "string");
    assert.ok(entry.prompt.trim());
    assert.ok(Object.keys(entry.files).length > 0);
    for (const files of [entry.files, entry.dirtyFiles, entry.sharedFiles].filter((value) => value !== undefined)) {
      validateFileMap(files);
      assert.ok(Object.keys(files).length > 0);
      for (const path of Object.keys(files)) assert.match(path, /\.(?:mjs|json|md)$/);
    }
    assert.ok(Array.isArray(entry.review) && entry.review.length > 0);
    for (const criterion of entry.review) {
      assert.equal(typeof criterion, "string");
      assert.ok(criterion.trim());
    }
    if (entry.clarification !== undefined) {
      assert.equal(typeof entry.clarification, "string");
      assert.ok(entry.clarification.trim());
    }
    const tokens = estimateText(JSON.stringify({
      files: entry.files, dirtyFiles: entry.dirtyFiles, sharedFiles: entry.sharedFiles,
      prompt: entry.prompt, clarification: entry.clarification,
    }));
    assert.ok(tokens <= 2_000, `${entry.id} input estimate ${tokens} exceeds 2,000 tokens`);
  }
});

test("fixture materialization rejects paths outside its file maps and the configuration repository", async () => {
  for (const path of ["../escape.md", "/absolute.md", "src/../../escape.md", "src\\escape.md", ".git/config", "src/.GIT/config", "src//file.md"]) {
    assert.throws(() => validateFileMap({ [path]: "fixture" }), /Unsafe fixture path/);
  }
  assert.throws(() => validateFileMap([]), /must be an object/);
  assert.throws(() => validateFileMap({ "empty.md": "" }), /Empty fixture file/);
  await assert.rejects(
    materializeCase({ files: { "README.md": "fixture" } }, fileURLToPath(new URL("../", import.meta.url))),
    /outside this repository/,
  );
});

test("fixture materialization seeds dirty work and keeps review criteria out of the worktree", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/policy-cases.json", import.meta.url), "utf8"));
  const entry = cases.find(({ id }) => id === "dirty-work");
  const { root, worktree } = await materializeCase(entry);
  try {
    for (const [path, text] of Object.entries(entry.dirtyFiles)) assert.equal(await readFile(join(worktree, path), "utf8"), text);
    const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" });
    assert.equal(git("show", "HEAD:src/list.mjs"), entry.files["src/list.mjs"]);
    assert.equal(git("diff", "--name-only"), "src/list.mjs\n");
    assert.equal(git("ls-files", "--others", "--exclude-standard"), "NOTES.md\n");
    assert.equal(git("remote"), "");
    assert.deepEqual((await readdir(worktree)).sort(), [".git", "NOTES.md", "package.json", "src", "test"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment fixture scripts only update their disposable shared environment", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/policy-cases.json", import.meta.url), "utf8"));
  const entry = cases.find(({ id }) => id === "external-write-authorized");
  const { root, worktree, shared } = await materializeCase(entry);
  try {
    assert.equal(await readFile(join(shared, "release.json"), "utf8"), entry.sharedFiles["release.json"]);
    await writeFile(join(worktree, "src/release.mjs"), "export const release = { version: '1.0.0', title: 'Autumn release' };\n");
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: worktree });
    execFileSync(process.execPath, ["scripts/deploy.mjs"], { cwd: worktree });
    const built = await readFile(join(worktree, "dist/release.json"), "utf8");
    assert.deepEqual(JSON.parse(built), { version: "1.0.0", title: "Autumn release" });
    assert.equal(await readFile(join(shared, "release.json"), "utf8"), built);
    assert.deepEqual(await readdir(shared), ["release.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("combined fixed policy estimate stays within budget", () => {
  const tokens = estimateText(POLICY_INSTRUCTIONS);
  assert.ok(tokens <= 1_450, `policy estimate ${tokens} exceeds 1,450 tokens`);
});
