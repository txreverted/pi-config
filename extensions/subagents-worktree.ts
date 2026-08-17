import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isPathInside } from "./path-safety.ts";

const exec = promisify(execFile);
export const MAX_AGENT_DIFF_BYTES = 2_000_000;
const MAX_UNTRACKED_FILES = 1_000;
const MAX_METADATA_BYTES = 1_024;

export interface AgentWorkspace {
  repoRoot: string;
  worktree: string;
  baseCommit: string;
}

async function git(cwd: string, args: string[], maxBuffer = MAX_AGENT_DIFF_BYTES): Promise<string> {
  const { stdout } = await exec("git", [
    "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args,
  ], {
    cwd, encoding: "utf8", maxBuffer, timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_EXTERNAL_DIFF: "" },
  });
  return stdout;
}

async function repositoryRoot(cwd: string): Promise<string> {
  const root = await realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  if (!(await stat(root)).isDirectory()) throw new Error("Writable agents require a Git repository");
  return root;
}

function worktreeLocation(repoRoot: string, agentId: string): { root: string; worktree: string; metadataRoot: string; metadata: string } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(agentId)) throw new Error("Invalid agent id");
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 24);
  const root = join(getAgentDir(), "pi-config", "worktrees", hash);
  const worktree = join(root, agentId);
  const metadataRoot = join(root, ".metadata");
  return { root, worktree, metadataRoot, metadata: join(metadataRoot, `${agentId}.json`) };
}

export async function repositoryIdentity(cwd: string): Promise<{ repoRoot: string; baseCommit: string }> {
  const repoRoot = await repositoryRoot(cwd);
  if (await git(repoRoot, ["status", "--porcelain=v1", "-z"])) {
    throw new Error("Worker isolation requires a clean parent checkout");
  }
  const baseCommit = (await git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new Error("Git HEAD is not a commit");
  return { repoRoot, baseCommit };
}

export async function createAgentWorktree(cwd: string, agentId: string): Promise<AgentWorkspace & { cwd: string }> {
  const { repoRoot, baseCommit } = await repositoryIdentity(cwd);
  const requested = await realpath(resolve(cwd));
  if (!isPathInside(repoRoot, requested)) throw new Error("Agent cwd must be inside its repository");
  const { worktree, metadataRoot, metadata } = worktreeLocation(repoRoot, agentId);
  await mkdir(metadataRoot, { recursive: true, mode: 0o700 });
  for (const path of [worktree, metadata]) {
    try {
      await lstat(path);
      throw new Error(`Agent worktree already exists: ${worktree}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await git(repoRoot, ["worktree", "add", "--detach", "--no-checkout", worktree, baseCommit]);
  try {
    await git(worktree, ["checkout", "--detach", baseCommit]);
    const actualWorktree = await realpath(worktree);
    await writeFile(metadata, `${JSON.stringify({ repoRoot, worktree: actualWorktree, baseCommit })}\n`, { mode: 0o600, flag: "wx" });
    const mapped = join(actualWorktree, relative(repoRoot, requested));
    return { repoRoot, worktree: actualWorktree, baseCommit, cwd: await realpath(mapped) };
  } catch (error) {
    await git(repoRoot, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
    await Promise.all([rm(worktree, { recursive: true, force: true }), rm(metadata, { force: true })]);
    await rm(metadataRoot, { recursive: false }).catch(() => undefined);
    await rm(dirname(worktree), { recursive: false }).catch(() => undefined);
    throw error;
  }
}

export async function recoverAgentWorktree(cwd: string, agentId: string): Promise<AgentWorkspace> {
  const repoRoot = await repositoryRoot(cwd);
  const { root, worktree, metadata } = worktreeLocation(repoRoot, agentId);
  const info = await lstat(worktree);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid agent worktree");
  const actualWorktree = await realpath(worktree);
  if (!isPathInside(await realpath(root), actualWorktree)) throw new Error("Invalid agent worktree path");
  const metadataInfo = await lstat(metadata);
  if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > MAX_METADATA_BYTES) throw new Error("Invalid agent worktree metadata");
  const saved = JSON.parse(await readFile(metadata, "utf8")) as Record<string, unknown>;
  if (saved.repoRoot !== repoRoot || saved.worktree !== actualWorktree || typeof saved.baseCommit !== "string" || !/^[0-9a-f]{40,64}$/i.test(saved.baseCommit)) {
    throw new Error("Invalid agent worktree metadata");
  }
  const parentCommon = await realpath(resolve(repoRoot, (await git(repoRoot, ["rev-parse", "--git-common-dir"])).trim()));
  const workerCommon = await realpath(resolve(actualWorktree, (await git(actualWorktree, ["rev-parse", "--git-common-dir"])).trim()));
  if (parentCommon !== workerCommon) throw new Error("Agent worktree belongs to another repository");
  const baseCommit = (await git(repoRoot, ["rev-parse", "--verify", `${saved.baseCommit}^{commit}`])).trim();
  if (baseCommit !== saved.baseCommit) throw new Error("Invalid agent worktree base commit");
  return { repoRoot, worktree: actualWorktree, baseCommit };
}

export async function agentDiff(workspace: AgentWorkspace): Promise<string> {
  const untracked = (await git(workspace.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  if (untracked.length > MAX_UNTRACKED_FILES) throw new Error(`Agent diff contains more than ${MAX_UNTRACKED_FILES} untracked files`);
  for (const path of untracked) await git(workspace.worktree, ["add", "--intent-to-add", "--", path]);
  return git(workspace.worktree, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", workspace.baseCommit, "--"]);
}

export async function applyAgentDiff(workspace: AgentWorkspace, patch: string): Promise<void> {
  if (!patch) return;
  const names = (await git(workspace.worktree, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", workspace.baseCommit, "--"])).split("\0").filter(Boolean);
  const untracked = (await git(workspace.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const touched = [...new Set([...names, ...untracked])];
  if (touched.length) {
    const dirty = await git(workspace.repoRoot, ["status", "--porcelain=v1", "--", ...touched]);
    if (dirty.trim()) throw new Error("Parent checkout has dirty paths touched by this agent");
  }
  const apply = (check: boolean) => new Promise<void>((resolvePromise, reject) => {
    const child = execFile("git", ["apply", "--binary", ...(check ? ["--check"] : []), "-"], {
      cwd: workspace.repoRoot, timeout: 30_000, maxBuffer: MAX_AGENT_DIFF_BYTES,
    }, (error) => error ? reject(error) : resolvePromise());
    child.stdin!.end(patch);
  });
  await apply(true);
  await apply(false);
}

export async function discardAgentWorktree(workspace: AgentWorkspace): Promise<void> {
  await git(workspace.repoRoot, ["worktree", "remove", "--force", workspace.worktree]);
  const root = dirname(workspace.worktree);
  const metadataRoot = join(root, ".metadata");
  await Promise.all([
    rm(workspace.worktree, { recursive: true, force: true }),
    rm(join(metadataRoot, `${basename(workspace.worktree)}.json`), { force: true }),
  ]);
  await rm(metadataRoot, { recursive: false }).catch(() => undefined);
  await rm(root, { recursive: false }).catch(() => undefined);
}
