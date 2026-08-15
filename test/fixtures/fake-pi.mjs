import { readFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE ?? "success";
const args = process.argv.slice(2);
const taskArgument = args.find((arg) => arg.startsWith("@"));
const task = taskArgument ? await readFile(taskArgument.slice(1), "utf8") : "";

if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "fail") {
  process.stderr.write("fake failure\n");
  process.exitCode = 7;
} else if (mode === "malformed") {
  process.stdout.write("not json\n");
} else {
  const event = JSON.stringify({
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
  }) + "\n";
  const split = Math.floor(event.length / 2);
  process.stdout.write(event.slice(0, split));
  setTimeout(() => process.stdout.write(event.slice(split)), 5);
}
