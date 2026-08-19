import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from "node:fs/promises";
import { getAgentDir, CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { basename, dirname, join, matchesGlob, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_PATCH_BYTES = 2_000_000;
export const MAX_CHANGED_FILES = 1_000;
const MAX_METADATA_BYTES = 16_384;

export interface WorkerWorkspace {
  runId: string;
  taskId: string;
  repoRoot: string;
  worktree: string;
  baseCommit: string;
  writeScope: string[];
  metadata: string;
}

export interface WorkerPatch {
  patch: string;
  hash: string;
  bytes: number;
  changedFiles: string[];
  scopeValid: boolean;
  outsideScope: string[];
}

function validId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) throw new Error("Invalid agent workspace id");
  return value;
}

async function git(cwd: string, args: readonly string[], maxBuffer = MAX_PATCH_BYTES): Promise<string> {
  const result = await exec("git", [
    "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args,
  ], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_EXTERNAL_DIFF: "" },
  });
  return result.stdout;
}

async function repositoryRoot(cwd: string): Promise<string> {
  const root = await realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  if (!(await stat(root)).isDirectory()) throw new Error("Workers require a Git repository");
  return root;
}

async function storageRoots(repoRoot: string): Promise<{ create: string; candidates: string[] }> {
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 24);
  const local = join(repoRoot, CONFIG_DIR_NAME, "agent-worktrees");
  const global = join(getAgentDir(), "pi-config", "agent-worktrees", hash);
  const ignored = await exec("git", ["check-ignore", "-q", "--", local], { cwd: repoRoot, timeout: 5_000 }).then(() => true, () => false);
  return { create: ignored ? local : global, candidates: [local, global] };
}

function workspacePaths(root: string, runId: string, taskId: string) {
  const name = `${validId(runId)}--${validId(taskId)}`;
  return {
    root,
    worktree: join(root, name),
    metadataRoot: join(root, ".metadata"),
    metadata: join(root, ".metadata", `${name}.json`),
  };
}

export async function createWorkerWorkspace(cwd: string, runId: string, taskId: string, writeScope: readonly string[]): Promise<WorkerWorkspace> {
  const repoRoot = await repositoryRoot(cwd);
  if ((await git(repoRoot, ["status", "--porcelain=v1", "-z"])).length > 0) throw new Error("Workers require a clean parent checkout");
  const baseCommit = (await git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new Error("Git HEAD is not a commit");
  const root = (await storageRoots(repoRoot)).create;
  const paths = workspacePaths(root, runId, taskId);
  await mkdir(paths.metadataRoot, { recursive: true, mode: 0o700 });
  for (const path of [paths.worktree, paths.metadata]) {
    try {
      await lstat(path);
      throw new Error(`Agent workspace already exists: ${runId}/${taskId}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await git(repoRoot, ["worktree", "add", "--detach", paths.worktree, baseCommit]);
  try {
    const worktree = await realpath(paths.worktree);
    const workspace: WorkerWorkspace = {
      runId,
      taskId,
      repoRoot,
      worktree,
      baseCommit,
      writeScope: [...writeScope],
      metadata: paths.metadata,
    };
    await writeFile(paths.metadata, `${JSON.stringify(workspace)}\n`, { mode: 0o600, flag: "wx" });
    return workspace;
  } catch (error) {
    await git(repoRoot, ["worktree", "remove", "--force", paths.worktree]).catch(() => undefined);
    await Promise.all([rm(paths.worktree, { recursive: true, force: true }), rm(paths.metadata, { force: true })]);
    throw error;
  }
}

function validWorkspaceMetadata(value: unknown, metadata: string): WorkerWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid agent workspace metadata");
  const input = value as Record<string, unknown>;
  if ([input.runId, input.taskId, input.repoRoot, input.worktree, input.baseCommit].some((item) => typeof item !== "string")) {
    throw new Error("Invalid agent workspace metadata");
  }
  if (!Array.isArray(input.writeScope) || input.writeScope.some((item) => typeof item !== "string")) throw new Error("Invalid agent workspace scope");
  return {
    runId: validId(input.runId as string),
    taskId: validId(input.taskId as string),
    repoRoot: input.repoRoot as string,
    worktree: input.worktree as string,
    baseCommit: input.baseCommit as string,
    writeScope: input.writeScope as string[],
    metadata,
  };
}

async function readWorkspaceMetadata(metadata: string): Promise<WorkerWorkspace> {
  const info = await lstat(metadata);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_METADATA_BYTES) throw new Error("Invalid agent workspace metadata");
  return validWorkspaceMetadata(JSON.parse(await readFile(metadata, "utf8")), metadata);
}

export async function recoverWorkerWorkspace(cwd: string, runId: string, taskId: string): Promise<WorkerWorkspace> {
  const repoRoot = await repositoryRoot(cwd);
  for (const root of (await storageRoots(repoRoot)).candidates) {
    const paths = workspacePaths(root, runId, taskId);
    try {
      const saved = await readWorkspaceMetadata(paths.metadata);
      const actualRoot = await realpath(repoRoot);
      const actualWorktree = await realpath(saved.worktree);
      if (saved.repoRoot !== actualRoot || saved.worktree !== actualWorktree || saved.runId !== runId || saved.taskId !== taskId) continue;
      const parentCommon = await realpath(resolve(repoRoot, (await git(repoRoot, ["rev-parse", "--git-common-dir"])).trim()));
      const childCommon = await realpath(resolve(actualWorktree, (await git(actualWorktree, ["rev-parse", "--git-common-dir"])).trim()));
      if (parentCommon !== childCommon) continue;
      const commit = (await git(repoRoot, ["rev-parse", "--verify", `${saved.baseCommit}^{commit}`])).trim();
      if (commit !== saved.baseCommit) continue;
      return { ...saved, repoRoot: actualRoot, worktree: actualWorktree };
    } catch {
      // Try the other storage root.
    }
  }
  throw new Error(`Unknown worker patch '${runId}/${taskId}'`);
}

export function validateWorkerChangedFiles(tracked: readonly string[], untracked: readonly string[]): string[] {
  if (untracked.length > MAX_CHANGED_FILES) throw new Error(`Worker created more than ${MAX_CHANGED_FILES} untracked files`);
  const files = [...new Set([...tracked, ...untracked])];
  if (files.length > MAX_CHANGED_FILES) {
    throw new Error(`Worker changed more than ${MAX_CHANGED_FILES} total files; reduce the worker's changes before inspection`);
  }
  return files;
}

async function changedFiles(workspace: WorkerWorkspace): Promise<string[]> {
  const tracked = (await git(workspace.worktree, ["diff", "--name-only", "-z", workspace.baseCommit, "--"])).split("\0").filter(Boolean);
  const untracked = (await git(workspace.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  return validateWorkerChangedFiles(tracked, untracked);
}

function matchesScope(path: string, scope: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const pattern = scope.replaceAll("\\", "/");
  return normalized === pattern || normalized.startsWith(`${pattern.replace(/\/+$/, "")}/`) || matchesGlob(normalized, pattern);
}

export async function inspectWorkerPatch(workspace: WorkerWorkspace): Promise<WorkerPatch> {
  const files = await changedFiles(workspace);
  const untracked = (await git(workspace.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const path of untracked) await git(workspace.worktree, ["add", "--intent-to-add", "--", path]);
  const patch = await git(workspace.worktree, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", workspace.baseCommit, "--"]);
  const bytes = Buffer.byteLength(patch);
  if (bytes > MAX_PATCH_BYTES) throw new Error(`Worker patch exceeds ${MAX_PATCH_BYTES} bytes`);
  const outsideScope = files.filter((path) => !workspace.writeScope.some((scope) => matchesScope(path, scope)));
  return {
    patch,
    hash: createHash("sha256").update(patch).digest("hex"),
    bytes,
    changedFiles: files,
    scopeValid: outsideScope.length === 0,
    outsideScope,
  };
}

async function applyPatch(cwd: string, patch: string, check: boolean): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile("git", ["apply", "--binary", ...(check ? ["--check"] : []), "-"], {
      cwd,
      timeout: 30_000,
      maxBuffer: MAX_PATCH_BYTES,
    }, (error) => error ? reject(error) : resolvePromise());
    child.stdin!.end(patch);
  });
}

export async function applyWorkerPatch(workspace: WorkerWorkspace, expectedHash: string): Promise<WorkerPatch> {
  const inspected = await inspectWorkerPatch(workspace);
  if (!inspected.scopeValid) throw new Error(`Worker changed files outside its scope: ${inspected.outsideScope.join(", ")}`);
  if (inspected.hash !== expectedHash) throw new Error("Worker patch changed after inspection");
  if (!inspected.patch) return inspected;
  if (inspected.changedFiles.length > 0) {
    const dirty = await git(workspace.repoRoot, ["status", "--porcelain=v1", "--", ...inspected.changedFiles]);
    if (dirty.trim()) throw new Error("Parent checkout has dirty paths touched by this worker");
  }
  await applyPatch(workspace.repoRoot, inspected.patch, true);
  await applyPatch(workspace.repoRoot, inspected.patch, false);
  return inspected;
}

export async function discardWorkerWorkspace(workspace: WorkerWorkspace): Promise<void> {
  await git(workspace.repoRoot, ["worktree", "remove", "--force", workspace.worktree]).catch(() => undefined);
  await Promise.all([
    rm(workspace.worktree, { recursive: true, force: true }),
    rm(workspace.metadata, { force: true }),
  ]);
  await rm(dirname(workspace.metadata), { recursive: false }).catch(() => undefined);
  await rm(dirname(workspace.worktree), { recursive: false }).catch(() => undefined);
}

export async function listWorkerWorkspaces(cwd: string): Promise<WorkerWorkspace[]> {
  const repoRoot = await repositoryRoot(cwd);
  const workspaces: WorkerWorkspace[] = [];
  for (const root of (await storageRoots(repoRoot)).candidates) {
    const metadataRoot = join(root, ".metadata");
    let names: string[];
    try { names = await readdir(metadataRoot); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".json") || basename(name) !== name) continue;
      try {
        const workspace = await readWorkspaceMetadata(join(metadataRoot, name));
        if (workspace.repoRoot === repoRoot) workspaces.push(workspace);
      } catch {
        // Ignore malformed orphan metadata.
      }
    }
  }
  return workspaces;
}
