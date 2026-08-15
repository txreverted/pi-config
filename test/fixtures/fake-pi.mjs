import { readFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE ?? "success";
const args = process.argv.slice(2);
const taskArgument = args.find((arg) => arg.startsWith("@"));
const task = taskArgument ? await readFile(taskArgument.slice(1), "utf8") : "";
const delayMs = Number(process.env.FAKE_PI_DELAY_MS ?? 5);

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function finalEvent() {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: task.includes("Delegated task") ? "fixture completed" : "missing task" }],
      provider: "fixture",
      model: "test-model",
      stopReason: "stop",
      usage: {
        input: 10,
        output: 4,
        cacheRead: 2,
        cacheWrite: 1,
        totalTokens: 17,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
      },
    },
  };
}

async function writeSuccess(chunked = true) {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  if (!chunked) {
    writeEvent(finalEvent());
    return;
  }
  const event = `${JSON.stringify(finalEvent())}\n`;
  const split = Math.floor(event.length / 2);
  process.stdout.write(event.slice(0, split));
  setTimeout(() => process.stdout.write(event.slice(split)), delayMs);
}

if (mode === "hang" || mode === "startup-hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "quiet") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  setInterval(() => {}, 1_000);
} else if (mode === "malformed") {
  process.stdout.write("not json\n");
} else if (mode === "tool") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  writeEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "fixture" } });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: {}, isError: false });
  writeEvent(finalEvent());
} else if (mode === "large") {
  const event = finalEvent();
  event.message.content[0].text = "x".repeat(20_000);
  writeEvent(event);
} else if (mode === "tool-loop") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  for (let index = 0; index < 10; index++) {
    writeEvent({ type: "tool_execution_start", toolCallId: `tool-${index}`, toolName: "read", args: { path: "fixture" } });
    writeEvent({ type: "tool_execution_end", toolCallId: `tool-${index}`, toolName: "read", result: {}, isError: false });
  }
  setInterval(() => {}, 1_000);
} else if (mode === "stream-budget") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({
    type: "message_update",
    usage: { totalTokens: 1_000, cost: { total: 2 } },
    assistantMessageEvent: { type: "text_delta", delta: "streaming" },
  });
  setInterval(() => {}, 1_000);
} else {
  await writeSuccess(true);
}
