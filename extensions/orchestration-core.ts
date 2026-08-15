export const RUN_UI_TICK_MS = 1_000;
export const RUN_HEALTH_SWEEP_MS = 5_000;
export const SPAWN_ACK_TIMEOUT_MS = 5_000;
export const PROTOCOL_ACK_TIMEOUT_MS = 20_000;
export const QUIET_AFTER_MS = 30_000;
export const LONG_RUNNING_AFTER_MS = 2 * 60_000;
export const NEEDS_ATTENTION_AFTER_MS = 5 * 60_000;

export const RUN_LIFECYCLES = [
  "queued",
  "starting",
  "running",
  "retrying",
  "completed",
  "completed_with_warnings",
  "failed",
  "aborted",
  "timed_out",
  "paused",
  "skipped",
] as const;
export type RunLifecycle = typeof RUN_LIFECYCLES[number];

export const RUN_HEALTHS = ["healthy", "quiet", "long_running", "needs_attention", "dead"] as const;
export type RunHealth = typeof RUN_HEALTHS[number];

export interface RunTiming {
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  spawnedAt?: number;
  firstProtocolAt?: number;
  lastActivityAt?: number;
  currentTool?: string;
  currentToolStartedAt?: number;
}

export interface HealthThresholds {
  quietAfterMs: number;
  longRunningAfterMs: number;
  needsAttentionAfterMs: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: Readonly<HealthThresholds> = {
  quietAfterMs: QUIET_AFTER_MS,
  longRunningAfterMs: LONG_RUNNING_AFTER_MS,
  needsAttentionAfterMs: NEEDS_ATTENTION_AFTER_MS,
};

export function isTerminalLifecycle(status: RunLifecycle): boolean {
  return status === "completed" || status === "completed_with_warnings" || status === "failed" ||
    status === "aborted" || status === "timed_out" || status === "skipped";
}

export function elapsedMs(timing: RunTiming, now = Date.now()): number {
  const start = timing.startedAt ?? timing.queuedAt;
  return Math.max(0, (timing.endedAt ?? now) - start);
}

export function activityAgeMs(timing: RunTiming, now = Date.now()): number | undefined {
  const activityAt = timing.lastActivityAt ?? timing.firstProtocolAt ?? timing.spawnedAt ?? timing.startedAt;
  return activityAt === undefined ? undefined : Math.max(0, now - activityAt);
}

export function healthForRun(
  status: RunLifecycle,
  timing: RunTiming,
  now = Date.now(),
  thresholds: Readonly<HealthThresholds> = DEFAULT_HEALTH_THRESHOLDS,
): RunHealth {
  if (status === "failed" || status === "timed_out") return "dead";
  if (status === "aborted" || status === "skipped" || status === "paused" || status === "queued" || status === "starting" || status === "retrying") {
    return "healthy";
  }
  if (isTerminalLifecycle(status)) return "healthy";

  const age = activityAgeMs(timing, now) ?? 0;
  if (age >= thresholds.needsAttentionAfterMs) return "needs_attention";
  if (age >= thresholds.longRunningAfterMs) return "long_running";
  if (age >= thresholds.quietAfterMs) return "quiet";
  return "healthy";
}

export function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return `${seconds}s`;
  if (totalMinutes < 60) return `${totalMinutes}m${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, "0")}m`;
}

export function healthLabel(health: RunHealth): string {
  switch (health) {
    case "healthy": return "healthy";
    case "quiet": return "quiet";
    case "long_running": return "long-running";
    case "needs_attention": return "needs attention";
    case "dead": return "failed";
  }
}
