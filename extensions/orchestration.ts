import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getOrchestrationRuntime } from "./orchestration-runtime.ts";
import { registerSubagentTool } from "./subagents.ts";
import { registerWorkflowTool } from "./workflows.ts";

/**
 * Single package entrypoint for all orchestration tools. Pi attributes tool and
 * command registrations to the loading extension, so subagents and workflows
 * must share this entrypoint to avoid duplicate control-tool registration.
 */
export default function orchestrationExtension(pi: ExtensionAPI): void {
  const runtime = getOrchestrationRuntime(pi);
  registerSubagentTool(pi, runtime);
  registerWorkflowTool(pi, runtime);
}
