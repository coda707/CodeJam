import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { RunCancelledError } from "./errors.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(runner: AgentRunner = new FakeRunner()): Promise<AgentService> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
  });
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
  );
  await service.initialize();
  return service;
}

describe("Agent lifecycle", () => {
  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(service.listAgents()).toHaveLength(1);
    expect((await service.updateAgent(agent.id, { description: "Builds apps" })).description)
      .toBe("Builds apps");
    expect((await service.stopAgent(agent.id)).status).toBe("stopped");
    expect((await service.startAgent(agent.id)).status).toBe("ready");
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
  });

  it("persists a playground conversation", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coder" });
    const { run } = await service.sendMessage(agent.id, "write hello world");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    const messages = service.getMessages(agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
  });

  it("isolates a coordination Run from the Playground transcript and Thread", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coordinated" });
    const sessionId = randomUUID();
    const taskId = randomUUID();
    const attemptId = randomUUID();
    const { run, message } = await service.sendMessage(agent.id, "worker prompt", {
      purpose: "coordination",
      coordination: { sessionId, taskId, attemptId },
    });

    expect(message).toBeNull();
    expect(run).toMatchObject({
      purpose: "coordination",
      sessionId,
      taskId,
      attemptId,
    });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    // No Worker prompt or output may surface as an ordinary Playground turn.
    expect(service.getMessages(agent.id)).toHaveLength(0);
    // The coordination Run must not replace the Playground Thread id.
    expect(service.getAgent(agent.id).codexThreadId).toBeNull();
    expect(service.getRun(run.id).threadId).toBe("fake-thread");
    expect(service.getRuns(agent.id)).toEqual([]);
  });

  it("restores Playground state after a failed coordination Run", async () => {
    let calls = 0;
    const service = await makeService({
      run: async (request) => {
        calls += 1;
        if (calls === 2) throw new Error("coordination-only failure");
        return { output: "playground answer", threadId: "playground-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Isolated" });
    const playground = await service.sendMessage(agent.id, "ordinary chat");
    await service.waitForRun(playground.run.id);
    const beforeMessages = service.getMessages(agent.id);
    const beforeRuns = service.getRuns(agent.id);

    const coordination = await service.sendMessage(agent.id, "private worker prompt", {
      purpose: "coordination",
      coordination: {
        sessionId: randomUUID(),
        taskId: randomUUID(),
        attemptId: randomUUID(),
      },
    });
    await service.waitForRun(coordination.run.id);

    expect(service.getRun(coordination.run.id).status).toBe("failed");
    expect(service.getMessages(agent.id)).toEqual(beforeMessages);
    expect(service.getRuns(agent.id)).toEqual(beforeRuns);
    expect(service.getAgent(agent.id)).toMatchObject({
      status: "ready",
      codexThreadId: "playground-thread",
      lastError: null,
    });
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(agent.id, "first"),
      service.sendMessage(agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(service.getMessages(agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect.poll(() => service.getRun(accepted.value.run.id).status).toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });
    const { run } = await service.sendMessage(agent.id, "first");

    await expect(service.startAgent(agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
  });

  it("waits for and cancels a specific Run without stopping the Agent", async () => {
    let rejectRun!: (reason: Error) => void;
    const service = await makeService({
      run: () =>
        new Promise<RunnerResult>((_resolve, reject) => {
          rejectRun = reject;
        }),
      cancel: async () => {
        rejectRun(new RunCancelledError());
        return true;
      },
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Cancellable" });
    const { run } = await service.sendMessage(agent.id, "long task");
    await expect.poll(() => service.getRun(run.id).status).toBe("running");

    await expect(service.cancelRun(run.id)).resolves.toBe(true);
    await expect(service.waitForRun(run.id)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(service.getAgent(agent.id).status).toBe("ready");
  });
});
