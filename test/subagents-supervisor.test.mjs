import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bridgeExtension from "../extensions/subagents-bridge.ts";
import { AgentSupervisor, brokerRequest } from "../extensions/subagents-supervisor.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalDepth = process.env.PI_CONFIG_MAX_AGENT_DEPTH;
const originalCap = process.env.PI_CONFIG_MAX_CONCURRENT_AGENTS;

function task(id, name, agent = "reviewer") {
  return { id, name, agent, task: "deterministic test", cwd: process.cwd() };
}

async function isolatedSupervisor(prefix) {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  process.env.PI_CODING_AGENT_DIR = root;
  const rootId = randomUUID();
  return { root, rootId, supervisor: await AgentSupervisor.create(rootId) };
}

async function clean(root, supervisor) {
  await supervisor.shutdown().catch(() => {});
  await rm(root, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalDepth === undefined) delete process.env.PI_CONFIG_MAX_AGENT_DEPTH;
  else process.env.PI_CONFIG_MAX_AGENT_DEPTH = originalDepth;
  if (originalCap === undefined) delete process.env.PI_CONFIG_MAX_CONCURRENT_AGENTS;
  else process.env.PI_CONFIG_MAX_CONCURRENT_AGENTS = originalCap;
}

test("supervisor permits depth three and rejects depth four", async () => {
  process.env.PI_CONFIG_MAX_AGENT_DEPTH = "3";
  const { root, supervisor } = await isolatedSupervisor("pi-depth");
  try {
    await supervisor.reserve(task("one", "Depth one"));
    await supervisor.reserve(task("two", "Depth two"), "one");
    await supervisor.reserve(task("three", "Depth three"), "two");
    await assert.rejects(() => supervisor.reserve(task("four", "Depth four"), "three"), /Maximum agent depth is 3/);
  } finally { await clean(root, supervisor); }
});

test("supervisor change subscriptions persist bounded interrupted progress", async () => {
  const { root, rootId, supervisor } = await isolatedSupervisor("pi-subscribe");
  let changes = 0;
  const unsubscribe = supervisor.subscribe(() => { changes++; });
  try {
    await supervisor.reserve(task("watch", "Watch changes"));
    await supervisor.update("watch", { id: "watch", agent: "reviewer", thinking: "high", status: "running", startedAt: 1, turns: 1, toolCalls: 2, text: "", activity: "Reading", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: .01 } } });
    assert.ok(changes >= 2);
    assert.equal(supervisor.get("watch").progress.activity, "Reading");
    const restored = await AgentSupervisor.create(rootId);
    try {
      assert.equal(restored.get("watch").status, "interrupted");
      assert.equal(restored.get("watch").progress.activity, "Reading");
      assert.equal(restored.get("watch").progress.toolCalls, 2);
    } finally { await restored.shutdown(); }
    unsubscribe();
  } finally { await clean(root, supervisor); }
});

test("depth never exceeds three even when the environment requests more", async () => {
  process.env.PI_CONFIG_MAX_AGENT_DEPTH = "20";
  const { root, supervisor } = await isolatedSupervisor("pi-depth-ceiling");
  try {
    await supervisor.reserve(task("one", "Ceiling one"));
    await supervisor.reserve(task("two", "Ceiling two"), "one");
    await supervisor.reserve(task("three", "Ceiling three"), "two");
    await assert.rejects(() => supervisor.reserve(task("four", "Ceiling four"), "three"), /Maximum agent depth is 3/);
  } finally { await clean(root, supervisor); }
});

test("supervisor enforces the global active cap", async () => {
  process.env.PI_CONFIG_MAX_CONCURRENT_AGENTS = "2";
  const { root, supervisor } = await isolatedSupervisor("pi-cap");
  try {
    await supervisor.reserve(task("one", "Cap one"));
    await supervisor.reserve(task("two", "Cap two"));
    await assert.rejects(() => supervisor.reserve(task("three", "Cap three")), /At most 2 agents/);
  } finally { await clean(root, supervisor); }
});

test("discarded managed writers cannot resume into the parent checkout", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-discarded-resume");
  try {
    const worktree = join(root, "worktree");
    await mkdir(worktree);
    await supervisor.reserve({ ...task("writer", "Discarded writer", "worker"), cwd: worktree }, undefined, undefined, {
      repoRoot: root, worktree, baseCommit: "0".repeat(40),
    });
    await supervisor.update("writer", {
      id: "writer", agent: "worker", thinking: "medium", status: "done", startedAt: 1,
      turns: 1, toolCalls: 0, text: "done", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    await supervisor.clearWorkspace("writer");
    await assert.rejects(() => supervisor.beginResume("writer"), /cannot be resumed after.*discarded/i);
  } finally { await clean(root, supervisor); }
});

test("authenticated broker fixes sender identity and rejects forged targets", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-auth");
  const previous = { socket: process.env.PI_CONFIG_BROKER_SOCKET, token: process.env.PI_CONFIG_BROKER_TOKEN };
  try {
    await supervisor.reserve(task("alice", "Alice"));
    await supervisor.reserve(task("bob", "Bob"));
    await supervisor.startBroker();
    Object.assign(process.env, supervisor.childEnvironment("alice"));
    const sent = await brokerRequest({ action: "message", from: "bob", to: "bob", body: "hello", id: "msg-one" });
    assert.equal(sent.from, "alice");
    await assert.rejects(() => brokerRequest({ action: "message", to: "outside", body: "hello", id: "msg-two" }), /Unknown target/);
    process.env.PI_CONFIG_BROKER_TOKEN = "forged";
    await assert.rejects(() => brokerRequest({ action: "list" }), /Unauthorized/);
  } finally {
    if (previous.socket === undefined) delete process.env.PI_CONFIG_BROKER_SOCKET; else process.env.PI_CONFIG_BROKER_SOCKET = previous.socket;
    if (previous.token === undefined) delete process.env.PI_CONFIG_BROKER_TOKEN; else process.env.PI_CONFIG_BROKER_TOKEN = previous.token;
    await clean(root, supervisor);
  }
});

test("permission broker preserves exact args and denies, times out, and disconnects closed", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-permission");
  const previous = { socket: process.env.PI_CONFIG_BROKER_SOCKET, token: process.env.PI_CONFIG_BROKER_TOKEN };
  try {
    const worktree = join(root, "worktree");
    await writeFile(join(root, "seed"), "x");
    await mkdir(worktree);
    await supervisor.reserve({ ...task("writer", "Writer", "worker"), cwd: worktree }, undefined, undefined, {
      repoRoot: root, worktree, baseCommit: "0".repeat(40),
    });
    await supervisor.startBroker();
    Object.assign(process.env, supervisor.childEnvironment("writer"));
    let captured;
    supervisor.setPermissionHandler(async (_sender, request) => { captured = request; return false; });
    const args = { command: "printf exact" };
    const deniedPromise = brokerRequest({ action: "permission", agentId: "writer", toolCallId: "call-1", toolName: "bash", args, workspace: worktree });
    args.command = "changed";
    assert.deepEqual(await deniedPromise, { approved: false });
    assert.deepEqual(captured.args, { command: "printf exact" });

    supervisor.setPermissionHandler(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); return true; });
    await assert.rejects(() => brokerRequest({ action: "permission", agentId: "writer", toolCallId: "call-2", toolName: "bash", args: {}, workspace: worktree }, 5), /timed out/);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await supervisor.shutdown();
    await assert.rejects(() => brokerRequest({ action: "list" }, 50));
  } finally {
    if (previous.socket === undefined) delete process.env.PI_CONFIG_BROKER_SOCKET; else process.env.PI_CONFIG_BROKER_SOCKET = previous.socket;
    if (previous.token === undefined) delete process.env.PI_CONFIG_BROKER_TOKEN; else process.env.PI_CONFIG_BROKER_TOKEN = previous.token;
    await clean(root, supervisor);
  }
});

test("agents can send bounded untrusted messages to main", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-main-mail");
  try {
    await supervisor.reserve(task("alice", "Main Alice"));
    const received = [];
    supervisor.setMainMessageHandler(async (message) => { received.push(message); });
    await supervisor.send("alice", "main", "status update", "main-message");
    assert.deepEqual(received.map(({ from, to, body }) => ({ from, to, body })), [
      { from: "alice", to: "main", body: "status update" },
    ]);
    assert.equal(supervisor.pendingMail("main").length, 0);
  } finally { await clean(root, supervisor); }
});

test("mail is bounded, deduplicated, and delivered when an idle agent resumes", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-mail");
  try {
    await supervisor.reserve(task("alice", "Mail Alice"));
    await supervisor.reserve(task("bob", "Mail Bob"));
    const first = await supervisor.send("alice", "bob", "resume note", "same-id", 8);
    const replay = await supervisor.send("alice", "bob", "resume note", "same-id", 8);
    assert.equal(replay.body, first.body);
    await assert.rejects(() => supervisor.send("alice", "bob", "changed replay", "same-id", 8), /Duplicate message id/);
    assert.equal(supervisor.pendingMail("bob").length, 1);
    await assert.rejects(() => supervisor.send("alice", "bob", "x".repeat(16_001)), /limited/);
    await assert.rejects(() => supervisor.send("alice", "bob", "hop", "too-many-hops", 9), /hop count/);

    const session = join(supervisor.sessionsDirectory, "bob.jsonl");
    await writeFile(session, "{}\n");
    const delivered = [];
    supervisor.attach("bob", session, { steer: async (message) => delivered.push(message) });
    const deadline = Date.now() + 1_000;
    while ((!delivered.length || supervisor.pendingMail("bob").length) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(delivered[0], /BEGIN UNTRUSTED AGENT MESSAGE/);
    assert.match(delivered[0], /From: alice/);
    assert.equal(supervisor.pendingMail("bob").length, 0);
  } finally { await clean(root, supervisor); }
});

test("persisted records reject session path escapes", async () => {
  const { root, supervisor } = await isolatedSupervisor("pi-persist");
  const directory = supervisor.directory;
  try {
    await supervisor.reserve(task("agent", "Persist agent"));
    await supervisor.shutdown();
    const path = join(directory, "agents.json");
    const data = JSON.parse(await readFile(path, "utf8"));
    data.records[0].sessionFile = join(root, "outside.jsonl");
    await writeFile(data.records[0].sessionFile, "{}\n");
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(() => AgentSupervisor.create(directory.split("/").at(-1)), /Invalid persisted agent record|session path/);
  } finally { await clean(root, supervisor); }
});

test("child bridge registers only fixed proxy tools", () => {
  const previous = {
    child: process.env.PI_CONFIG_SUBAGENT_CHILD,
    socket: process.env.PI_CONFIG_BROKER_SOCKET,
    token: process.env.PI_CONFIG_BROKER_TOKEN,
  };
  try {
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    process.env.PI_CONFIG_BROKER_SOCKET = "/private/broker";
    process.env.PI_CONFIG_BROKER_TOKEN = "secret";
    const tools = [];
    bridgeExtension({ registerTool(tool) { tools.push(tool.name); } });
    assert.deepEqual(tools, ["subagent", "get_subagent_result", "cancel_subagent", "list_agents", "send_agent_message"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const name = key === "child" ? "PI_CONFIG_SUBAGENT_CHILD" : key === "socket" ? "PI_CONFIG_BROKER_SOCKET" : "PI_CONFIG_BROKER_TOKEN";
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
