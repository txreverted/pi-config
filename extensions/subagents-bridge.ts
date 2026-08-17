import { createHash, randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AGENT_NAMES } from "./subagents-core.ts";
import { brokerRequest } from "./subagents-supervisor.ts";

const id = Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" });
const task = Type.Object({
  id: Type.Optional(id),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  agent: StringEnum(AGENT_NAMES),
  task: Type.String({ minLength: 1, maxLength: 50_000, pattern: "\\S" }),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
}, { additionalProperties: false });

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: { value } };
}

export default function subagentBridge(pi: ExtensionAPI): void {
  // The bridge is inert in the root. Credentials are minted by its parent supervisor.
  if (process.env.PI_CONFIG_SUBAGENT_CHILD !== "1" || !process.env.PI_CONFIG_BROKER_SOCKET || !process.env.PI_CONFIG_BROKER_TOKEN) return;

  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "Ask the root supervisor to run descendant agents. Processes are created only by the root broker.",
    parameters: Type.Object({ tasks: Type.Array(task, { minItems: 1, maxItems: 20 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_call, params) {
      const parent = process.env.PI_CONFIG_AGENT_ID ?? "agent";
      const tasks = params.tasks.map((value, index) => ({
        ...value,
        id: value.id ?? `${value.agent}-${createHash("sha256").update(`${parent}\0${value.name}\0${index}`).digest("hex").slice(0, 12)}`,
      }));
      return text(await brokerRequest({ action: "spawn", tasks }));
    },
  });
  pi.registerTool({
    name: "get_subagent_result",
    label: "subagent result",
    description: "Get one direct child's durable status or result.",
    parameters: Type.Object({ id }, { additionalProperties: false }),
    async execute(_call, params) { return text(await brokerRequest({ action: "get", id: params.id })); },
  });
  pi.registerTool({
    name: "cancel_subagent",
    label: "cancel subagent",
    description: "Cancel one direct child through the root supervisor.",
    parameters: Type.Object({ id }, { additionalProperties: false }),
    async execute(_call, params) { return text(await brokerRequest({ action: "cancel", id: params.id })); },
  });
  pi.registerTool({
    name: "list_agents",
    label: "list agents",
    description: "List this agent and its direct children.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() { return text(await brokerRequest({ action: "list" })); },
  });
  pi.registerTool({
    name: "send_agent_message",
    label: "send agent message",
    description: "Send a bounded durable untrusted message to an agent in this team.",
    parameters: Type.Object({
      to: id,
      message: Type.String({ minLength: 1, maxLength: 16_000, pattern: "\\S" }),
      id: Type.Optional(id),
      hops: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
    }, { additionalProperties: false }),
    async execute(_call, params) {
      const result = await brokerRequest({ action: "message", to: params.to, body: params.message, id: params.id ?? `msg-${randomUUID()}`, hops: params.hops ?? 0 });
      return text(result);
    },
  });
}
