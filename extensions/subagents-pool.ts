export type PoolItemPhase = "queued" | "running" | "fulfilled" | "rejected" | "aborted";

export interface PoolItemSnapshot<T> {
  index: number;
  item: T;
  phase: PoolItemPhase;
}

export interface PoolSnapshot<T> {
  active: number;
  settled: number;
  items: readonly PoolItemSnapshot<T>[];
}

export type PoolItemOutcome<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown }
  | { status: "aborted" };

export interface OrderedPoolOptions<T> {
  concurrency: number;
  signal?: AbortSignal;
  priority?: (item: T, index: number) => number;
  onUpdate?: (snapshot: PoolSnapshot<T>) => void;
}

function poolSnapshot<T>(items: readonly T[], phases: readonly PoolItemPhase[]): PoolSnapshot<T> {
  const states = phases.map((phase, index) => Object.freeze({ index, item: items[index], phase }));
  return Object.freeze({
    active: phases.filter((phase) => phase === "running").length,
    settled: phases.filter((phase) => phase === "fulfilled" || phase === "rejected" || phase === "aborted").length,
    items: Object.freeze(states),
  });
}

export async function runOrderedPool<T, R>(
  items: readonly T[],
  run: (item: T, index: number, signal?: AbortSignal) => Promise<R>,
  options: OrderedPoolOptions<T>,
): Promise<readonly PoolItemOutcome<R>[]> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("Pool concurrency must be a positive integer.");
  }

  const phases: PoolItemPhase[] = items.map(() => "queued");
  const outcomes: Array<PoolItemOutcome<R> | undefined> = items.map(() => undefined);
  const queue = items
    .map((item, index) => ({ item, index, priority: options.priority?.(item, index) ?? 0 }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  let next = 0;
  let aborted = options.signal?.aborted ?? false;

  const emit = () => options.onUpdate?.(poolSnapshot(items, phases));
  const markQueuedAborted = () => {
    aborted = true;
    let changed = false;
    for (let index = 0; index < phases.length; index++) {
      if (phases[index] !== "queued") continue;
      phases[index] = "aborted";
      outcomes[index] = { status: "aborted" };
      changed = true;
    }
    if (changed) emit();
  };

  options.signal?.addEventListener("abort", markQueuedAborted, { once: true });
  if (aborted) markQueuedAborted();
  else emit();

  const worker = async () => {
    while (!aborted) {
      const queued = queue[next++];
      if (!queued) return;
      const { index, item } = queued;
      phases[index] = "running";
      emit();
      try {
        const value = await run(item, index, options.signal);
        phases[index] = "fulfilled";
        outcomes[index] = { status: "fulfilled", value };
      } catch (reason) {
        phases[index] = "rejected";
        outcomes[index] = { status: "rejected", reason };
      }
      emit();
    }
  };

  try {
    const workers = Math.min(options.concurrency, items.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (aborted) markQueuedAborted();
    return outcomes.map((outcome) => outcome ?? { status: "aborted" });
  } finally {
    options.signal?.removeEventListener("abort", markQueuedAborted);
  }
}
