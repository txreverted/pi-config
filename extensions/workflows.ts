import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { emptyUsage } from "./subagents-core.ts";
import { getOrchestrationRuntime, type OrchestrationRuntime } from "./orchestration-runtime.ts";
import type { BuiltinWorkflowName } from "./workflows-core.ts";
import { createAgentRegistry } from "../subagents/registry.ts";
import { WORKFLOW_NAMES, createWorkflowRegistry } from "../subagents/workflows-registry.ts";

interface BackgroundWorkflowDetails {
  kind: "workflow-background";
  runId: string;
  name: string;
  status: "starting";
}

const workflowSchema = Type.Object({
  name: StringEnum(WORKFLOW_NAMES, { description: "Trusted, version-controlled workflow name" }),
  objective: Type.String({ minLength: 1, maxLength: 50_000, description: "Objective and acceptance criteria" }),
  paths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
    maxItems: 32,
    description: "Optional repository paths to prioritize",
  })),
  allowWrite: Type.Optional(Type.Boolean({ description: "Required for the implement-review workflow" })),
}, { additionalProperties: false });

export function registerWorkflowTool(
  pi: ExtensionAPI,
  runtime: OrchestrationRuntime = getOrchestrationRuntime(pi),
): void {
  const agents = createAgentRegistry();
  const workflows = createWorkflowRegistry();

  pi.registerTool({
    name: "workflow",
    label: "workflow",
    description: "Run one trusted built-in workflow in a private background host. Intermediate evidence stays out of parent context; /runs exposes live state and the final result is delivered once.",
    promptSnippet: "Run a bounded background review, implementation-review, or research workflow",
    promptGuidelines: [
      "Use workflow review for read-only code review, implement-review for one writer followed by fresh reviewers, and research for two independent public-web passes plus synthesis.",
      "Workflow synthesis is evidence, not proof. Verify important findings and run deterministic checks before declaring success.",
      "Do not invoke workflow implement-review unless the user explicitly authorized modifying the current checkout.",
      "Use orchestration_control or /runs for background status and control. Never stop a quiet live run solely due to inactivity.",
    ],
    parameters: workflowSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      runtime.bind(ctx);
      if (!ctx.model) throw new Error("Workflow requires a selected parent model");
      const objective = params.objective.trim();
      if (!objective || params.objective.length > 50_000) throw new Error("Workflow objective must contain 1-50000 characters");
      if ((params.paths?.length ?? 0) > 32 || params.paths?.some((path) => !path.trim() || path.length > 4_096)) {
        throw new Error("Workflow paths must contain at most 32 non-empty paths of at most 4096 characters");
      }

      const name = params.name as BuiltinWorkflowName;
      const definition = workflows.get(name);
      if (!definition) throw new Error(`Unknown internal workflow: ${String(params.name)}`);
      const hasWriter = definition.steps.some((step) => agents.get(step.agent)?.writer === true);
      if (hasWriter) {
        if (params.allowWrite !== true) {
          throw new Error("The implement-review workflow requires allowWrite: true and explicit user authorization");
        }
        if (ctx.hasUI) {
          const confirmed = await ctx.ui.confirm(
            "Run implementation workflow?",
            `${definition.name} contains one worker and may modify ${ctx.cwd}. Continue?`,
            { signal },
          );
          if (!confirmed) throw new Error("Writer workflow was not approved");
        }
      }

      const receipt = await runtime.startBackgroundWorkflow({
        builtinName: name,
        objective,
        paths: [...(params.paths ?? [])],
        cwd: ctx.cwd,
        ctx,
      });
      const content = [
        `Workflow ${receipt.name} started in the background.`,
        `Run id: ${receipt.runId}`,
        "Use /runs or orchestration_control to inspect or stop it. The final result will be delivered once to this session.",
      ].join("\n");
      return {
        content: [{ type: "text", text: content }],
        details: { kind: "workflow-background", runId: receipt.runId, name: receipt.name, status: "starting" } satisfies BackgroundWorkflowDetails,
        usage: emptyUsage() as Usage,
      };
    },
    renderCall(args, theme) {
      const preview = args.objective?.length > 80 ? `${args.objective.slice(0, 80)}…` : args.objective;
      return new Text(`${theme.fg("toolTitle", theme.bold("workflow"))} ${theme.fg("accent", args.name ?? "…")} ${theme.fg("dim", "(background)")}\n  ${theme.fg("dim", preview ?? "…")}`, 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as BackgroundWorkflowDetails | undefined;
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      if (!details || expanded) return new Text(content, 0, 0);
      return new Text(`${theme.fg("accent", "◆")} ${theme.fg("accent", details.name)} ${theme.fg("dim", `starting · ${details.runId}`)}`, 0, 0);
    },
  });
}
