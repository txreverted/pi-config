import test from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  renderSubagentsCommandMessage,
  renderParallelScoutsCall,
  renderParallelScoutsResult,
} from "../extensions/subagents-ui.ts";

function makeTheme(mode = "dark") {
  const calls = [];
  const foreground = mode === "dark" ? {
    accent: 36,
    success: 32,
    warning: 33,
    error: 31,
    muted: 90,
    dim: 90,
    toolTitle: 37,
    toolOutput: 90,
    customMessageLabel: 35,
    customMessageText: 37,
  } : {
    accent: 96,
    success: 32,
    warning: 33,
    error: 31,
    muted: 90,
    dim: 90,
    toolTitle: 30,
    toolOutput: 90,
    customMessageLabel: 35,
    customMessageText: 30,
  };
  return {
    calls,
    fg(color, value) {
      calls.push({ method: "fg", color, value });
      return `\x1b[${foreground[color] ?? 39}m${value}\x1b[39m`;
    },
    bg(color, value) {
      calls.push({ method: "bg", color, value });
      return `\x1b[${mode === "dark" ? 45 : 47}m${value}\x1b[49m`;
    },
    bold(value) { return `\x1b[1m${value}\x1b[22m`; },
  };
}

function usage(totalTokens = 12_400, cost = 0.0123) {
  return {
    input: 5_000,
    output: 2_000,
    cacheRead: 5_000,
    cacheWrite: 200,
    cacheWrite1h: 0,
    reasoning: 200,
    totalTokens,
    cost: { input: 0.004, output: 0.005, cacheRead: 0.002, cacheWrite: 0.0013, total: cost },
  };
}

const phaseFixtures = [
  ["queued", "queued-scout", "survey", "low"],
  ["starting", "starting-scout", "trace", "medium"],
  ["running", "running-scout", "audit", "high"],
  ["succeeded", "done-scout", "survey", "low"],
  ["partial", "partial-scout", "trace", "medium"],
  ["failed", "failed-scout", "audit", "high"],
  ["timed_out", "timeout-scout", "trace", "medium"],
  ["aborted", "aborted-scout", "survey", "low"],
];

function scout(phase, name, kind, thinking, index, overrides = {}) {
  return {
    index,
    name,
    kind,
    question: `Inspect the ${name} ownership boundary and report verified evidence.`,
    phase,
    model: "openai-codex/gpt-5.6-sol",
    requestedThinking: thinking,
    thinking,
    serviceTier: "priority",
    turns: 3,
    toolUses: 6,
    durationMs: 18_700,
    usage: usage(),
    ...overrides,
  };
}

function detailFor(fixtures = phaseFixtures) {
  return {
    version: 2,
    total: fixtures.length,
    maxConcurrency: 4,
    elapsedMs: 23_400,
    scouts: fixtures.map((fixture, index) => scout(...fixture, index)),
  };
}

function tasksFor(details) {
  return details.scouts.map(({ name, kind, question }) => ({ name, kind, question }));
}

function renderResult(details, options = {}, theme = makeTheme(), content = "### Findings\n\n- verified evidence") {
  const args = { tasks: tasksFor(details) };
  return renderParallelScoutsResult(
    { content: [{ type: "text", text: content }], details },
    { expanded: false, isPartial: true, ...options },
    theme,
    { args, state: {}, lastComponent: undefined },
  );
}

function plain(component, width) {
  return component.render(width).map(stripTerminalSequences);
}

test("live rows preserve task order and explicit phase symbols at dark and light terminal widths", () => {
  const expected = [
    ["○", "Queued"],
    ["●", "Starting"],
    ["●", "Running"],
    ["✓", "Done"],
    ["!", "Partial"],
    ["✗", "Failed"],
    ["!", "Timed out"],
    ["⊘", "Aborted"],
  ];
  for (const mode of ["dark", "light"]) {
    initTheme(mode);
    const details = detailFor();
    details.scouts.reverse();
    const theme = makeTheme(mode);
    const args = { tasks: tasksFor(detailFor()) };
    const state = {};
    const call = renderParallelScoutsCall(args, theme, { args, state });
    const result = renderParallelScoutsResult(
      { content: [{ type: "text", text: "### Findings\n\n- evidence" }], details },
      { expanded: false, isPartial: true },
      theme,
      { args, state },
    );
    for (const width of [120, 80, 48, 32]) {
      const callLines = plain(call, width);
      const lines = plain(result, width);
      assert.match(callLines.join("\n"), width >= 48
        ? /● Parallel scouts \(8 tasks · 4 concurrent\)/
        : /● Parallel scouts/);
      assert.ok([...call.render(width), ...result.render(width)].every((line) => visibleWidth(line) <= width));
      let offset = -1;
      phaseFixtures.forEach(([, name], index) => {
        const next = lines.findIndex((line, lineIndex) => lineIndex > offset && line.includes(name));
        assert.ok(next > offset, `${mode}/${width}: missing ordered ${name}`);
        assert.match(lines[next], new RegExp(`^${expected[index][0]} `));
        assert.match(lines[next + 1], new RegExp(`└ ${expected[index][1]}`));
        offset = next;
      });
      assert.match(lines.join("\n"), width >= 48
        ? /⎿ 5\/8 done · 2 running · 1 queued/
        : /⎿ 5\/8 done · 2 running/);
    }
    assert.ok(theme.calls.some((call) => call.method === "fg" && call.color === "warning" && call.value === "!"));
    assert.ok(theme.calls.some((call) => call.method === "fg" && call.color === "error" && call.value === "✗"));
    assert.equal(theme.calls.some((call) => call.color === "success" && (call.value === "!" || call.value === "✗")), false);
  }
});

test("components update in place on semantic progress and refresh the shared header", () => {
  initTheme("dark");
  const theme = makeTheme();
  const running = detailFor([
    ["running", "api-scout", "survey", "low"],
    ["queued", "tests-scout", "audit", "high"],
  ]);
  const args = { tasks: tasksFor(running) };
  const state = {};
  const header = renderParallelScoutsCall(args, theme, { args, state });
  const first = renderParallelScoutsResult(
    { content: [{ type: "text", text: "working" }], details: running },
    { expanded: false, isPartial: true },
    theme,
    { args, state },
  );
  assert.match(plain(first, 80).join("\n"), /Running/);

  const complete = structuredClone(running);
  complete.maxConcurrency = 1;
  complete.scouts[0].phase = "succeeded";
  complete.scouts[1].phase = "partial";
  const second = renderParallelScoutsResult(
    { content: [{ type: "text", text: "### api-scout\n\nDone" }], details: complete },
    { expanded: false, isPartial: false },
    theme,
    { args, state, lastComponent: first },
  );
  assert.equal(second, first);
  assert.doesNotMatch(plain(second, 80).join("\n"), /Running/);
  assert.match(plain(second, 80).join("\n"), /1\/2 succeeded · 1 partial/);
  assert.match(plain(header, 80).join("\n"), /2 tasks · 1 concurrent/);

  const sameHeader = renderParallelScoutsCall(args, theme, { args, state, lastComponent: header });
  assert.equal(sameHeader, header);
});

test("completion uses the configured expand binding and omits a disabled binding", () => {
  initTheme("dark");
  const previous = getKeybindings();
  const details = detailFor([
    ["succeeded", "api-scout", "survey", "low"],
    ["partial", "tests-scout", "audit", "high"],
  ]);
  try {
    setKeybindings(new KeybindingsManager({
      "app.tools.expand": { defaultKeys: "alt+e", description: "Toggle tool output" },
    }));
    assert.match(plain(renderResult(details, { isPartial: false }), 120).join("\n"), /alt\+e to expand/);

    setKeybindings(new KeybindingsManager({
      "app.tools.expand": { defaultKeys: [], description: "Toggle tool output" },
    }));
    const disabled = plain(renderResult(details, { isPartial: false }), 120).join("\n");
    assert.doesNotMatch(disabled, /to expand|ctrl\+o|alt\+e/);
  } finally {
    setKeybindings(previous);
  }
});

test("expanded results show full metadata, sanitized errors, and result-content Markdown", () => {
  initTheme("light");
  const details = detailFor([
    ["succeeded", "api-scout", "survey", "low"],
    ["failed", "tests-scout", "audit", "high"],
  ]);
  details.scouts[0].question = "Map the complete application programming interface ownership boundary without shortening this task.";
  details.scouts[0].thinking = "minimal";
  details.scouts[0].turns = 4;
  details.scouts[0].toolUses = 7;
  details.scouts[1].error = "provider failed\u001b]52;c;clipboard-payload\u0007\u202e safely";
  const markdown = "### api-scout findings\n\n- `src/api.ts:12` owns the route.\n\n### tests-scout findings\n\nNo usable output.";
  const component = renderResult(details, { expanded: true, isPartial: false }, makeTheme("light"), markdown);
  const lines = plain(component, 48);
  const rendered = lines.join("\n");
  const logical = rendered.replace(/\s+/g, " ");
  assert.match(logical, /Map the complete application programming interface ownership boundary without shortening this task\./);
  assert.match(logical, /Run: survey · openai-codex\/gpt-5\.6-sol · minimal \(requested low\) thinking · priority tier/);
  assert.match(logical, /Stats: 4 turns · 7 tools · 19s · 12\.4k tok · 5k in · 2k out/);
  assert.match(rendered, /\$0\.0123/);
  assert.match(rendered, /Error: provider failed safely/);
  assert.doesNotMatch(rendered, /clipboard-payload|\u202e/);
  assert.match(rendered, /Findings/);
  assert.match(rendered, /api-scout findings/);
  assert.match(rendered, /src\/api\.ts:12/);
  assert.match(rendered, /tests-scout findings/);
  assert.match(rendered, /23s elapsed/);
  assert.ok(component.render(48).every((line) => visibleWidth(line) <= 48));
});

test("legacy and unstructured restored details fall back without losing output", () => {
  initTheme("dark");
  const theme = makeTheme();
  const args = {
    tasks: [
      { kind: "survey", question: "Map the legacy API ownership boundary." },
      { kind: "trace", question: "Trace legacy error handling behavior." },
    ],
  };
  const legacy = renderParallelScoutsResult(
    {
      content: [{ type: "text", text: "Legacy findings remain visible." }],
      details: {
        elapsedMs: 100,
        results: [
          { kind: "survey", question: args.tasks[0].question, success: true, thinking: "low", usage: usage(10, 0) },
          { kind: "trace", question: args.tasks[1].question, success: false, error: "legacy failure", thinking: "medium", usage: usage(20, 0) },
        ],
      },
    },
    { expanded: false, isPartial: false },
    theme,
    { args, state: {} },
  );
  const legacyText = plain(legacy, 80).join("\n");
  assert.match(legacyText, /✓ survey-scout-1/);
  assert.match(legacyText, /✗ trace-scout-2/);

  const restored = detailFor([
    ["succeeded", "malformed-usage", "survey", "low"],
    ["succeeded", "negative-usage", "survey", "low"],
  ]);
  restored.scouts[0].usage = "unavailable";
  restored.scouts[1].usage = { input: -5, output: -2, totalTokens: -7, cost: { total: -1 } };
  const restoredText = plain(renderResult(restored, { expanded: true, isPartial: false }), 120).join("\n");
  assert.equal((restoredText.match(/0 tok · 0 in · 0 out/g) ?? []).length, 2);
  assert.equal((restoredText.match(/\$0/g) ?? []).length, 2);

  const fallback = renderParallelScoutsResult(
    {
      content: [{ type: "text", text: "Parallel scouts: 1/2 finished.\nRestored progress." }],
      details: { completed: 1, total: 2 },
    },
    { expanded: false, isPartial: true },
    theme,
    { args, state: {} },
  );
  assert.match(plain(fallback, 48).join("\n"), /Parallel scouts: 1\/2 finished\.\nRestored progress\./);
});

test("the r-fast custom message stays compact, expands instructions, and sanitizes display text", () => {
  for (const mode of ["dark", "light"]) {
    initTheme(mode);
    const original = "Speed task:\naudit authentication\n\nUse independent scouts.\nNever expose \u001b]52;c;payload\u0007 private state.";
    const message = { content: original, details: { version: 1, task: "audit authentication\u202e" } };
    const collapsed = renderSubagentsCommandMessage(message, { expanded: false, outputPad: 2 }, makeTheme(mode));
    for (const width of [120, 80, 48, 32]) {
      const lines = plain(collapsed, width);
      assert.equal(lines.length, 1);
      assert.equal(visibleWidth(collapsed.render(width)[0]), width);
      assert.match(lines[0], width >= 48 ? /> \/r-fast audit authentication/ : /> \/r-fast audit/);
      assert.doesNotMatch(lines[0], /Speed task|Generated instructions|\u202e/);
    }

    const expanded = renderSubagentsCommandMessage(message, { expanded: true, outputPad: 1 }, makeTheme(mode));
    const rendered = plain(expanded, 48).join("\n");
    assert.match(rendered, /> \/r-fast audit authentication/);
    assert.match(rendered, /Generated instructions/);
    assert.match(rendered, /Speed task:/);
    assert.match(rendered, /Use independent scouts\./);
    assert.match(rendered, /Never expose  private state\./);
    assert.doesNotMatch(rendered, /payload|\u202e/);
    assert.ok(expanded.render(32).every((line) => visibleWidth(line) <= 32));
    assert.equal(message.content, original, "the display renderer must not alter model-visible context");
  }
});
