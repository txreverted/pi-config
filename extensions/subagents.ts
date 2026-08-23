import type {
  ApiKeyCredential,
  Model,
  ModelThinkingLevel,
  Provider,
  Usage,
} from "@earendil-works/pi-ai";
import { clampThinkingLevel, InMemoryCredentialStore, StringEnum } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  SUBAGENT_LIMITS,
  SUBAGENT_TOOL_NAME,
  SCOUT_KINDS,
  SCOUT_SYSTEM_PROMPT,
  SCOUT_TOOLS,
  THINKING_LEVELS,
  adaptiveThinkingForKind,
  addUsage,
  copyScoutUsage,
  emptyUsage,
  formatScoutResults,
  isTerminalScoutOutcome,
  isUsableOutcome,
  normalizeScoutUsage,
  priorityForKind,
  scoutUsageEquals,
  subagentsPrompt,
  sumUsage,
  timeoutForKind,
  type ScoutKind,
  type ScoutOutcome,
  type ScoutPhase,
  type ScoutRunner,
  type ScoutRunnerProgress,
  type ScoutRunRequest,
  type ScoutRunResult,
} from "./subagents-core.ts";
import {
  PROVIDER_FAST_TIER,
  isProviderFastEnabled,
  registerProviderFastHook,
  supportsProviderFastMode,
} from "./fast-core.ts";
import {
  createScoutGuardExtension,
  resolveRepositoryRoot,
  sanitizeScoutError,
} from "./subagents-guard.ts";
import { runOrderedPool } from "./subagents-pool.ts";
import {
  SUBAGENTS_MESSAGE_TYPE,
  renderSubagentsCommandMessage,
  renderParallelScoutsCall,
  renderParallelScoutsResult,
} from "./subagents-ui.ts";
import { safeDisplayText } from "./text-safety.ts";

const ScoutTaskSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: SUBAGENT_LIMITS.nameCharacters,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "Unique short lowercase scout name",
  }),
  kind: StringEnum(SCOUT_KINDS, {
    description: "survey maps facts and ownership; trace follows multi-hop behavior; audit evaluates correctness or root cause",
  }),
  question: Type.String({
    minLength: 20,
    maxLength: SUBAGENT_LIMITS.taskCharacters,
    description: "Independent multi-round read-only evidence question matching the selected kind",
  }),
}, { additionalProperties: false });

const ParallelScoutSchema = Type.Object({
  tasks: Type.Array(ScoutTaskSchema, {
    minItems: SUBAGENT_LIMITS.minTasks,
    maxItems: SUBAGENT_LIMITS.maxTasks,
    uniqueItems: true,
    description: "Two to ten natural non-overlapping investigations that can run concurrently",
  }),
}, { additionalProperties: false });

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export { SCOUT_TOOLS };

export async function resolveScoutRuntimeInputs(
  registry: ExtensionContext["modelRegistry"],
  model: Model<any>,
) {
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`Scout authentication failed: ${auth.error}`);
  const effectiveProvider = registry.getProvider(model.provider);
  if (!effectiveProvider) throw new Error(`Scout provider is unavailable: ${model.provider}`);

  const credential: ApiKeyCredential = { type: "api_key", key: auth.apiKey, env: auth.env };
  const provider: Provider = {
    ...effectiveProvider,
    auth: {
      ...effectiveProvider.auth,
      apiKey: {
        name: "Parent session authentication",
        check: async ({ credential: current }) => current
          ? { type: "api_key", source: "parent session" }
          : undefined,
        resolve: async ({ credential: current }) => current
          ? {
            auth: {
              apiKey: auth.apiKey ?? current.key,
              headers: auth.headers,
              baseUrl: auth.baseUrl,
            },
            env: current.env || auth.env ? { ...current.env, ...auth.env } : undefined,
            source: "parent session",
          }
          : undefined,
      },
    },
  };
  const headers = { ...model.headers, ...auth.headers } as Model<any>["headers"];
  return {
    credential,
    provider,
    model: {
      ...model,
      ...(auth.baseUrl ? { baseUrl: auth.baseUrl } : {}),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
  };
}

export async function createScoutRuntime(
  registry: ExtensionContext["modelRegistry"],
  model: Model<any>,
  signal: AbortSignal | undefined,
) {
  const inputs = await resolveScoutRuntimeInputs(registry, model);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(model.provider, async () => inputs.credential, signal ? { signal } : undefined);
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, signal });
  runtime.registerNativeProvider(inputs.provider);
  return { model: inputs.model, runtime };
}

export interface ScoutBatchSetup {
  model: Model<any>;
  runtime: ModelRuntime;
  repositoryRoot: string;
}

export async function createScoutBatchSetup(
  registry: ExtensionContext["modelRegistry"],
  model: Model<any>,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ScoutBatchSetup> {
  const [scout, repositoryRoot] = await Promise.all([
    createScoutRuntime(registry, model, signal),
    resolveRepositoryRoot(cwd),
  ]);
  return { ...scout, repositoryRoot };
}

export async function createScoutBatchSetupWithDeadline(
  registry: ExtensionContext["modelRegistry"],
  model: Model<any>,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ScoutBatchSetup> {
  if (signal?.aborted) throw new Error("Scout runtime setup aborted.");
  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort();
  signal?.addEventListener("abort", parentAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SUBAGENT_LIMITS.setupTimeoutMs);
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new Error(
          timedOut
            ? `Scout runtime setup timed out after ${SUBAGENT_LIMITS.setupTimeoutMs / 1_000} seconds.`
            : "Scout runtime setup aborted.",
        ));
      }, { once: true });
    });
    const operation = createScoutBatchSetup(registry, model, cwd, controller.signal);
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", parentAbort);
  }
}

export type ScoutBatchSetupFactory = (
  registry: ExtensionContext["modelRegistry"],
  model: Model<any>,
  cwd: string,
  signal: AbortSignal | undefined,
) => Promise<ScoutBatchSetup>;

/** Keep Pi's model-specific clamp at or below the requested level and never above high. */
export function constrainScoutModelThinking(
  model: Model<any>,
  requested: ModelThinkingLevel,
): { model: Model<any>; thinking: ModelThinkingLevel } {
  const requestedIndex = Math.max(0, THINKING_LEVELS.indexOf(requested));
  const capIndex = Math.min(requestedIndex, THINKING_LEVELS.indexOf("high"));
  const thinkingLevelMap = { ...model.thinkingLevelMap };
  for (let index = capIndex + 1; index < THINKING_LEVELS.length; index++) {
    thinkingLevelMap[THINKING_LEVELS[index]] = null;
  }
  const constrained = { ...model, thinkingLevelMap };
  return { model: constrained, thinking: clampThinkingLevel(constrained, THINKING_LEVELS[capIndex]) };
}

export function classifyScoutOutcome(
  stopReason: string,
  output: string,
  timedOut: boolean,
  parentAborted: boolean,
): ScoutOutcome {
  if (parentAborted) return "aborted";
  if (timedOut) return "timed_out";
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "stop" && output.length > 0) return "succeeded";
  if (output.length > 0 && stopReason !== "error") return "partial";
  return "failed";
}

export async function runScoutSession(
  request: ScoutRunRequest,
  model: Model<any>,
  modelRuntime: ModelRuntime,
  onProgress?: (progress: ScoutRunnerProgress) => void,
  repositoryRoot?: string,
): Promise<ScoutRunResult> {
  const started = Date.now();
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let unsubscribe: (() => void) | undefined;
  let terminal = false;
  let timedOut = false;
  let parentAborted = request.signal?.aborted ?? false;
  let cancellation: "parent" | "timeout" | undefined = parentAborted ? "parent" : undefined;
  let turns = 0;
  let toolUses = 0;
  let liveUsage = emptyUsage();
  let actualModel = request.model;
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    images: { blockImages: true },
    retry: {
      enabled: false,
      provider: { timeoutMs: request.timeoutMs, maxRetries: 0, maxRetryDelayMs: 10_000 },
    },
  });
  const loader = new DefaultResourceLoader({
    cwd: request.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: SCOUT_SYSTEM_PROMPT,
    extensionFactories: [
      createScoutGuardExtension({ cwd: request.cwd, kind: request.kind, repositoryRoot }),
      ...(request.serviceTier === PROVIDER_FAST_TIER ? [{
          name: "provider-fast-tier",
          hidden: true,
          factory: (childPi: ExtensionAPI) => registerProviderFastHook(childPi, () => true),
        }] : []),
    ],
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortSession = () => { void session?.abort().catch(() => undefined); };
  const parentAbort = () => {
    if (terminal || cancellation) return;
    cancellation = "parent";
    parentAborted = true;
    if (timeout) clearTimeout(timeout);
    abortSession();
  };
  timeout = setTimeout(() => {
    if (terminal || cancellation) return;
    cancellation = "timeout";
    timedOut = true;
    abortSession();
  }, request.timeoutMs);
  request.signal?.addEventListener("abort", parentAbort, { once: true });

  try {
    onProgress?.({ phase: "starting", turns, toolUses, durationMs: 0, usage: liveUsage });
    if (parentAborted) throw new Error("Scout aborted.");
    await loader.reload();
    const constrained = constrainScoutModelThinking(model, request.thinking);
    ({ session } = await createAgentSession({
      cwd: request.cwd,
      modelRuntime,
      model: constrained.model,
      thinkingLevel: constrained.thinking,
      tools: [...SCOUT_TOOLS],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(request.cwd),
      settingsManager,
    }));
    const emitProgress = () => {
      if (terminal || !session) return;
      onProgress?.({
        phase: "running",
        model: actualModel,
        thinking: session.thinkingLevel as ModelThinkingLevel,
        turns,
        toolUses,
        durationMs: Date.now() - started,
        usage: liveUsage,
      });
    };
    unsubscribe = session.subscribe((event) => {
      if (terminal) return;
      if (event.type === "turn_start") {
        turns++;
        emitProgress();
      } else if (event.type === "tool_execution_start") {
        toolUses++;
        emitProgress();
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        actualModel = `${event.message.provider}/${event.message.responseModel ?? event.message.model}`;
        const next = normalizeScoutUsage(event.message.usage);
        if (next) liveUsage = addUsage(liveUsage, next);
        emitProgress();
      }
    });
    emitProgress();
    if (timedOut || parentAborted) {
      await session.abort();
    } else {
      await session.prompt(`Task: ${request.question}`);
    }

    const messages = session.messages.filter((message) => message.role === "assistant");
    const last = messages.at(-1) as unknown;
    const output = assistantText(last);
    const stopReason = last && typeof last === "object" && typeof (last as { stopReason?: unknown }).stopReason === "string"
      ? (last as { stopReason: string }).stopReason
      : "";
    const errorMessage = last && typeof last === "object" && typeof (last as { errorMessage?: unknown }).errorMessage === "string"
      ? (last as { errorMessage: string }).errorMessage
      : "";
    const usage = messages.reduce((total, message) => {
      const next = normalizeScoutUsage((message as unknown as { usage?: unknown }).usage);
      return next ? addUsage(total, next) : total;
    }, emptyUsage());
    const outcome = classifyScoutOutcome(stopReason, output, timedOut, parentAborted);
    const error = parentAborted
      ? "Scout aborted."
      : timedOut
        ? `Timed out after ${request.timeoutMs / 1_000} seconds.`
        : errorMessage || (outcome === "partial"
          ? `Scout stopped before a normal completion (${stopReason || "unknown"}).`
          : output ? `Scout stopped: ${stopReason || "unknown"}.` : "Scout returned no findings.");
    terminal = true;
    return {
      ...request,
      model: actualModel,
      outcome,
      output: safeDisplayText(output),
      error: outcome === "succeeded" ? undefined : sanitizeScoutError(error),
      durationMs: Date.now() - started,
      thinking: session.thinkingLevel as ModelThinkingLevel,
      turns,
      toolUses,
      usage,
    };
  } catch (error) {
    const message = parentAborted
      ? "Scout aborted."
      : timedOut
        ? `Timed out after ${request.timeoutMs / 1_000} seconds.`
        : error instanceof Error ? error.message : String(error);
    terminal = true;
    return {
      ...request,
      model: actualModel,
      outcome: parentAborted ? "aborted" : timedOut ? "timed_out" : "failed",
      output: "",
      error: sanitizeScoutError(message),
      durationMs: Date.now() - started,
      thinking: session ? session.thinkingLevel as ModelThinkingLevel : request.thinking,
      turns,
      toolUses,
      usage: liveUsage,
    };
  } finally {
    terminal = true;
    if (timeout) clearTimeout(timeout);
    request.signal?.removeEventListener("abort", parentAbort);
    unsubscribe?.();
    session?.dispose();
  }
}

interface ScoutExecutionState {
  index: number;
  name: string;
  kind: ScoutKind;
  question: string;
  phase: ScoutPhase;
  model: string;
  requestedThinking: ModelThinkingLevel;
  thinking: ModelThinkingLevel;
  serviceTier?: typeof PROVIDER_FAST_TIER;
  turns: number;
  toolUses: number;
  durationMs: number;
  usage: Usage;
  error?: string;
}

function terminalScoutResult(
  request: ScoutRunRequest,
  state: ScoutExecutionState,
  outcome: ScoutOutcome,
  error: unknown,
  durationMs = state.durationMs,
): ScoutRunResult {
  const message = sanitizeScoutError(error);
  state.phase = outcome;
  state.error = message;
  state.durationMs = Math.max(state.durationMs, durationMs);
  return {
    ...request,
    outcome,
    output: "",
    error: message,
    durationMs: state.durationMs,
    thinking: state.thinking,
    turns: state.turns,
    toolUses: state.toolUses,
    usage: copyScoutUsage(state.usage),
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  runner?: ScoutRunner,
  batchSetupFactory: ScoutBatchSetupFactory = createScoutBatchSetupWithDeadline,
): void {
  let subagentsActive = false;
  let delegationUsed = false;

  const deactivate = () => {
    const active = pi.getActiveTools();
    if (active.includes(SUBAGENT_TOOL_NAME)) {
      pi.setActiveTools(active.filter((name) => name !== SUBAGENT_TOOL_NAME));
    }
    subagentsActive = false;
    delegationUsed = false;
  };

  pi.registerMessageRenderer(SUBAGENTS_MESSAGE_TYPE, renderSubagentsCommandMessage);

  pi.registerTool({
    name: SUBAGENT_TOOL_NAME,
    label: "parallel scouts",
    description: "Run 2-10 natural independent read-only investigations during /r-fast, with at most four active. Delegate only when each task needs multiple searches and parallel work should shorten the critical path. Never fill a quota or delegate one-shot, overlapping, sequential, mutating, test/build, shell/Git/network, private-state, interactive, synthesis, or decision work. Name tasks by module or ownership boundary. Thinking targets survey low, trace medium, and audit high without exceeding the parent.",
    parameters: ParallelScoutSchema,
    executionMode: "sequential",
    renderShell: "self",
    renderCall: renderParallelScoutsCall,
    renderResult: renderParallelScoutsResult,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!subagentsActive) throw new Error(`${SUBAGENT_TOOL_NAME} is available only during /r-fast.`);
      if (delegationUsed) throw new Error(`${SUBAGENT_TOOL_NAME} can run only once per /r-fast task.`);
      if (!ctx.model) throw new Error("No active model is available for scouts.");
      if (params.tasks.length < SUBAGENT_LIMITS.minTasks || params.tasks.length > SUBAGENT_LIMITS.maxTasks) {
        throw new Error(`${SUBAGENT_TOOL_NAME} requires ${SUBAGENT_LIMITS.minTasks}-${SUBAGENT_LIMITS.maxTasks} tasks.`);
      }
      const names = params.tasks.map((task) => task.name);
      const questions = params.tasks.map((task) => task.question.trim().replace(/\s+/g, " ").toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Scout names must be unique.");
      if (new Set(questions).size !== questions.length) throw new Error("Scout questions must be distinct.");
      delegationUsed = true;

      try {
        const parentModel = ctx.model as Model<any>;
        const model = `${parentModel.provider}/${parentModel.id}`;
        const providerFast = isProviderFastEnabled(ctx.sessionManager.getBranch());
        const serviceTier = providerFast && supportsProviderFastMode(parentModel) ? PROVIDER_FAST_TIER : undefined;
        const started = Date.now();
        const concurrency = Math.min(SUBAGENT_LIMITS.maxConcurrency, params.tasks.length);
        const requests = params.tasks.map((task): ScoutRunRequest => {
          const kind = task.kind as ScoutKind;
          const thinking = adaptiveThinkingForKind(kind, ctx.thinkingLevel);
          return {
            name: task.name,
            kind,
            question: task.question,
            cwd: ctx.cwd,
            model,
            thinking,
            serviceTier,
            timeoutMs: timeoutForKind(kind),
            signal,
          };
        });
        const states: ScoutExecutionState[] = requests.map((request, index) => ({
          index,
          name: request.name,
          kind: request.kind,
          question: request.question,
          phase: "queued",
          model: request.model,
          requestedThinking: request.thinking,
          thinking: request.thinking,
          serviceTier: request.serviceTier,
          turns: 0,
          toolUses: 0,
          durationMs: 0,
          usage: emptyUsage(),
        }));

        const details = () => ({
          version: 2 as const,
          total: states.length,
          maxConcurrency: concurrency,
          elapsedMs: Date.now() - started,
          scouts: states.map((state) => ({
            ...state,
            usage: copyScoutUsage(state.usage),
          })),
        });
        const emit = () => {
          const settled = states.filter((state) => isTerminalScoutOutcome(state.phase)).length;
          onUpdate?.({
            content: [{ type: "text", text: `Parallel scouts: ${settled}/${states.length} settled.` }],
            details: details(),
          });
        };
        emit();

        let scout: ScoutBatchSetup | undefined;
        try {
          scout = runner ? undefined : await batchSetupFactory(ctx.modelRegistry, parentModel, ctx.cwd, signal);
        } catch (error) {
          const aborted = signal?.aborted === true;
          const message = aborted ? "Scout runtime setup aborted." : error;
          const results = requests.map((request, index) => terminalScoutResult(
            request,
            states[index],
            aborted ? "aborted" : "failed",
            message,
            Date.now() - started,
          ));
          emit();
          return {
            content: [{ type: "text", text: formatScoutResults(results) }],
            details: details(),
            isError: true,
            usage: emptyUsage(),
          };
        }

        const activeRunner: ScoutRunner = runner
          ?? ((request, progress) => runScoutSession(
            request,
            scout!.model,
            scout!.runtime,
            progress,
            scout!.repositoryRoot,
          ));
        const forcedResults: Array<ScoutRunResult | undefined> = requests.map(() => undefined);
        const outcomes = await runOrderedPool(
          params.tasks,
          async (_task, index) => {
            const state = states[index];
            const request = requests[index];
            state.phase = "starting";
            state.durationMs = 0;
            emit();
            let result: ScoutRunResult;
            try {
              result = await activeRunner(request, (progress) => {
                if (isTerminalScoutOutcome(state.phase)) return;
                const proposedPhase = progress.phase ?? "running";
                const nextPhase = state.phase === "running" && proposedPhase === "starting"
                  ? "running"
                  : proposedPhase;
                const nextModel = progress.model ?? state.model;
                const nextThinking = progress.thinking ?? state.thinking;
                const nextTurns = progress.turns ?? state.turns;
                const nextToolUses = progress.toolUses ?? state.toolUses;
                const nextDuration = Math.max(state.durationMs, progress.durationMs ?? state.durationMs);
                const nextUsage = progress.usage ?? state.usage;
                const changed = nextPhase !== state.phase
                  || nextModel !== state.model
                  || nextThinking !== state.thinking
                  || nextTurns !== state.turns
                  || nextToolUses !== state.toolUses
                  || nextDuration !== state.durationMs
                  || !scoutUsageEquals(nextUsage, state.usage);
                if (!changed) return;
                state.phase = nextPhase;
                state.model = nextModel;
                state.thinking = nextThinking;
                state.turns = nextTurns;
                state.toolUses = nextToolUses;
                state.durationMs = nextDuration;
                state.usage = copyScoutUsage(nextUsage);
                emit();
              });
            } catch (error) {
              result = terminalScoutResult(
                request,
                state,
                signal?.aborted ? "aborted" : "failed",
                error,
                Date.now() - started,
              );
            }
            state.phase = result.outcome;
            state.thinking = result.thinking;
            state.turns = result.turns;
            state.toolUses = result.toolUses;
            state.durationMs = Math.max(state.durationMs, result.durationMs);
            state.usage = copyScoutUsage(result.usage);
            state.error = result.error;
            emit();
            return result;
          },
          {
            concurrency,
            signal,
            priority: (task) => priorityForKind(task.kind as ScoutKind),
            onUpdate(pool) {
              let changed = false;
              for (const item of pool.items) {
                if (item.phase !== "aborted" || states[item.index].phase !== "queued") continue;
                forcedResults[item.index] = terminalScoutResult(
                  requests[item.index],
                  states[item.index],
                  "aborted",
                  "Scout aborted before starting.",
                  Date.now() - started,
                );
                changed = true;
              }
              if (changed) emit();
            },
          },
        );

        const results = outcomes.map((outcome, index): ScoutRunResult => {
          if (outcome.status === "fulfilled") return outcome.value;
          const forced = forcedResults[index];
          if (forced) return forced;
          return terminalScoutResult(
            requests[index],
            states[index],
            outcome.status === "aborted" ? "aborted" : "failed",
            outcome.status === "rejected" ? outcome.reason : "Scout aborted before starting.",
          );
        });
        const usable = results.filter((result) => isUsableOutcome(result.outcome)).length;

        return {
          content: [{ type: "text", text: formatScoutResults(results) }],
          details: details(),
          isError: usable === 0,
          usage: sumUsage(results),
        };
      } finally {
        deactivate();
      }
    },
  });

  pi.registerCommand("r-fast", {
    description: "Run a task with adaptive parallel read-only scouts",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /r-fast <task>", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current task to finish before using /r-fast.", "warning");
        return;
      }
      subagentsActive = true;
      delegationUsed = false;
      const active = pi.getActiveTools();
      if (!active.includes(SUBAGENT_TOOL_NAME)) pi.setActiveTools([...active, SUBAGENT_TOOL_NAME]);
      try {
        await pi.sendMessage({
          customType: SUBAGENTS_MESSAGE_TYPE,
          content: subagentsPrompt(task),
          display: true,
          details: { version: 1, task },
        }, { triggerTurn: true });
      } catch (error) {
        deactivate();
        throw error;
      }
    },
  });

  pi.on("session_start", deactivate);
  pi.on("agent_settled", deactivate);
  pi.on("session_shutdown", deactivate);
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
