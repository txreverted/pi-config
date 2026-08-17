import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emptyTaskSnapshot, validateTaskSnapshot, type TaskSnapshot } from "./task-core.ts";

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 2_000;
const MAX_STORE_BYTES = 1_500_000;

function safeListId(value: string): string {
  if (!value || value === "." || value === ".." || !/^[A-Za-z0-9._-]{1,200}$/.test(value)) throw new Error("Invalid shared task list id");
  return value;
}

export function taskListId(ctx: ExtensionContext): string {
  return safeListId(process.env.PI_CONFIG_TASK_LIST_ID ?? ctx.sessionManager.getSessionId());
}

export function taskStoreDirectory(ctx: ExtensionContext): string {
  return join(getAgentDir(), "pi-config", "tasks", taskListId(ctx));
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class TaskStore {
  readonly directory: string;
  readonly file: string;
  readonly lock: string;
  readonly recoveryLock: string;

  constructor(directory: string) {
    this.directory = directory;
    this.file = join(directory, "tasks.json");
    this.lock = join(directory, ".lock");
    this.recoveryLock = join(directory, ".lock-recovery");
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid shared task store directory");
    await chmod(this.directory, 0o700);
  }

  async read(): Promise<TaskSnapshot> {
    await this.prepare();
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyTaskSnapshot();
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_STORE_BYTES) throw new Error("Invalid shared task store file");
      const content = await handle.readFile("utf8");
      let value: unknown;
      try { value = JSON.parse(content); } catch { throw new Error("Shared task store is corrupt"); }
      return validateTaskSnapshot(value);
    } finally {
      await handle.close();
    }
  }

  private async readLockOwner(directory = this.lock): Promise<{ host: string; pid: number; token: string }> {
    const ownerPath = join(directory, "owner.json");
    let handle;
    try {
      handle = await open(ownerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1_024) throw new Error("Invalid shared task lock owner");
      const owner = JSON.parse(await handle.readFile("utf8")) as Record<string, unknown>;
      if (typeof owner.host !== "string" || !Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1 || typeof owner.token !== "string") {
        throw new Error("Invalid shared task lock owner");
      }
      return owner as { host: string; pid: number; token: string };
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Invalid shared task lock owner");
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async recoverStale(expected: { host: string; pid: number; token: string }): Promise<void> {
    const token = randomUUID();
    try {
      await mkdir(this.recoveryLock, { mode: 0o700 });
      const owner = await open(join(this.recoveryLock, "owner.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        await owner.writeFile(`${JSON.stringify({ host: hostname(), pid: process.pid, token })}\n`, "utf8");
        await owner.sync();
      } finally {
        await owner.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      await rm(this.recoveryLock, { recursive: true, force: true });
      throw error;
    }
    try {
      let current;
      try { current = await this.readLockOwner(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (current.host !== expected.host || current.pid !== expected.pid || current.token !== expected.token) return;
      let alive = true;
      try { process.kill(current.pid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (!alive) await rm(this.lock, { recursive: true, force: true });
    } finally {
      await rm(this.recoveryLock, { recursive: true, force: true });
    }
  }

  private async acquire(): Promise<string> {
    await this.prepare();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const recovery = await lstat(this.recoveryLock);
        if (!recovery.isDirectory() || recovery.isSymbolicLink()) throw new Error("Shared task recovery lock is invalid");
        if (Date.now() - recovery.mtimeMs > LOCK_STALE_MS) {
          let owner;
          try { owner = await this.readLockOwner(this.recoveryLock); } catch {
            throw new Error("Cannot safely recover stale shared task recovery lock");
          }
          if (owner.host !== hostname()) throw new Error("Cannot safely recover shared task recovery lock from another host");
          let alive = true;
          try { process.kill(owner.pid, 0); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
          }
          if (!alive) { await rm(this.recoveryLock, { recursive: true, force: true }); continue; }
        }
        if (Date.now() >= deadline) throw new Error("Shared task store is locked");
        await sleep(20);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const token = randomUUID();
      try {
        await mkdir(this.lock, { mode: 0o700 });
        const owner = await open(join(this.lock, "owner.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          await owner.writeFile(`${JSON.stringify({ host: hostname(), pid: process.pid, token })}\n`, "utf8");
          await owner.sync();
        } finally {
          await owner.close();
        }
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          await rm(this.lock, { recursive: true, force: true });
          throw error;
        }
      }
      let info;
      try { info = await lstat(this.lock); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Shared task lock is not a directory");
      if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        let owner;
        try { owner = await this.readLockOwner(); } catch {
          throw new Error("Cannot safely recover stale shared task lock");
        }
        if (owner.host !== hostname()) throw new Error("Cannot safely recover stale shared task lock from another host");
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
        }
        if (!alive) {
          await this.recoverStale(owner);
          continue;
        }
      }
      if (Date.now() >= deadline) throw new Error("Shared task store is locked");
      await sleep(20);
    }
  }

  private async release(token: string): Promise<void> {
    let owner;
    try { owner = await this.readLockOwner(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Shared task lock disappeared before release");
      throw error;
    }
    if (owner.host !== hostname() || owner.pid !== process.pid || owner.token !== token) {
      throw new Error("Shared task lock ownership changed before release");
    }
    await rm(this.lock, { recursive: true });
  }

  private async write(snapshot: TaskSnapshot): Promise<void> {
    const validated = validateTaskSnapshot(snapshot);
    const encoded = `${JSON.stringify(validated)}\n`;
    if (Buffer.byteLength(encoded) > MAX_STORE_BYTES) throw new Error(`Shared task store exceeds ${MAX_STORE_BYTES} bytes`);
    const temporary = join(this.directory, `.tasks.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      await handle.writeFile(encoded, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(temporary, { force: true });
      throw error;
    }
    await handle.close();
    try {
      await rename(temporary, this.file);
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async transact<T>(change: (snapshot: TaskSnapshot) => { snapshot: TaskSnapshot; result: T }): Promise<T> {
    const token = await this.acquire();
    try {
      const current = await this.read();
      const next = change(current);
      await this.write(next.snapshot);
      return next.result;
    } finally {
      await this.release(token);
    }
  }
}

export function taskStoreForContext(ctx: ExtensionContext): TaskStore {
  return new TaskStore(taskStoreDirectory(ctx));
}
