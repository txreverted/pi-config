import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";

export function formatCwd(cwd: string): string {
  const home = resolve(homedir());
  const absoluteCwd = resolve(cwd);
  const fromHome = relative(home, absoluteCwd);
  const insideHome =
    fromHome === "" ||
    (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !fromHome.startsWith(sep));

  if (!insideHome) return cwd;
  return fromHome === "" ? "~" : `~${sep}${fromHome}`;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return `${count}`;
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes === 0) return `${seconds}s`;
  if (totalMinutes < 60) return `${totalMinutes}m${seconds.toString().padStart(2, "0")}s`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, "0")}m`;
}

export function pickStatusCandidate(
  candidates: readonly string[],
  width: number,
  measure: (value: string) => number,
): string {
  return candidates.find((candidate) => measure(candidate) <= width) ?? candidates[candidates.length - 1] ?? "";
}
