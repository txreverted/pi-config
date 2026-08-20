import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const DEFAULT_FFF_MODE = "override";

export function applyFffDefaultMode(environment: NodeJS.ProcessEnv = process.env): void {
  environment.PI_FFF_MODE ??= DEFAULT_FFF_MODE;
}

export default function fffDefaultsExtension(_pi: ExtensionAPI): void {
  applyFffDefaultMode();
}
