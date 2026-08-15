import {
  formatWorkflowEvidence,
  type WorkflowDefinition,
  type WorkflowInput,
} from "../extensions/workflows-core.ts";

export const WORKFLOW_NAMES = ["review", "implement-review", "research"] as const;

function scope(input: WorkflowInput): string {
  const paths = input.paths.length > 0 ? `\n\nPrioritize these paths:\n${input.paths.map((path) => `- ${path}`).join("\n")}` : "";
  return `Objective:\n${input.objective.trim()}${paths}`;
}

function reviewWorkflow(): WorkflowDefinition {
  return {
    name: "review",
    description: "Map the relevant code, perform two independent read-only reviews, and synthesize confirmed findings.",
    outputStep: "synthesis",
    steps: [
      {
        id: "scout",
        agent: "scout",
        phase: "Map",
        onFailure: "stop",
        buildTask: (input) => `${scope(input)}\n\nMap the relevant implementation, tests, dependencies, and repository conventions. Identify the highest-risk review surfaces. Do not edit files.`,
      },
      {
        id: "correctness-review",
        agent: "reviewer",
        phase: "Review",
        needs: ["scout"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview independently for correctness, regressions, error handling, concurrency, and missing tests. Verify claims directly in the repository.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "security-review",
        agent: "reviewer",
        phase: "Review",
        thinking: "high",
        needs: ["scout"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview independently for security, trust-boundary violations, unsafe filesystem or process behavior, data exposure, and edge cases. Verify claims directly in the repository.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        phase: "Synthesize",
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
    description: "Scout, run exactly one writer, perform two fresh read-only reviews, and synthesize remaining concerns.",
    outputStep: "synthesis",
    steps: [
      {
        id: "scout",
        agent: "scout",
        phase: "Map",
        onFailure: "stop",
        buildTask: (input) => `${scope(input)}\n\nMap the exact files, conventions, tests, and risks relevant to this implementation. Produce a concise handoff for one writer. Do not edit files.`,
      },
      {
        id: "implementation",
        agent: "worker",
        phase: "Implement",
        needs: ["scout"],
        onFailure: "stop",
        buildTask: (input, results) => `${scope(input)}\n\nImplement the requested change in the current checkout. Keep the change focused, run appropriate deterministic checks, and summarize modifications and verification.\n\n${formatWorkflowEvidence(results, ["scout"])}`,
      },
      {
        id: "correctness-review",
        agent: "reviewer",
        phase: "Review",
        needs: ["implementation"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview the resulting working tree independently for correctness, regressions, incomplete requirements, and missing tests. Do not edit files.\n\n${formatWorkflowEvidence(results, ["implementation"])}`,
      },
      {
        id: "security-review",
        agent: "reviewer",
        phase: "Review",
        thinking: "high",
        needs: ["implementation"],
        onFailure: "continue",
        buildTask: (input, results) => `${scope(input)}\n\nReview the resulting working tree independently for security, unsafe behavior, data exposure, and edge cases. Do not edit files.\n\n${formatWorkflowEvidence(results, ["implementation"])}`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        phase: "Synthesize",
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
    outputStep: "synthesis",
    steps: [
      {
        id: "primary-research",
        agent: "researcher",
        phase: "Research",
        onFailure: "continue",
        buildTask: (input) => `${scope(input)}\n\nResearch this question using primary and authoritative public sources. Preserve source URLs, publication dates where relevant, and note uncertainty.`,
      },
      {
        id: "adversarial-research",
        agent: "researcher",
        phase: "Research",
        onFailure: "continue",
        buildTask: (input) => `${scope(input)}\n\nResearch independently. Seek contradictory evidence, limitations, failure reports, and alternative explanations. Preserve source URLs and note uncertainty.`,
      },
      {
        id: "synthesis",
        agent: "synthesizer",
        phase: "Synthesize",
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
