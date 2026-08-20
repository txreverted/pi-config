import test from "node:test";
import assert from "node:assert/strict";
import { applyFffDefaultMode, DEFAULT_FFF_MODE } from "../extensions/fff.ts";

test("FFF defaults to override mode without replacing an explicit choice", () => {
  const defaults = {};
  applyFffDefaultMode(defaults);
  assert.equal(defaults.PI_FFF_MODE, "override");
  assert.equal(DEFAULT_FFF_MODE, "override");

  for (const mode of ["tools-and-ui", "tools-only", "override"]) {
    const environment = { PI_FFF_MODE: mode };
    applyFffDefaultMode(environment);
    assert.equal(environment.PI_FFF_MODE, mode);
  }
});
