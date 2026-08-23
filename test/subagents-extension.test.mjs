import test from "node:test";
import assert from "node:assert/strict";
import { convertToLlm, estimateTokens, initTheme } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
  SCOUT_KIND_CONFIG,
  SCOUT_KINDS,
  SCOUT_PHASES,
  SCOUT_TOOLS,
  TERMINAL_SCOUT_OUTCOMES,
  THINKING_LEVELS,
  SUBAGENT_LIMITS,
  SUBAGENT_TOOL_NAME,
  SCOUT_SYSTEM_PROMPT,
  adaptiveThinkingForKind,
  copyScoutUsage,
  emptyUsage,
  formatScoutResults,
  isScoutPhase,
  isTerminalScoutOutcome,
  normalizeScoutUsage,
  priorityForKind,
  scoutUsageEquals,
  subagentsPrompt,
  thinkingForKind,
  timeoutForKind,
  toolBudgetForKind,
} from "../extensions/subagents-core.ts";
import { PROVIDER_FAST_TIER } from "../extensions/fast-core.ts";
import {
  classifyScoutOutcome,
  constrainScoutModelThinking,
  registerSubagentsExtension,
  resolveScoutRuntimeInputs,
} from "../extensions/subagents.ts";
import { registerFastExtension } from "../extensions/fast.ts";
import { SUBAGENTS_MESSAGE_TYPE } from "../extensions/subagents-ui.ts";

initTheme("dark");

const tasks = [
  { name: "api-scout", kind: "survey", question: "Map the public API and its direct owners." },
  { name: "failure-trace", kind: "trace", question: "Trace failure handling through callers and tests." },
];

function usage(input) {
  return {
    input,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    cacheWrite1h: 1,
    reasoning: 1,
    totalTokens: input + 9,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
  };
}

function result(request, overrides = {}) {
  return {
    ...request,
    outcome: "succeeded",
    output: `${request.kind} findings`,
    durationMs: 10,
    thinking: request.thinking,
    turns: 1,
    toolUses: 2,
    usage: usage(1),
    ...overrides,
  };
}

const defaultRunner = async (request) => result(request);

function setup(runner = defaultRunner, runtimeFactory) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const sent = [];
  const notices = [];
  const entries = [];
  const footers = [];
  const messageRenderers = new Map();
  const baseProvider = {
    id: "openai-codex",
    name: "Codex",
    auth: { apiKey: {} },
    getModels: () => [],
    stream: () => "stream",
    streamSimple: () => "simple",
  };
  let currentProvider = baseProvider;
  let active = ["read", "ask_user_question", SUBAGENT_TOOL_NAME];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerMessageRenderer(name, renderer) { messageRenderers.set(name, renderer); },
    on(name, handler) {
      const existing = events.get(name);
      events.set(name, existing
        ? (...args) => {
          const first = existing(...args);
          return handler(...args) ?? first;
        }
        : handler);
    },
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
    sendMessage(message, options) { sent.push({ message, options }); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  };
  registerSubagentsExtension(pi, runner === null ? undefined : runner, runtimeFactory);
  registerFastExtension(pi);
  const ui = {
    notify(message, level) { notices.push({ message, level }); },
    setFooter(factory) { footers.push(factory); },
  };
  const model = {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    api: "openai-codex-responses",
    reasoning: true,
  };
  const sessionManager = {
    getBranch: () => [...entries],
    getEntries: () => [...entries],
    getCwd: () => "/tmp/project",
    getSessionName: () => undefined,
  };
  const commandContext = {
    isIdle: () => true,
    cwd: "/tmp/project",
    model,
    modelRegistry: {
      isUsingOAuth: () => false,
      getProvider: (providerId) => providerId === currentProvider.id ? currentProvider : undefined,
      registerProvider(provider) { currentProvider = provider; },
    },
    sessionManager,
    thinkingLevel: "low",
    getContextUsage: () => ({ tokens: 0, contextWindow: 200_000, percent: 0 }),
    ui,
  };
  const toolContext = {
    cwd: "/tmp/project",
    model,
    modelRegistry: commandContext.modelRegistry,
    sessionManager,
  };
  return {
    tool: tools.get(SUBAGENT_TOOL_NAME),
    command: commands.get("r-fast"),
    fastCommand: commands.get("fast"),
    events,
    active: () => active,
    sent,
    notices,
    entries,
    footers,
    messageRenderers,
    footer: () => footers.at(-1),
    provider: () => currentProvider,
    baseProvider,
    commandContext,
    toolContext,
    start() {
      events.get("session_start")(
        { type: "session_start", reason: "startup" },
        commandContext,
      );
    },
  };
}

test("subagents are inactive by default and expose an adaptive named-scout schema", async () => {
  const state = setup();
  state.start();
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
  assert.equal(state.tool.executionMode, "sequential");
  assert.equal(state.tool.renderShell, "self");
  assert.equal(typeof state.tool.renderCall, "function");
  assert.equal(typeof state.tool.renderResult, "function");
  assert.equal(typeof state.messageRenderers.get(SUBAGENTS_MESSAGE_TYPE), "function");
  assert.equal(state.tool.promptSnippet, undefined);
  assert.equal(state.tool.promptGuidelines, undefined);
  assert.deepEqual(
    {
      minTasks: SUBAGENT_LIMITS.minTasks,
      maxTasks: SUBAGENT_LIMITS.maxTasks,
      maxConcurrency: SUBAGENT_LIMITS.maxConcurrency,
    },
    { minTasks: 2, maxTasks: 10, maxConcurrency: 4 },
  );
  assert.equal(SUBAGENT_LIMITS.setupTimeoutMs, 15_000);
  assert.equal("toolCalls" in SUBAGENT_LIMITS, false);
  assert.deepEqual(SCOUT_KIND_CONFIG, {
    survey: { thinking: "low", timeoutMs: 45_000, toolCalls: 8, priority: 1 },
    trace: { thinking: "medium", timeoutMs: 90_000, toolCalls: 12, priority: 2 },
    audit: { thinking: "high", timeoutMs: 120_000, toolCalls: 16, priority: 3 },
  });
  assert.match(state.tool.description, /2-10 natural independent read-only investigations/);
  const taskSchema = state.tool.parameters.properties.tasks.items;
  assert.match(taskSchema.properties.kind.description, /survey maps facts and ownership/);
  assert.match(taskSchema.properties.kind.description, /trace follows multi-hop behavior/);
  assert.match(taskSchema.properties.kind.description, /audit evaluates correctness or root cause/);
  assert.match(taskSchema.properties.question.description, /Independent multi-round read-only evidence question/);
  assert.match(SCOUT_SYSTEM_PROMPT, /Avoid credentials, keys, auth\/settings state, sessions, and transcripts/);
  assert.deepEqual(SCOUT_TOOLS, ["read", "grep", "find", "ls"]);
  assert.deepEqual(THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(Value.Check(state.tool.parameters, { tasks }), true);
  assert.equal(Value.Check(state.tool.parameters, { tasks: tasks.slice(0, 1) }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: Array.from({ length: 10 }, (_, index) => ({
    name: `module-${index}`,
    kind: "survey",
    question: `Map the independent ownership boundary for module number ${index}.`,
  })) }), true);
  assert.equal(Value.Check(state.tool.parameters, { tasks: Array.from({ length: 11 }, (_, index) => ({
    name: `module-${index}`,
    kind: "survey",
    question: `Map the independent ownership boundary for module number ${index}.`,
  })) }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [tasks[0], tasks[0]] }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks, model: "fast" }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], question: "short" }, tasks[1]] }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], name: "Bad Name" }, tasks[1]] }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], name: "a" }, tasks[1]] }), true);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], name: "2fa-scout" }, tasks[1]] }), true);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], name: "bad-" }, tasks[1]] }), false);
  assert.equal(Value.Check(state.tool.parameters, { tasks: [{ ...tasks[0], name: "bad--slug" }, tasks[1]] }), false);

  await state.command.handler("", state.commandContext);
  assert.deepEqual(state.notices, [{ message: "Usage: /r-fast <task>", level: "warning" }]);
  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);

  state.commandContext.isIdle = () => false;
  await state.command.handler("inspect a broad task", state.commandContext);
  assert.deepEqual(state.notices.at(-1), {
    message: "Wait for the current task to finish before using /r-fast.",
    level: "warning",
  });
  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
});

test("the command activates one adaptive run without a classifier request", async () => {
  const state = setup();
  state.start();
  await state.command.handler("audit authentication", state.commandContext);
  assert.deepEqual(state.active(), ["read", "ask_user_question", SUBAGENT_TOOL_NAME]);
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0].message.content, /^Speed task:\naudit authentication/);
  assert.match(state.sent[0].message.content, /2-10 natural, independent read-only investigations/);
  assert.match(state.sent[0].message.content, /multiple read\/search rounds/);
  assert.match(state.sent[0].message.content, /parent tool parallelism for one-shot lookups/);
  assert.match(state.sent[0].message.content, /never split work to fill a quota/);
  assert.match(state.sent[0].message.content, /Never delegate overlapping or sequential work, mutations, tests\/builds, shell\/Git\/network, private state, interaction, synthesis, or decisions/);
  assert.deepEqual(state.sent[0].options, { triggerTurn: true });
  const converted = convertToLlm([{
    role: "custom",
    ...state.sent[0].message,
    timestamp: 0,
  }]);
  assert.equal(converted[0].role, "user");
  assert.equal(converted[0].content[0].text, subagentsPrompt("audit authentication"));
  const tokens = estimateTokens({ role: "user", content: [{ type: "text", text: subagentsPrompt("audit authentication") }], timestamp: 0 });
  assert.ok(tokens <= 220, `fast command prompt is ${tokens} estimated tokens`);
});

test("runtime validation rejects duplicate names and normalized questions without consuming delegation", async () => {
  const state = setup();
  state.start();
  await state.command.handler("inspect independent modules", state.commandContext);
  await assert.rejects(
    () => state.tool.execute("names", { tasks: [tasks[0], { ...tasks[1], name: tasks[0].name }] }, undefined, undefined, state.toolContext),
    /names must be unique/,
  );
  await assert.rejects(
    () => state.tool.execute("questions", { tasks: [tasks[0], { ...tasks[1], question: `  ${tasks[0].question.toUpperCase()}  ` }] }, undefined, undefined, state.toolContext),
    /questions must be distinct/,
  );
  const output = await state.tool.execute("valid", { tasks }, undefined, undefined, state.toolContext);
  assert.equal(output.isError, false);
});

test("one exact kind policy controls thinking, deadlines, tool budgets, and priority", () => {
  assert.deepEqual(
    SCOUT_KINDS.map((kind) => [
      thinkingForKind(kind),
      timeoutForKind(kind),
      toolBudgetForKind(kind),
      priorityForKind(kind),
    ]),
    [["low", 45_000, 8, 1], ["medium", 90_000, 12, 2], ["high", 120_000, 16, 3]],
  );
  assert.doesNotMatch(SCOUT_KINDS.map(thinkingForKind).join(" "), /xhigh|max/);

  const expectedByParent = {
    off: ["off", "off", "off"],
    minimal: ["minimal", "minimal", "minimal"],
    low: ["low", "low", "low"],
    medium: ["low", "medium", "medium"],
    high: ["low", "medium", "high"],
    xhigh: ["low", "medium", "high"],
    max: ["low", "medium", "high"],
  };
  for (const [parent, expected] of Object.entries(expectedByParent)) {
    assert.deepEqual(
      SCOUT_KINDS.map((kind) => adaptiveThinkingForKind(kind, parent)),
      expected,
      `parent thinking ${parent}`,
    );
  }

  const exotic = {
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: "medium",
      high: null,
      xhigh: "xhigh",
      max: "max",
    },
  };
  const constrained = constrainScoutModelThinking(exotic, "high");
  assert.equal(constrained.thinking, "medium");
  assert.equal(constrained.model.thinkingLevelMap.xhigh, null);
  assert.equal(constrained.model.thinkingLevelMap.max, null);
  assert.equal(constrainScoutModelThinking({
    ...exotic,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: "xhigh",
    },
  }, "high").thinking, "off");
});

test("one core phase and usage policy rejects malformed data and clamps negative counters", () => {
  assert.deepEqual(SCOUT_PHASES, [
    "queued", "starting", "running", "succeeded", "partial", "failed", "timed_out", "aborted",
  ]);
  for (const phase of SCOUT_PHASES) assert.equal(isScoutPhase(phase), true);
  for (const phase of ["fulfilled", "unknown", undefined]) assert.equal(isScoutPhase(phase), false);

  assert.equal(normalizeScoutUsage(undefined), undefined);
  assert.equal(normalizeScoutUsage([]), undefined);
  const normalized = normalizeScoutUsage({
    input: -1,
    output: 2,
    cacheRead: Number.POSITIVE_INFINITY,
    totalTokens: 3,
    cost: { input: -0.1, total: 0.25 },
  });
  assert.deepEqual(normalized, {
    input: 0,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    reasoning: 0,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
  });
  const copied = copyScoutUsage(normalized);
  assert.notEqual(copied, normalized);
  assert.notEqual(copied.cost, normalized.cost);
  assert.equal(scoutUsageEquals(copied, normalized), true);
  copied.output++;
  assert.equal(scoutUsageEquals(copied, normalized), false);
});

test("terminal stop reasons distinguish complete, partial, failed, timeout, and abort", () => {
  assert.deepEqual(TERMINAL_SCOUT_OUTCOMES, ["succeeded", "partial", "failed", "timed_out", "aborted"]);
  for (const outcome of TERMINAL_SCOUT_OUTCOMES) assert.equal(isTerminalScoutOutcome(outcome), true);
  for (const phase of ["queued", "starting", "running", "fulfilled", undefined]) {
    assert.equal(isTerminalScoutOutcome(phase), false);
  }
  assert.equal(classifyScoutOutcome("stop", "findings", false, false), "succeeded");
  assert.equal(classifyScoutOutcome("length", "partial findings", false, false), "partial");
  assert.equal(classifyScoutOutcome("toolUse", "partial findings", false, false), "partial");
  assert.equal(classifyScoutOutcome("error", "partial text", false, false), "failed");
  assert.equal(classifyScoutOutcome("stop", "", false, false), "failed");
  assert.equal(classifyScoutOutcome("aborted", "partial text", false, false), "aborted");
  assert.equal(classifyScoutOutcome("aborted", "partial text", true, false), "timed_out");
  assert.equal(classifyScoutOutcome("stop", "findings", true, false), "timed_out");
  assert.equal(classifyScoutOutcome("stop", "findings", false, true), "aborted");
  assert.equal(classifyScoutOutcome("stop", "findings", true, true), "aborted");
});

test("scout runtime inputs preserve runtime auth and the effective provider in memory", async () => {
  const effectiveProvider = {
    id: "configured-provider",
    name: "Configured provider",
    auth: { oauth: { name: "Runtime OAuth" } },
    getModels: () => [],
    stream() {},
    streamSimple() {},
  };
  const registry = {
    async getApiKeyAndHeaders() {
      return {
        ok: true,
        apiKey: "runtime-only-key",
        baseUrl: "https://runtime.example/v1",
        headers: { "x-runtime": "header" },
        env: { ACCOUNT_ID: "runtime-account" },
      };
    },
    getProvider: (id) => id === "configured-provider" ? effectiveProvider : undefined,
  };
  const model = {
    provider: "configured-provider",
    baseUrl: "https://stored.example/v1",
    headers: { "x-stored": "header" },
  };

  const inputs = await resolveScoutRuntimeInputs(registry, model);
  assert.deepEqual(inputs.credential, {
    type: "api_key",
    key: "runtime-only-key",
    env: { ACCOUNT_ID: "runtime-account" },
  });
  assert.equal(inputs.provider.id, "configured-provider");
  assert.equal(inputs.provider.stream, effectiveProvider.stream);
  assert.equal(inputs.provider.streamSimple, effectiveProvider.streamSimple);
  assert.equal(inputs.provider.auth.oauth, effectiveProvider.auth.oauth);
  const resolved = await inputs.provider.auth.apiKey.resolve({
    ctx: { env: async () => undefined, fileExists: async () => false },
    credential: inputs.credential,
    signal: new AbortController().signal,
  });
  assert.deepEqual(resolved, {
    auth: {
      apiKey: "runtime-only-key",
      baseUrl: "https://runtime.example/v1",
      headers: { "x-runtime": "header" },
    },
    env: { ACCOUNT_ID: "runtime-account" },
    source: "parent session",
  });
  assert.equal(inputs.model.baseUrl, "https://runtime.example/v1");
  assert.deepEqual(inputs.model.headers, { "x-stored": "header", "x-runtime": "header" });
});

test("scouts start together, retain input order, and report structured progress and nested usage", async () => {
  const started = [];
  const releases = [];
  const runner = (request) => new Promise((resolve) => {
    started.push(request);
    releases.push(() => resolve(result(request, {
      output: request.kind === "survey" ? "first output" : "second output",
      usage: usage(request.kind === "survey" ? 5 : 7),
    })));
  });
  const state = setup(runner);
  state.start();
  await state.fastCommand.handler("", state.commandContext);
  await state.command.handler("inspect two independent systems", state.commandContext);
  const updates = [];
  const execution = state.tool.execute("call", { tasks }, undefined, (update) => updates.push(update), state.toolContext);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, SUBAGENT_LIMITS.minTasks);
  assert.deepEqual(started.map(({ name }) => name), ["failure-trace", "api-scout"]);
  assert.deepEqual(started.map(({ thinking, timeoutMs }) => [thinking, timeoutMs]), [["medium", 90_000], ["low", 45_000]]);
  assert.deepEqual(started.map(({ model }) => model), ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-sol"]);
  assert.deepEqual(started.map(({ serviceTier }) => serviceTier), [PROVIDER_FAST_TIER, PROVIDER_FAST_TIER]);
  releases[1]();
  releases[0]();
  const output = await execution;

  assert.ok(output.content[0].text.indexOf("first output") < output.content[0].text.indexOf("second output"));
  assert.match(output.content[0].text, /Parallel scouts: 2 succeeded, 0 partial, 0 failed/);
  assert.equal(output.usage.input, 12);
  assert.equal(output.usage.cost.total, 2);
  assert.equal(output.details.maxConcurrency, 2);
  assert.equal(updates[0].details.version, 2);
  assert.equal(updates.some((update) => update.details.scouts.some((entry) => entry.phase === "starting")), true);
  assert.equal(output.details.scouts.every((entry) => !("output" in entry)), true);
  assert.deepEqual(output.details.scouts.map(({ serviceTier }) => serviceTier), [PROVIDER_FAST_TIER, PROVIDER_FAST_TIER]);
  assert.deepEqual(output.details.scouts.map(({ phase }) => phase), ["succeeded", "succeeded"]);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
  await assert.rejects(
    () => state.tool.execute("again", { tasks }, undefined, undefined, state.toolContext),
    /only during \/r-fast/,
  );
});

test("runtime setup failure is sanitized, structured, and marks the batch erroneous", async () => {
  const setupCalls = [];
  const state = setup(null, async (...args) => {
    setupCalls.push(args);
    throw new Error("authentication rejected sk-super-secret-provider-token");
  });
  state.start();
  await state.command.handler("inspect two independent systems", state.commandContext);
  const controller = new AbortController();
  const output = await state.tool.execute("setup", { tasks }, controller.signal, undefined, state.toolContext);
  assert.equal(setupCalls.length, 1);
  assert.equal(setupCalls[0][0], state.commandContext.modelRegistry);
  assert.equal(setupCalls[0][1], state.commandContext.model);
  assert.equal(setupCalls[0][2], state.toolContext.cwd);
  assert.equal(setupCalls[0][3], controller.signal);
  assert.equal(output.isError, true);
  assert.deepEqual(output.details.scouts.map((entry) => entry.phase), ["failed", "failed"]);
  assert.match(output.content[0].text, /authentication rejected/);
  assert.doesNotMatch(output.content[0].text, /super-secret-provider-token/);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
});

test("runner exceptions and rejected pool items share sanitized terminal results", async () => {
  const state = setup(async (request) => {
    if (request.kind === "survey") throw new Error("isolated failure sk-private-provider-token");
    return undefined;
  });
  state.start();
  await state.command.handler("inspect two independent systems", state.commandContext);
  const output = await state.tool.execute("terminal-failures", { tasks }, undefined, undefined, state.toolContext);

  assert.equal(output.isError, true);
  assert.deepEqual(output.details.scouts.map(({ phase }) => phase), ["failed", "failed"]);
  assert.match(output.details.scouts[0].error, /isolated failure/);
  assert.doesNotMatch(output.content[0].text, /private-provider-token/);
  assert.equal(output.details.scouts.every(({ error }) => typeof error === "string" && error.length > 0), true);
});

test("progress emits only semantic changes, never regresses, and stays immutable after terminal state", async () => {
  const callbacks = [];
  const state = setup(async (request, progress) => {
    callbacks.push(progress);
    const started = { phase: "starting", turns: 0, toolUses: 0, durationMs: 0, usage: emptyUsage() };
    const running = { phase: "running", turns: 0, toolUses: 1, durationMs: 10, usage: usage(2) };
    const advanced = { phase: "running", turns: 1, toolUses: 1, durationMs: 12, usage: usage(3) };
    progress?.(started);
    progress?.(started);
    progress?.(running);
    progress?.(running);
    progress?.({ ...running, durationMs: 3 });
    progress?.(advanced);
    progress?.(advanced);
    return result(request, {
      durationMs: 7,
      turns: 1,
      toolUses: 1,
      usage: usage(3),
    });
  });
  state.start();
  await state.command.handler("inspect two independent systems", state.commandContext);
  const updates = [];
  let earlier;
  let earlierCopy;
  const output = await state.tool.execute(
    "semantic-progress",
    { tasks },
    undefined,
    (update) => {
      updates.push(update);
      if (!earlier && update.details.scouts.some(({ phase }) => phase === "running")) {
        earlier = update.details;
        earlierCopy = structuredClone(earlier);
      }
    },
    state.toolContext,
  );

  assert.equal(updates.length, 9);
  const semanticSignatures = updates.map((update) => JSON.stringify(update.details.scouts));
  assert.equal(new Set(semanticSignatures).size, semanticSignatures.length);
  for (let scout = 0; scout < tasks.length; scout++) {
    let starts = 0;
    let previousPhase;
    let previousDuration = 0;
    for (const update of updates) {
      const current = update.details.scouts[scout];
      if (current.phase === "starting" && previousPhase !== "starting") starts++;
      assert.ok(current.durationMs >= previousDuration);
      previousPhase = current.phase;
      previousDuration = current.durationMs;
    }
    assert.equal(starts, 1);
  }
  assert.deepEqual(output.details.scouts.map(({ durationMs }) => durationMs), [12, 12]);

  assert.deepEqual(earlier, earlierCopy);
  const terminal = structuredClone(output.details);
  const updateCount = updates.length;
  for (const callback of callbacks) callback?.({ phase: "running", toolUses: 999, durationMs: 999_999, usage: usage(999) });
  assert.equal(updates.length, updateCount);
  assert.deepEqual(earlier, earlierCopy);
  assert.deepEqual(output.details, terminal);
});

test("ten scouts run through four slots, refill immediately, and keep immutable ordered details", async () => {
  const adaptiveTasks = Array.from({ length: 10 }, (_, index) => ({
    name: `module-${index}-scout`,
    kind: index % 3 === 0 ? "audit" : index % 2 === 0 ? "trace" : "survey",
    question: `Inspect independent module number ${index} through multiple evidence rounds.`,
  }));
  const releases = new Map();
  const started = [];
  let active = 0;
  let maximum = 0;
  const runner = (request) => new Promise((resolve) => {
    started.push(request.name);
    active++;
    maximum = Math.max(maximum, active);
    releases.set(request.name, () => {
      active--;
      resolve(result(request, { output: `${request.name} findings` }));
    });
  });
  const state = setup(runner);
  state.start();
  await state.command.handler("inspect ten independent modules", state.commandContext);
  const updates = [];
  const execution = state.tool.execute("adaptive", { tasks: adaptiveTasks }, undefined, (update) => updates.push(update), state.toolContext);
  await new Promise((resolve) => setImmediate(resolve));
  const expectedStartOrder = [0, 3, 6, 9, 2, 4, 8, 1, 5, 7]
    .map((index) => adaptiveTasks[index].name);
  assert.deepEqual(started, expectedStartOrder.slice(0, 4));
  const earlierDetails = updates.at(-1).details;
  const captured = structuredClone(earlierDetails);

  for (let index = 0; index < expectedStartOrder.length - 4; index++) {
    releases.get(expectedStartOrder[index])();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, expectedStartOrder.slice(0, 5 + index));
  }
  for (const name of expectedStartOrder.slice(-4).reverse()) releases.get(name)();
  const output = await execution;
  assert.equal(maximum, SUBAGENT_LIMITS.maxConcurrency);
  assert.deepEqual(output.details.scouts.map((entry) => entry.name), adaptiveTasks.map((task) => task.name));
  assert.deepEqual(earlierDetails, captured);
  assert.equal(output.details.scouts.every((entry) => entry.phase === "succeeded"), true);
  for (const task of adaptiveTasks) assert.match(output.content[0].text, new RegExp(`### ${task.name}`));
});

test("the tool never raises thinking above the parent setting", async () => {
  const started = [];
  const state = setup(async (request) => {
    started.push(request);
    return result(request);
  });
  state.start();
  await state.command.handler("inspect two complex independent systems", state.commandContext);
  await state.tool.execute(
    "call",
    { tasks: [
      { name: "first-trace", kind: "trace", question: "Trace the first independent behavior through callers." },
      { name: "second-audit", kind: "audit", question: "Audit the second independent behavior for root causes." },
    ] },
    undefined,
    undefined,
    { ...state.toolContext, thinkingLevel: "low" },
  );
  assert.deepEqual(started.map(({ thinking }) => thinking), ["low", "low"]);
});

test("partial failures and oversized unsafe output stay bounded and visible", async () => {
  const manyLines = Array.from({ length: 300 }, (_, index) => `line ${index} 😀 ${"x".repeat(80)}`).join("\n");
  const runner = async (request) => request.kind === "survey"
    ? result(request, { output: `\u001b]0;unsafe\u0007${manyLines}` })
    : result(request, { outcome: "failed", output: "", error: "trace failed\u202e" });
  const state = setup(runner);
  state.start();
  await state.command.handler("inspect two independent systems", state.commandContext);
  const output = await state.tool.execute("call", { tasks }, undefined, undefined, state.toolContext);
  const text = output.content[0].text;

  assert.match(text, /Parallel scouts: 1 succeeded, 0 partial, 1 failed/);
  assert.match(text, /Scout output truncated by pi-config/);
  assert.match(text, /trace failed/);
  assert.doesNotMatch(text, /[\u001b\u0007\u202e]/);
  assert.ok(Buffer.byteLength(text, "utf8") <= SUBAGENT_LIMITS.aggregateOutputBytes);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
});

test("ten Unicode findings share the aggregate byte and line budget fairly", () => {
  const oversized = Array.from({ length: 260 }, (_, index) => `line ${index} 😀 ${"界".repeat(90)}`).join("\n");
  const results = Array.from({ length: 10 }, (_, index) => ({
    name: `module-${index}-scout`,
    kind: "survey",
    question: `Inspect independent module number ${index} through multiple evidence rounds.`,
    cwd: "/tmp/project",
    model: "faux/model",
    thinking: "low",
    timeoutMs: 45_000,
    outcome: "succeeded",
    output: oversized,
    durationMs: 10,
    turns: 1,
    toolUses: 2,
    usage: emptyUsage(),
  }));
  const text = formatScoutResults(results);
  for (const item of results) assert.match(text, new RegExp(`### ${item.name}`));
  assert.match(text, /Scout output truncated by pi-config/);
  assert.ok(Buffer.byteLength(text, "utf8") <= SUBAGENT_LIMITS.aggregateOutputBytes);
  assert.ok(text.split("\n").length <= SUBAGENT_LIMITS.aggregateOutputLines);
});

test("abort reaches running scouts, retains structured outcomes, and cleans up the speed tool", async () => {
  let aborts = 0;
  const runner = (request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => {
      aborts++;
      reject(new Error("aborted"));
    }, { once: true });
  });
  const state = setup(runner);
  const abortTasks = Array.from({ length: 6 }, (_, index) => ({
    name: `abort-${index}`,
    kind: "survey",
    question: `Inspect independent abort boundary number ${index} through multiple evidence rounds.`,
  }));
  state.start();
  await state.command.handler("inspect six independent systems", state.commandContext);
  const controller = new AbortController();
  const execution = state.tool.execute("call", { tasks: abortTasks }, controller.signal, undefined, state.toolContext);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const output = await execution;
  assert.equal(aborts, SUBAGENT_LIMITS.maxConcurrency);
  assert.equal(output.isError, true);
  assert.deepEqual(output.details.scouts.map((entry) => entry.phase), abortTasks.map(() => "aborted"));
  assert.match(output.content[0].text, /0 failed, 0 timed out, 6 aborted/);
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
});

test("unused subagent mode stays active through low-level runs and cleans up when settled", async () => {
  const state = setup();
  state.start();
  await state.command.handler("small direct task", state.commandContext);
  assert.equal(state.events.has("agent_end"), false);
  assert.equal(state.active().includes(SUBAGENT_TOOL_NAME), true);
  state.events.get("agent_settled")();
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);

  await state.command.handler("another direct task", state.commandContext);
  assert.equal(state.active().includes(SUBAGENT_TOOL_NAME), true);
  state.events.get("agent_settled")();
  assert.deepEqual(state.active(), ["read", "ask_user_question"]);
  assert.deepEqual(emptyUsage().cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
});
