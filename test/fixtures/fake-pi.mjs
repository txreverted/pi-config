import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE ?? "success";
const args = process.argv.slice(2);
const taskArgument = args.find((arg) => arg.startsWith("@"));
const taskPath = taskArgument?.slice(1);
const task = taskPath ? await readFile(taskPath, "utf8") : "";
if (taskPath && process.env.FAKE_PI_TASK_PATH_FILE) await writeFile(process.env.FAKE_PI_TASK_PATH_FILE, taskPath);
const delayMs = Number(process.env.FAKE_PI_DELAY_MS ?? 5);

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function finalEvent() {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{
        type: "text",
        text: task.includes("Delegated task") ? "fixture completed" : "missing task",
      }],
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
} else if (mode === "malformed-hang") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  process.stdout.write("not json\n");
  setInterval(() => {}, 1_000);
} else if (mode === "stderr-failure") {
  process.stderr.write("provider authentication failed\n");
  process.exitCode = 1;
} else if (mode === "error-then-success") {
  const failed = finalEvent();
  failed.message.content[0].text = "retryable failure";
  failed.message.stopReason = "error";
  failed.message.errorMessage = "temporary provider error";
  writeEvent(failed);
  writeEvent(finalEvent());
} else if (mode === "stubborn-descendant") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  await writeFile(process.env.FAKE_PI_PID_FILE, String(descendant.pid));
  setInterval(() => {}, 1_000);
} else if (mode === "tool") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  writeEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "fixture" } });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: {}, isError: false });
  writeEvent(finalEvent());
} else if (mode === "tool-hang") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  writeEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "fixture" } });
  setInterval(() => {}, 1_000);
} else if (mode === "edit-files") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  writeEvent({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit", args: { path: "one.ts" } });
  writeEvent({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit", result: {}, isError: false });
  writeEvent({ type: "tool_execution_start", toolCallId: "write-2", toolName: "write", args: { path: "two.ts" } });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent({ type: "tool_execution_end", toolCallId: "write-2", toolName: "write", result: {}, isError: false });
  writeEvent(finalEvent());
} else if (mode === "activities") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  const tools = [
    ["web_search", { query: "fixture" }],
    ["web_fetch", { url: "https://example.com" }],
    ["bash", { command: "npm run check" }],
    ["git_diff", {}],
    ["jq", { filter: "." }],
    ["ls", { path: "." }],
    ["bash", { command: "printf fixture" }],
    ["read", { path: "fixture" }],
  ];
  for (const [index, [toolName, toolArgs]] of tools.entries()) {
    const toolCallId = `activity-${index}`;
    writeEvent({ type: "tool_execution_start", toolCallId, toolName, args: toolArgs });
    writeEvent({ type: "tool_execution_end", toolCallId, toolName, result: {}, isError: false });
  }
  writeEvent(finalEvent());
} else if (mode === "interrupted-partial" || mode === "interrupted-large-partial") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  const completed = finalEvent();
  completed.message.content[0].text = "old completed response";
  writeEvent(completed);
  writeEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: mode === "interrupted-large-partial" ? `BEGIN${"x".repeat(20_000)}END` : "new partial response",
    },
  });
  setInterval(() => {}, 1_000);
} else if (mode === "activity-heartbeats") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent({
    type: "message_update",
    usage: { totalTokens: 1, cost: { total: 0.01 } },
    assistantMessageEvent: { type: "text_delta", delta: "working" },
  });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  process.stderr.write("still working\n");
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent(finalEvent());
} else if (mode === "large") {
  const event = finalEvent();
  event.message.content[0].text = "x".repeat(20_000);
  writeEvent(event);
} else if (mode === "large-json-event") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "image.png" } });
  writeEvent({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "read",
    result: {
      content: [{
        type: "image",
        data: "x".repeat(Number(process.env.FAKE_PI_JSON_EVENT_CHARS ?? 2 * 1024 * 1024 + 1)),
        mimeType: "image/png",
      }],
    },
    isError: false,
  });
  writeEvent(finalEvent());
} else if (mode === "tool-loop") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({ type: "agent_start" });
  for (let index = 0; index < 10; index++) {
    writeEvent({ type: "tool_execution_start", toolCallId: `tool-${index}`, toolName: "read", args: { path: "fixture" } });
    writeEvent({ type: "tool_execution_end", toolCallId: `tool-${index}`, toolName: "read", result: {}, isError: false });
  }
  writeEvent(finalEvent());
} else if (mode === "high-stream-cost") {
  writeEvent({ type: "session", version: 3, id: "fixture-session", timestamp: new Date().toISOString(), cwd: process.cwd() });
  writeEvent({
    type: "message_update",
    usage: { totalTokens: 10_000_000, cost: { total: 100 } },
    assistantMessageEvent: { type: "text_delta", delta: "streaming" },
  });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeEvent(finalEvent());
} else {
  await writeSuccess(true);
}
