import test from "node:test";
import assert from "node:assert/strict";
import uiExtension, { formatDuration } from "../extensions/ui.ts";

test("working durations stay compact", () => {
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(85_900), "1m25s");
  assert.equal(formatDuration(3_720_000), "1h2m");
  assert.equal(formatDuration(183_600_000), "2d3h");
});

test("native working message shows elapsed time across retries and resets when settled", async () => {
  const events = new Map();
  const messages = [];
  const ctx = {
    mode: "tui",
    ui: {
      setWorkingMessage(message) { messages.push(message); },
    },
  };
  uiExtension({
    on(name, handler) { events.set(name, handler); },
  });

  assert.deepEqual([...events.keys()], ["session_start", "agent_start", "agent_settled", "session_shutdown"]);
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    await events.get("session_start")({}, ctx);
    assert.equal(messages.at(-1), undefined);
    await events.get("agent_start")({}, ctx);
    assert.equal(messages.at(-1), "Working... (0s)");

    now = 85_900;
    await events.get("agent_start")({}, ctx);
    assert.equal(messages.at(-1), "Working... (1m25s)");

    await events.get("agent_settled")({}, ctx);
    assert.deepEqual(messages.slice(-2), ["Working... (1m25s)", undefined]);

    await events.get("agent_start")({}, { mode: "rpc", ui: ctx.ui });
    assert.equal(messages.at(-1), undefined);
  } finally {
    Date.now = originalNow;
    await events.get("session_shutdown")({}, ctx);
  }
  assert.equal(messages.at(-1), undefined);
});
