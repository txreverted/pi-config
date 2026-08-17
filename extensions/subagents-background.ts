import {
  emptyUsage,
  type ChildRunProgress,
  type ChildRunResult,
  type ChildTask,
  type ThinkingLevel,
  type UsageSummary,
} from "./subagents-core.ts";

export interface BackgroundRunView {
  name: string;
  progress: ChildRunProgress;
}

interface BackgroundRecord {
  task: ChildTask;
  progress: ChildRunProgress;
  result?: ChildRunResult;
  controller: AbortController;
  run: (signal: AbortSignal, onUpdate: (progress: ChildRunProgress) => void) => Promise<ChildRunResult>;
  promise: Promise<ChildRunResult>;
  resolve: (result: ChildRunResult) => void;
}

export interface CollectedBackgroundRun {
  result: ChildRunResult;
  usage: UsageSummary;
}

function cloneProgress(progress: ChildRunProgress): ChildRunProgress {
  return { ...progress, usage: { ...progress.usage, cost: { ...progress.usage.cost } } };
}

function errorResult(record: BackgroundRecord, error: unknown): ChildRunResult {
  const endedAt = Date.now();
  return {
    ...record.progress,
    status: "error",
    task: record.task.task,
    cwd: record.task.cwd,
    output: "",
    error: error instanceof Error ? error.message : String(error),
    exitCode: null,
    endedAt,
    durationMs: endedAt - record.progress.startedAt,
    truncated: false,
  };
}

export class BackgroundRunManager {
  private readonly records = new Map<string, BackgroundRecord>();
  private readonly queue: string[] = [];
  private running = 0;
  private disposed = false;
  private readonly concurrency: number;
  private readonly capacity: number;
  private readonly onComplete: (result: ChildRunResult) => void;
  private readonly onChange?: () => void;

  constructor(
    concurrency: number,
    capacity: number,
    onComplete: (result: ChildRunResult) => void,
    onChange?: () => void,
  ) {
    this.concurrency = concurrency;
    this.capacity = capacity;
    this.onComplete = onComplete;
    this.onChange = onChange;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  availableSlots(): number {
    return Math.max(0, this.capacity - this.records.size);
  }

  hasOutstanding(): boolean {
    return this.records.size > 0;
  }

  enqueue(
    task: ChildTask,
    thinking: ThinkingLevel,
    run: BackgroundRecord["run"],
  ): ChildRunProgress {
    if (this.disposed) throw new Error("Background subagent manager is shut down");
    if (this.records.has(task.id)) throw new Error(`Background subagent id '${task.id}' already exists`);
    if (this.availableSlots() === 0) {
      throw new Error(`Background subagent capacity is ${this.capacity}; collect a completed result before starting more`);
    }

    let resolve!: (result: ChildRunResult) => void;
    const promise = new Promise<ChildRunResult>((done) => { resolve = done; });
    const progress: ChildRunProgress = {
      id: task.id,
      agent: task.agent,
      thinking,
      status: "queued",
      startedAt: Date.now(),
      turns: 0,
      toolCalls: 0,
      text: "",
      usage: emptyUsage(),
    };
    this.records.set(task.id, {
      task,
      progress,
      controller: new AbortController(),
      run,
      promise,
      resolve,
    });
    this.queue.push(task.id);
    this.drain();
    this.changed();
    return this.progress(task.id)!;
  }

  active(): BackgroundRunView[] {
    return [...this.records.values()]
      .filter((record) => !record.result)
      .map((record) => ({ name: record.task.name, progress: cloneProgress(record.progress) }));
  }

  progress(id: string): ChildRunProgress | undefined {
    const record = this.records.get(id);
    return record ? cloneProgress(record.result ?? record.progress) : undefined;
  }

  result(id: string): ChildRunResult | undefined {
    return this.records.get(id)?.result;
  }

  async wait(id: string, signal?: AbortSignal): Promise<ChildRunResult | undefined> {
    const record = this.records.get(id);
    if (!record) return undefined;
    if (record.result) return record.result;
    if (!signal) return record.promise;
    if (signal.aborted) throw new Error("Waiting for background subagent was aborted");

    return new Promise<ChildRunResult>((resolve, reject) => {
      const onAbort = () => reject(new Error("Waiting for background subagent was aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      void record.promise.then((result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      });
    });
  }

  collect(id: string): CollectedBackgroundRun | undefined {
    const record = this.records.get(id);
    if (!record?.result) return undefined;
    this.records.delete(id);
    this.changed();
    return { result: record.result, usage: record.result.usage };
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.result) return false;
    if (record.progress.status === "queued") {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      this.finish(record, errorResult(record, "Background subagent was cancelled before launch"));
      return true;
    }
    record.controller.abort();
    return true;
  }

  update(id: string, progress: ChildRunProgress): void {
    const record = this.records.get(id);
    if (!record || record.result) return;
    const previous = record.progress;
    record.progress = cloneProgress(progress);
    if (previous.status !== progress.status ||
      previous.currentTool !== progress.currentTool ||
      previous.activity !== progress.activity ||
      previous.toolCalls !== progress.toolCalls ||
      previous.usage.totalTokens !== progress.usage.totalTokens) {
      this.changed();
    }
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    for (const record of this.records.values()) {
      if (!record.result) this.cancel(record.task.id);
    }
    await Promise.allSettled([...this.records.values()].map((record) => record.promise));
  }

  private drain(): void {
    while (!this.disposed && this.running < Math.max(1, this.concurrency) && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const record = this.records.get(id);
      if (!record || record.result || record.progress.status !== "queued") continue;
      this.start(record);
    }
  }

  private start(record: BackgroundRecord): void {
    this.running++;
    record.progress = { ...record.progress, status: "starting", startedAt: Date.now() };
    this.changed();
    void (async () => {
      let result: ChildRunResult;
      try {
        result = await record.run(record.controller.signal, (progress) => this.update(record.task.id, progress));
      } catch (error) {
        result = errorResult(record, error);
      }
      this.running--;
      this.finish(record, result);
      this.drain();
    })();
  }

  private finish(record: BackgroundRecord, result: ChildRunResult): void {
    if (record.result) return;
    record.result = result;
    record.progress = result;
    record.resolve(result);
    this.changed();
    if (!this.disposed) this.onComplete(result);
  }

  private changed(): void {
    try {
      this.onChange?.();
    } catch {
      // UI refreshes do not own background execution.
    }
  }
}
