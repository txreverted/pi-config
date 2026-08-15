import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type AgentDefinition,
  type AgentName,
} from "../extensions/subagents-core.ts";
import {
  formatWorkflowEvidence,
  type WorkflowDefinition,
  type WorkflowInput,
} from "../extensions/workflows-core.ts";

export const AGENT_NAMES = ["scout", "reviewer", "worker", "researcher", "synthesizer"] as const satisfies readonly AgentName[];
export const WORKFLOW_NAMES = ["review", "implement-review", "research"] as const;

function prompt(name: AgentName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8").trim();
}

export function createAgentRegistry(): ReadonlyMap<AgentName, AgentDefinition> {
  const webExtensionPath = fileURLToPath(new URL("../extensions/web.ts", import.meta.url));
  const agents: AgentDefinition[] = [
    {
      name: "scout",
      description: "Map relevant code, dependencies, conventions, and likely change surfaces without editing files.",
      tools: ["read", "grep", "find", "ls"],
      prompt: prompt("scout"),
      thinking: "low",
      timeoutMs: 8 * 60_000,
      contextFiles: true,
    },
    {
      name: "reviewer",
      description: "Perform a fresh, evidence-based, read-only code review.",
      tools: ["read", "grep", "find", "ls"],
      prompt: prompt("reviewer"),
      thinking: "inherit",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
    },
    {
      name: "worker",
      description: "Implement one bounded task in the current checkout. This is the only file-writing role.",
      tools: ["read", "bash", "edit", "write"],
      prompt: prompt("worker"),
      thinking: "inherit",
      timeoutMs: 25 * 60_000,
      contextFiles: true,
      writer: true,
    },
    {
      name: "researcher",
      description: "Research public sources using the hardened keyless web tools.",
      tools: ["read", "web_search", "web_fetch"],
      extensions: [webExtensionPath],
      prompt: prompt("researcher"),
      thinking: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: false,
    },
    {
      name: "synthesizer",
      description: "Reconcile delegated evidence into a concise, verified final report.",
      tools: ["read", "grep", "find", "ls"],
      prompt: prompt("synthesizer"),
      thinking: "inherit",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}

function scope(input: WorkflowInput): string {
  const paths = input.paths.length > 0 ? `\n\nPrioritize these paths:\n${input.paths.map((path) => `- ${path}`).join("\n")}` : "";
  return `Objective:\n${input.objective.trim()}${paths}`;
}

function reviewWorkflow(): WorkflowDefinition {
  return {
    name: "review",
    description: "Map the relevant code, perform two independent read-only reviews, and synthesize confirmed findings.",
    steps: [
      {
        id: "scout",
        agent: "scout",
        onFailure: "stop",
        buildTask: (input) => `${scope(input)}\n\nMap the relevant implementation, tests, dependencies, and repository conventions. Identify the highest-risk review surfaces. Do not edit files.`,
      },
      {
        id: "correctness-review",
        agent: "reviewer",
        needs: ["scout"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview independently for correctness, regressions, error handling, concurrency, and missing tests. Verify claims directly in the repository.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "security-review",
        agent: "reviewer",
        needs: ["scout"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview independently for security, trust-boundary violations, unsafe filesystem or process behavior, data exposure, and edge cases. Verify claims directly in the repository.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        needs: ["correctness-review", "security-review"],
        onFailure: "stop",
        buildTask: (input, results) => `${scope(input)}\n\nSynthesize only substantiated findings. Resolve disagreements by inspecting the repository. Rank findings by severity, provide file/line evidence, and distinguish confirmed problems from suggestions.\n\n${formatWorkflowEvidence(results, ["correctness-review", "security-review"])}`,
      },
    ],
  };
}

function implementationWorkflow(): WorkflowDefinition {
  return {
    name: "implement-review",
    description: "Scout, run exactly one writer, perform two fresh reviews, and synthesize remaining concerns.",
    steps: [
      {
        id: "scout",
        agent: "scout",
        onFailure: "stop",
        buildTask: (input) => `${scope(input)}\n\nMap the exact files, conventions, tests, and risks relevant to this implementation. Produce a concise handoff for one writer. Do not edit files.`,
      },
      {
        id: "implementation",
        agent: "worker",
        needs: ["scout"],
        onFailure: "stop",
        buildTask: (input, results) => `${scope(input)}\n\nImplement the requested change in the current checkout. Keep the change focused, run appropriate deterministic checks, and summarize modifications and verification.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "correctness-review",
        agent: "reviewer",
        needs: ["implementation"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview the resulting working tree independently for correctness, regressions, incomplete requirements, and missing tests. Do not edit files.\n\n${formatWorkflowEvidence(results, ["implementation"])}`,
      },
      {
        id: "security-review",
        agent: "reviewer",
        needs: ["implementation"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview the resulting working tree independently for security, unsafe behavior, data exposure, and edge cases. Do not edit files.\n\n${formatWorkflowEvidence(results, ["implementation"])}`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        needs: ["correctness-review", "security-review"],
        onFailure: "stop",
        buildTask: (input, results) => `${scope(input)}\n\nSynthesize remaining confirmed concerns after implementation. Inspect the working tree to verify claims. Do not modify files or automatically apply reviewer suggestions.\n\n${formatWorkflowEvidence(results, ["correctness-review", "security-review"])}`,
      },
    ],
  };
}

function researchWorkflow(): WorkflowDefinition {
  return {
    name: "research",
    description: "Run two independent public-web research passes and synthesize source-backed conclusions.",
    steps: [
      {
        id: "primary-research",
        agent: "researcher",
        onFailure: "continue",
        buildTask: (input) => `${scope(input)}\n\nResearch this question using primary and authoritative public sources. Preserve source URLs, publication dates where relevant, and note uncertainty.`,
      },
      {
        id: "adversarial-research",
        agent: "researcher",
        onFailure: "continue",
        buildTask: (input) => `${scope(input)}\n\nResearch independently. Seek contradictory evidence, limitations, failure reports, and alternative explanations. Preserve source URLs and note uncertainty.`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        needs: ["primary-research", "adversarial-research"],
        onFailure: "stop",
        buildTask: (input, results) => `${scope(input)}\n\nProduce a source-backed synthesis. Reconcile conflicts, distinguish direct evidence from inference, preserve useful URLs, and explicitly state unresolved uncertainty.\n\n${formatWorkflowEvidence(results, ["primary-research", "adversarial-research"])}`,
      },
    ],
  };
}

export function createWorkflowRegistry(): ReadonlyMap<WorkflowDefinition["name"], WorkflowDefinition> {
  const definitions = [reviewWorkflow(), implementationWorkflow(), researchWorkflow()];
  return new Map(definitions.map((definition) => [definition.name, definition]));
}
