import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const cliPath = process.env.PI_CONFIG_SUBAGENT_REAL_CLI;
const stderrPath = process.env.PI_CONFIG_SUBAGENT_STDERR_PATH;
delete process.env.PI_CONFIG_SUBAGENT_REAL_CLI;
delete process.env.PI_CONFIG_SUBAGENT_STDERR_PATH;

if (!cliPath || !stderrPath) process.exit(64);

let stderrBytes = 0;
const maximum = 64 * 1024;
process.stderr.write = (chunk, encoding, callback) => {
  try {
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8");
    const kept = input.subarray(0, Math.max(0, maximum - stderrBytes));
    if (kept.length) appendFileSync(stderrPath, kept, { mode: 0o600 });
    stderrBytes += kept.length;
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  } catch {
    return false;
  }
};

try {
  await import(pathToFileURL(cliPath).href);
} catch (error) {
  process.stderr.write(error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`);
  process.exitCode = 1;
}
