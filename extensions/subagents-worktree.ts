import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);
export const MAX_AGENT_DIFF_BYTES = 2_000_000;
const MAX_UNTRACKED_FILES = 1_000;

export interface AgentWorkspace {
  repoRoot: string;
  worktree: string;
  baseCommit: string;
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
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

export async function repositoryIdentity(cwd: string): Promise<{ repoRoot: string; baseCommit: string }> {
  const rootText = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const repoRoot = await realpath(rootText);
  if (!(await stat(repoRoot)).isDirectory()) throw new Error("Writable agents require a Git repository");
  const baseCommit = (await git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new Error("Git HEAD is not a commit");
  return { repoRoot, baseCommit };
}

export async function createAgentWorktree(cwd: string, agentId: string): Promise<AgentWorkspace & { cwd: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(agentId)) throw new Error("Invalid agent id");
  const { repoRoot, baseCommit } = await repositoryIdentity(cwd);
  if ((await git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])).trim()) {
    throw new Error("Background writable agents require a clean parent checkout; use a foreground worker or clean/stash first");
  }
  const requested = await realpath(resolve(cwd));
  if (!inside(repoRoot, requested)) throw new Error("Agent cwd must be inside its repository");
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 24);
  const root = join(getAgentDir(), "pi-config", "worktrees", hash);
  const worktree = join(root, agentId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await lstat(worktree);
    throw new Error(`Agent worktree already exists: ${worktree}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await git(repoRoot, ["worktree", "add", "--detach", "--no-checkout", worktree, baseCommit]);
  try {
    await git(worktree, ["checkout", "--detach", baseCommit]);
    const mapped = join(worktree, relative(repoRoot, requested));
    return { repoRoot, worktree: await realpath(worktree), baseCommit, cwd: await realpath(mapped) };
  } catch (error) {
    await git(repoRoot, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
    await rm(worktree, { recursive: true, force: true });
    throw error;
  }
}

export async function agentDiff(workspace: AgentWorkspace): Promise<string> {
  const tracked = await git(workspace.worktree, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", workspace.baseCommit, "--"]);
  const untracked = (await git(workspace.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  if (untracked.length > MAX_UNTRACKED_FILES) throw new Error(`Agent diff contains more than ${MAX_UNTRACKED_FILES} untracked files`);
  let patch = tracked;
  for (const path of untracked) {
    try {
      patch += await git(workspace.worktree, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "--no-index", "--", "/dev/null", path]);
    } catch (error) {
      const output = (error as { stdout?: string }).stdout;
      if (typeof output === "string") patch += output;
      else throw error;
    }
    if (Buffer.byteLength(patch) > MAX_AGENT_DIFF_BYTES) throw new Error(`Agent diff exceeds ${MAX_AGENT_DIFF_BYTES} bytes`);
  }
  return patch;
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
  await rm(workspace.worktree, { recursive: true, force: true });
  await rm(dirname(workspace.worktree), { recursive: false }).catch(() => undefined);
}
