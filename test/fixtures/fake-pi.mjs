import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const mode = process.env.FAKE_PI_MODE ?? "success";
const args = process.argv.slice(2);
const delayMs = Number(process.env.FAKE_PI_DELAY_MS ?? 5);
const sessionDir = args[args.indexOf("--session-dir") + 1];
const sessionFile = sessionDir && !sessionDir.startsWith("--") ? join(sessionDir, "fixture-session.jsonl") : join(process.cwd(), "fixture-session.jsonl");
await mkdir(join(sessionFile, ".."), { recursive: true }).catch(() => {});
await writeFile(sessionFile, '{"type":"session","id":"fixture-session"}\n', { flag: "a", mode: 0o600 });

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function response(command, data) { send({ id: command.id, type: "response", command: command.type, success: true, ...(data === undefined ? {} : { data }) }); }
function usage() { return { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17, cost: { input: .01, output: .02, cacheRead: .001, cacheWrite: .002, total: .033 } }; }
function final(text = "fixture completed", stopReason = "stop", errorMessage) {
  return { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], provider: "fixture", model: "test-model", stopReason, usage: usage(), ...(errorMessage ? { errorMessage } : {}) } };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastText = null;
let running = false;
let descendant;

async function runPrompt(message) {
  if (process.env.FAKE_PI_PROMPT_FILE) await writeFile(process.env.FAKE_PI_PROMPT_FILE, message);
  const rolePath = args[args.indexOf("--append-system-prompt") + 1];
  if (rolePath && process.env.FAKE_PI_RUN_PATH_FILE) await writeFile(process.env.FAKE_PI_RUN_PATH_FILE, rolePath);
  running = true;
  send({ type: "agent_start" });
  if (mode === "hang" || mode === "startup-hang" || mode === "quiet") return;
  if (mode === "malformed" || mode === "malformed-hang") { process.stdout.write("not json\n"); if (mode === "malformed") process.exit(1); return; }
  if (mode === "stderr-failure") { process.stderr.write("provider authentication failed\n"); process.exit(1); }
  if (mode === "stderr-large") { process.stderr.write(`${"😀".repeat(20_000)}\u001b]52;c;payload\u0007`); process.exit(1); }
  if (mode === "stubborn-descendant") {
    descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
    await writeFile(process.env.FAKE_PI_PID_FILE, String(descendant.pid));
    return;
  }
  if (mode === "error-then-success") send(final("retryable failure", "error", "temporary provider error"));
  if (mode === "empty-final") send(final("old response"));
  if (mode === "tool" || mode === "tool-hang") {
    send({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "fixture" } });
    if (mode === "tool-hang") return;
    await sleep(delayMs);
    send({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: {}, isError: false });
  }
  if (mode === "edit-files") {
    for (const [id, name, path] of [["edit-1", "edit", "one.ts"], ["write-2", "write", "two.ts"]]) {
      send({ type: "tool_execution_start", toolCallId: id, toolName: name, args: { path } });
      send({ type: "tool_execution_end", toolCallId: id, toolName: name, result: {}, isError: false });
    }
  }
  if (mode === "activities") {
    const tools = [["web_search", { query: "x" }], ["web_fetch", { url: "https://example.com" }], ["bash", { command: "npm run check" }], ["git_diff", {}], ["jq", {}], ["ls", {}], ["bash", { command: "printf x" }], ["read", {}]];
    for (const [index, [toolName, toolArgs]] of tools.entries()) {
      send({ type: "tool_execution_start", toolCallId: `t-${index}`, toolName, args: toolArgs });
      send({ type: "tool_execution_end", toolCallId: `t-${index}`, toolName, result: {}, isError: false });
    }
  }
  if (mode === "tool-loop") for (let i = 0; i < 10; i++) {
    send({ type: "tool_execution_start", toolCallId: `t-${i}`, toolName: "read", args: {} });
    send({ type: "tool_execution_end", toolCallId: `t-${i}`, toolName: "read", result: {}, isError: false });
  }
  if (mode === "interrupted-partial" || mode === "interrupted-large-partial") {
    send(final("old completed response"));
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: mode.endsWith("large-partial") ? `BEGIN${"x".repeat(20000)}END` : "new partial response" } });
    return;
  }
  if (mode === "activity-heartbeats") {
    await sleep(delayMs); send({ type: "message_update", usage: { totalTokens: 1, cost: { total: .01 } }, assistantMessageEvent: { type: "text_delta", delta: "working" } });
    await sleep(delayMs); process.stderr.write("still working\n"); await sleep(delayMs);
  }
  if (mode === "large-json-event") send({ type: "tool_execution_end", toolCallId: "large", toolName: "read", result: { content: [{ type: "image", data: "x".repeat(Number(process.env.FAKE_PI_JSON_EVENT_CHARS)), mimeType: "image/png" }] }, isError: false });
  if (mode === "high-stream-cost") send({ type: "message_update", usage: { totalTokens: 1e7, cost: { total: 100 } }, assistantMessageEvent: { type: "text_delta", delta: "streaming" } });
  const text = mode === "empty-final" ? "" : mode === "large" ? "x".repeat(20000) : "fixture completed";
  lastText = text;
  send(final(text, mode === "length" ? "length" : "stop"));
  send({ type: "agent_settled" });
  running = false;
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
  for (const line of lines) void (async () => {
    const command = JSON.parse(line);
    if (command.type === "get_state") return response(command, { sessionFile, sessionId: "fixture-session", isStreaming: running, autoCompactionEnabled: true });
    if (command.type === "get_last_assistant_text") return response(command, { text: lastText });
    if (command.type === "get_session_stats") return response(command, { tokens: usage(), cost: .033 });
    if (command.type === "prompt") { response(command); await runPrompt(command.message); return; }
    if (command.type === "abort") {
      if (mode === "stubborn-descendant") return;
      response(command);
      process.exit(0);
    }
    response(command, command.type === "switch_session" ? { cancelled: false } : undefined);
  })();
});
