import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export const PONYTAIL_RUNTIME_MODES = ["off", "lite", "full", "ultra"] as const;
export type PonytailMode = typeof PONYTAIL_RUNTIME_MODES[number];
export type PonytailSessionMode = PonytailMode | "review";
export const DEFAULT_PONYTAIL_MODE: PonytailMode = "full";

interface PonytailConfig {
  defaultMode?: unknown;
  quietStartup?: unknown;
  hideStatus?: unknown;
  [key: string]: unknown;
}

export type PonytailCommand =
  | { type: "set-mode"; mode: PonytailMode }
  | { type: "set-default"; mode: PonytailMode }
  | { type: "status" }
  | { type: "invalid" };

export function normalizePonytailMode(value: unknown): PonytailMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return PONYTAIL_RUNTIME_MODES.find((mode) => mode === normalized);
}

export function normalizePonytailSessionMode(value: unknown): PonytailSessionMode | undefined {
  return normalizePonytailMode(value) ?? (typeof value === "string" && value.trim().toLowerCase() === "review" ? "review" : undefined);
}

export function ponytailConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const appData = process.env.APPDATA;
  const base = xdg && isAbsolute(xdg)
    ? xdg
    : process.platform === "win32"
      ? appData && isAbsolute(appData) ? appData : join(homedir(), "AppData", "Roaming")
      : join(homedir(), ".config");
  return join(base, "ponytail", "config.json");
}

function parseConfig(contents: string): PonytailConfig | undefined {
  const parsed: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as PonytailConfig
    : undefined;
}

function readConfig(): PonytailConfig {
  const path = ponytailConfigPath();
  try {
    const config = parseConfig(readFileSync(path, "utf8"));
    if (!config) throw new Error("config must contain a JSON object");
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read Ponytail config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readConfigForWrite(path: string): PonytailConfig {
  try {
    const config = parseConfig(readFileSync(path, "utf8"));
    if (!config) throw new Error("Ponytail config must contain a JSON object");
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function environmentBoolean(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error(`${name} must be one of: 1, true, yes, 0, false, no`);
}

function configBoolean(config: PonytailConfig, key: "quietStartup" | "hideStatus"): boolean {
  const value = config[key];
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new Error(`Ponytail config ${key} must be a boolean`);
}

export function readPonytailDefaultMode(): PonytailMode {
  const environment = process.env.PONYTAIL_DEFAULT_MODE;
  if (environment !== undefined) {
    const mode = normalizePonytailMode(environment);
    if (!mode) throw new Error(`PONYTAIL_DEFAULT_MODE must be one of: ${PONYTAIL_RUNTIME_MODES.join(", ")}`);
    return mode;
  }
  const configured = readConfig().defaultMode;
  if (configured === undefined) return DEFAULT_PONYTAIL_MODE;
  const mode = normalizePonytailMode(configured);
  if (!mode) throw new Error(`Ponytail config defaultMode must be one of: ${PONYTAIL_RUNTIME_MODES.join(", ")}`);
  return mode;
}

export function readPonytailQuietStartup(): boolean {
  return environmentBoolean("PONYTAIL_QUIET_STARTUP") ?? configBoolean(readConfig(), "quietStartup");
}

export function readPonytailHideStatus(): boolean {
  return environmentBoolean("PONYTAIL_HIDE_STATUS") ?? configBoolean(readConfig(), "hideStatus");
}

export function writePonytailDefaultMode(value: unknown): PonytailMode | undefined {
  const mode = normalizePonytailMode(value);
  if (!mode) return undefined;

  const path = ponytailConfigPath();
  const config = readConfigForWrite(path);
  config.defaultMode = mode;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return mode;
}

export function parsePonytailCommand(value: unknown, configuredDefault = DEFAULT_PONYTAIL_MODE): PonytailCommand {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { type: "set-mode", mode: configuredDefault === "off" ? "full" : configuredDefault };

  const [command, argument, ...rest] = text.split(/\s+/);
  if (rest.length > 0) return { type: "invalid" };
  if (command === "status" && argument === undefined) return { type: "status" };
  if (command === "default") {
    const mode = normalizePonytailMode(argument);
    return mode ? { type: "set-default", mode } : { type: "invalid" };
  }
  if (argument !== undefined) return { type: "invalid" };
  const mode = normalizePonytailMode(command);
  return mode ? { type: "set-mode", mode } : { type: "invalid" };
}

export function resolvePonytailSessionMode(
  entries: readonly unknown[] | undefined,
  fallback: PonytailMode = DEFAULT_PONYTAIL_MODE,
): PonytailSessionMode {
  if (!entries) return fallback;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; customType?: unknown; data?: { mode?: unknown } };
    if (record.type !== "custom" || record.customType !== "ponytail-mode") continue;
    const mode = normalizePonytailSessionMode(record.data?.mode);
    if (mode) return mode;
  }
  return fallback;
}

export function isPonytailDeactivationCommand(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase().replace(/[.!?\s]+$/, "");
  return text === "stop ponytail" || text === "normal mode";
}

export function filterPonytailSkillForMode(body: string, mode: PonytailMode): string {
  return body
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\r?\n/)
    .filter((line) => {
      const tableMode = line.match(/^\|\s*\*\*(lite|full|ultra)\*\*\s*\|/i)?.[1]?.toLowerCase();
      if (tableMode) return tableMode === mode;
      const exampleMode = line.match(/^-\s*(lite|full|ultra):\s*"/i)?.[1]?.toLowerCase();
      return !exampleMode || exampleMode === mode;
    })
    .join("\n")
    .trim();
}

export function buildPonytailInstructions(skillBody: string, mode: PonytailSessionMode): string {
  if (mode === "off") return "";
  if (mode === "review") return "PONYTAIL MODE ACTIVE — level: review. Follow the ponytail-review skill.";
  const scopeRule = mode === "lite"
    ? "LITE SCOPE: Build all explicitly requested behavior. Use the ladder only to choose the implementation, then name a lazier alternative in one sentence; do not omit or narrow requirements."
    : mode === "full"
      ? "FULL SCOPE: Skip speculative behavior and use the smallest safe interpretation that satisfies the concrete request."
      : "ULTRA SCOPE: Challenge speculative requirements, delete before adding, and implement only the narrowest safe behavior the concrete request needs.";
  return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${scopeRule}\n\n${filterPonytailSkillForMode(skillBody, mode)}`;
}
