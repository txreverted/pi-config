import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  buildPonytailInstructions,
  ponytailSkillCommonBody,
  isPonytailDeactivationCommand,
  loadPonytailSettings,
  parsePonytailCommand,
  ponytailConfigPath,
  readPonytailDefaultMode,
  resolvePonytailSessionMode,
  writePonytailDefaultMode,
} from "../extensions/ponytail-core.ts";

function withConfigEnvironment(run) {
  const root = mkdtempSync(join(tmpdir(), "pi-config-ponytail-"));
  const names = ["XDG_CONFIG_HOME", "PONYTAIL_DEFAULT_MODE", "PONYTAIL_HIDE_STATUS", "PONYTAIL_QUIET_STARTUP"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.XDG_CONFIG_HOME = root;
  for (const name of names.slice(1)) delete process.env[name];
  try {
    return run(root);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test("Ponytail command parsing is strict and bare activation uses the configured default", () => {
  assert.deepEqual(parsePonytailCommand("", "off"), { type: "set-mode", mode: "off" });
  assert.deepEqual(parsePonytailCommand("lite"), { type: "set-mode", mode: "lite" });
  assert.deepEqual(parsePonytailCommand("status"), { type: "status" });
  assert.deepEqual(parsePonytailCommand("default ultra"), { type: "set-default", mode: "ultra" });
  assert.deepEqual(parsePonytailCommand("default review"), { type: "invalid" });
  assert.deepEqual(parsePonytailCommand("ultra now"), { type: "invalid" });
});

test("latest valid session mode wins and deactivation requires a standalone command", () => {
  const entries = [
    { type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "review" } },
  ];
  assert.equal(resolvePonytailSessionMode(entries, "full"), "ultra");
  assert.equal(resolvePonytailSessionMode(undefined, "lite"), "lite");
  assert.equal(isPonytailDeactivationCommand("Normal mode!"), true);
  assert.equal(isPonytailDeactivationCommand("add a normal mode toggle"), false);
});

test("config paths ignore empty and relative XDG roots", () => withConfigEnvironment(() => {
  process.env.XDG_CONFIG_HOME = "";
  assert.equal(isAbsolute(ponytailConfigPath()), true);
  process.env.XDG_CONFIG_HOME = "relative-config";
  assert.equal(isAbsolute(ponytailConfigPath()), true);
  assert.doesNotMatch(ponytailConfigPath(), /relative-config/);
}));

test("default resolves from environment before preserved config fields", () => withConfigEnvironment(() => {
  const path = ponytailConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ defaultMode: "lite", quietStartup: true, hideStatus: true, other: 7 }));

  assert.equal(readPonytailDefaultMode(), "lite");
  assert.deepEqual(loadPonytailSettings(), { defaultMode: "lite", errors: [] });

  process.env.PONYTAIL_DEFAULT_MODE = "ultra";
  assert.equal(readPonytailDefaultMode(), "ultra");
  assert.deepEqual(loadPonytailSettings(), { defaultMode: "ultra", errors: [] });

  assert.equal(writePonytailDefaultMode("full"), "full");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    defaultMode: "full",
    quietStartup: true,
    hideStatus: true,
    other: 7,
  });
}));

test("saving a default refuses to destroy malformed configuration", () => withConfigEnvironment(() => {
  const path = ponytailConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  for (const contents of ["{broken", "[]"]) {
    writeFileSync(path, contents);
    assert.throws(() => readPonytailDefaultMode(), /Could not read Ponytail config/);
    assert.throws(() => writePonytailDefaultMode("lite"));
    assert.equal(readFileSync(path, "utf8"), contents);
  }

  writeFileSync(path, JSON.stringify({ defaultMode: "fast" }));
  assert.throws(() => readPonytailDefaultMode(), /defaultMode must be one of/);
}));

test("common skill extraction removes the complete intensity section without parsing its formatting", () => {
  const body = `---\nname: ponytail\n---\n# Ponytail\nShared\n## Intensity\nformat this section however needed\n| **full** | row |\n   ## Safety floor\nKeep safety`;
  const common = ponytailSkillCommonBody(body);
  assert.match(common, /# Ponytail\nShared/);
  assert.doesNotMatch(common, /Intensity|format this section|full.*row/i);
  assert.match(common, /   ## Safety floor\nKeep safety/);
  assert.match(buildPonytailInstructions(body, "full"), /^PONYTAIL MODE ACTIVE - level: full/);
  assert.equal(buildPonytailInstructions(body, "off"), "");
});

test("real instructions keep common safety rules and isolate every mode scope", () => {
  const body = readFileSync(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  const scopes = {
    lite: "LITE SCOPE: Build all explicitly requested behavior",
    full: "FULL SCOPE: Skip speculative behavior",
    ultra: "ULTRA SCOPE: Challenge speculative requirements",
  };
  for (const [mode, selected] of Object.entries(scopes)) {
    const instructions = buildPonytailInstructions(body, mode);
    assert.match(instructions, new RegExp(selected));
    for (const other of Object.values(scopes).filter((scope) => scope !== selected)) {
      assert.doesNotMatch(instructions, new RegExp(other));
    }
    assert.doesNotMatch(instructions, /## Intensity|add a response cache/i);
    assert.match(instructions, /## Safety floor/);
    assert.match(instructions, /Do not apply Ponytail to non-coding requests/);
    assert.doesNotMatch(instructions, /## Output|three short lines/);
  }
});
