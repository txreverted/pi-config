import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${totalSeconds % 60}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h${totalMinutes % 60}m`;
  return `${Math.floor(totalHours / 24)}d${totalHours % 24}h`;
}

export default function uiExtension(pi: ExtensionAPI): void {
  let runStartedAt: number | undefined;
  let activeContext: ExtensionContext | undefined;
  let clock: NodeJS.Timeout | undefined;

  const stopClock = () => {
    if (clock) clearInterval(clock);
    clock = undefined;
  };

  const updateClock = () => {
    if (runStartedAt === undefined || !activeContext) return;
    activeContext.ui.setWorkingMessage(`Working... (${formatDuration(Date.now() - runStartedAt)})`);
  };

  const reset = (ctx?: ExtensionContext) => {
    stopClock();
    runStartedAt = undefined;
    activeContext = undefined;
    ctx?.ui.setWorkingMessage();
  };

  pi.on("session_start", (_event, ctx) => {
    reset(ctx.mode === "tui" ? ctx : undefined);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeContext = ctx;
    if (runStartedAt !== undefined) {
      updateClock();
      return;
    }
    runStartedAt = Date.now();
    updateClock();
    clock = setInterval(updateClock, 1_000);
    clock.unref();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (runStartedAt === undefined || ctx.mode !== "tui") return;
    updateClock();
    reset(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    reset(ctx.mode === "tui" ? ctx : undefined);
  });
}
