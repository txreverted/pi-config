import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const casesUrl = new URL("../test/fixtures/policy-cases.json", import.meta.url);

export function validateFileMap(files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Fixture files must be an object");
  }
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split("/");
    if (parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === ".." || part.toLowerCase() === ".git")) {
      throw new Error(`Unsafe fixture path: ${path}`);
    }
    if (typeof text !== "string" || !text.trim()) throw new Error(`Empty fixture file: ${path}`);
  }
}

async function writeFiles(directory, files) {
  for (const [path, text] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, text);
  }
}

export async function materializeCase(entry, temporaryDirectory = tmpdir()) {
  for (const files of [entry.files, entry.dirtyFiles ?? {}, entry.sharedFiles ?? {}]) validateFileMap(files);
  const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const temporary = await realpath(temporaryDirectory);
  const relation = relative(repository, temporary);
  if (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`)) {
    throw new Error("Fixture workspaces must be outside this repository");
  }
  const root = await mkdtemp(join(temporary, "pi-policy-eval-"));
  const worktree = join(root, "worktree");
  const shared = join(root, "shared");
  try {
    await mkdir(worktree);
    await mkdir(shared);
    await writeFiles(worktree, entry.files);
    await writeFiles(shared, entry.sharedFiles ?? {});
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
    for (const name of Object.keys(env)) {
      if (name.startsWith("GIT_") && name !== "GIT_CONFIG_NOSYSTEM" && name !== "GIT_CONFIG_GLOBAL") delete env[name];
    }
    const git = (...args) => execFileSync("git", [
      "-c", "user.name=Policy fixture", "-c", "user.email=policy-fixture@example.invalid",
      "-c", "commit.gpgSign=false", "-c", `core.hooksPath=${join(root, "no-hooks")}`, ...args,
    ], { cwd: worktree, env, stdio: "pipe" });
    git("init", "--quiet", "--initial-branch=main", "--template=");
    git("add", "--all");
    git("commit", "--quiet", "-m", "Fixture baseline");
    await writeFiles(worktree, entry.dirtyFiles ?? {});
    return { root, worktree, shared };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cases = JSON.parse(await readFile(casesUrl, "utf8"));
  const [id, ...extra] = process.argv.slice(2);
  const entry = cases.find((candidate) => candidate.id === id);
  if (!entry || extra.length) {
    console.error(`Usage: node scripts/materialize-policy-case.mjs <case-id>\nCases: ${cases.map((candidate) => candidate.id).join(", ")}`);
    process.exitCode = 1;
  } else {
    const { worktree } = await materializeCase(entry);
    console.log(`Workspace: ${worktree}\nPrompt: ${entry.prompt}`);
  }
}
