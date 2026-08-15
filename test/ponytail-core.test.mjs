import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  buildPonytailInstructions,
  filterPonytailSkillForMode,
  isPonytailDeactivationCommand,
  parsePonytailCommand,
  ponytailConfigPath,
  readPonytailDefaultMode,
  readPonytailHideStatus,
  readPonytailQuietStartup,
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

test("Ponytail command parsing is strict and bare activation escapes an off default", () => {
  assert.deepEqual(parsePonytailCommand("", "off"), { type: "set-mode", mode: "full" });
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

test("default and booleans resolve from environment before the preserved config", () => withConfigEnvironment(() => {
  const path = ponytailConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ defaultMode: "lite", quietStartup: true, hideStatus: true, other: 7 }));

  assert.equal(readPonytailDefaultMode(), "lite");
  assert.equal(readPonytailQuietStartup(), true);
  assert.equal(readPonytailHideStatus(), true);

  process.env.PONYTAIL_DEFAULT_MODE = "ultra";
  process.env.PONYTAIL_QUIET_STARTUP = "false";
  process.env.PONYTAIL_HIDE_STATUS = "0";
  assert.equal(readPonytailDefaultMode(), "ultra");
  assert.equal(readPonytailQuietStartup(), false);
  assert.equal(readPonytailHideStatus(), false);

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
    assert.throws(() => writePonytailDefaultMode("lite"));
    assert.equal(readFileSync(path, "utf8"), contents);
  }
}));

test("mode filtering keeps shared rules and only the selected intensity example", () => {
  const body = `---\nname: ponytail\n---\n| **lite** | lite row |\n| **full** | full row |\n| **ultra** | ultra row |\n- lite: "lite example"\n- full: "full example"\n- ultra: "ultra example"\n- Full: ordinary unquoted rule\nShared`;
  const filtered = filterPonytailSkillForMode(body, "full");
  assert.doesNotMatch(filtered, /lite row|ultra row|lite example|ultra example/);
  assert.match(filtered, /full row/);
  assert.match(filtered, /full example/);
  assert.match(filtered, /Full: ordinary unquoted rule/);
  assert.match(buildPonytailInstructions(body, "full"), /^PONYTAIL MODE ACTIVE — level: full/);
});

test("real instructions preserve coding scope and distinct intensity semantics", () => {
  const body = readFileSync(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  const lite = buildPonytailInstructions(body, "lite");
  const full = buildPonytailInstructions(body, "full");
  assert.match(lite, /LITE SCOPE: Build all explicitly requested behavior/);
  assert.doesNotMatch(lite, /Skip speculative behavior/);
  assert.match(full, /FULL SCOPE: Skip speculative behavior/);
  assert.match(lite, /Do not apply Ponytail's implementation or output restrictions to non-coding requests/);
});
