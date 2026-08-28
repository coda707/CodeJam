import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentRun } from "../types.js";
import {
  AgentServiceCoordinationExecutor,
  buildWorkerPrompt,
  type AgentExecutionService,
} from "./agent-executor-adapter.js";
import type { TaskExecutionRequest } from "./ports.js";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeRequest(agentId: string | null = randomUUID()): TaskExecutionRequest {
  const sessionId = randomUUID();
  const taskId = randomUUID();
  const attemptId = randomUUID();
  return {
    session: {
      id: sessionId,
      userTask: "Build and verify a small feature",
      status: "executing",
      topology: "sequential",
      participantAgentIds: agentId ? [agentId] : [],
      rootTraceId: randomUUID(),
      budget: {
        maxTasks: 8,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 2,
        maxAgentCalls: 8,
        maxEvents: 500,
      },
      createdAt: timestamp,
    },
    task: {
      id: taskId,
      sessionId,
      title: "Implement the feature",
      instructions: "Create the requested files and report evidence.",
      dependencies: [],
      requiredCapabilities: ["delivery"],
      acceptanceCriteria: [
        {
          id: "worker-output",
          kind: "artifact",
          description: "Return structured output",
          value: "worker-output",
        },
      ],
      status: "running",
      ...(agentId ? { assignedAgentId: agentId } : {}),
      attemptCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    attempt: {
      id: attemptId,
      sessionId,
      taskId,
      ...(agentId ? { agentId } : {}),
      status: "running",
      createdAt: timestamp,
      startedAt: timestamp,
    },
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: randomUUID(),
    agentId: randomUUID(),
    status: "completed",
    prompt: "task",
    output: JSON.stringify({
      summary: "Implemented and checked the feature",
      artifactPaths: ["src/feature.ts"],
      evidence: ["npm test passed"],
      unresolvedIssues: [],
    }),
    error: null,
    usage: { inputTokens: 10, outputTokens: 5 },
    startedAt: timestamp,
    completedAt: timestamp,
    createdAt: timestamp,
    ...overrides,
  };
}

describe("AgentServiceCoordinationExecutor", () => {
  it("launches an Agent Run and returns strict WorkerOutput with correlation", async () => {
    const request = makeRequest();
    const run = makeRun({ agentId: request.attempt.agentId! });
    let receivedPrompt = "";
    const service: AgentExecutionService = {
      sendMessage: async (_agentId, prompt) => {
        receivedPrompt = prompt;
        return { run: { ...run, status: "queued", output: null } };
      },
      waitForRun: async () => run,
      cancelRun: async () => false,
    };

    const result = await new AgentServiceCoordinationExecutor(service).execute(request);

    expect(result).toMatchObject({
      status: "succeeded",
      runId: run.id,
      usage: { inputTokens: 10, outputTokens: 5 },
      output: { artifactPaths: ["src/feature.ts"] },
    });
    expect(receivedPrompt).toBe(buildWorkerPrompt(request));
    expect(receivedPrompt).toContain("exactly one JSON object");
  });

  it("rejects malformed Agent output instead of trusting completion", async () => {
    const request = makeRequest();
    const run = makeRun({ agentId: request.attempt.agentId!, output: "done" });
    const service: AgentExecutionService = {
      sendMessage: async () => ({ run: { ...run, status: "queued" } }),
      waitForRun: async () => run,
      cancelRun: async () => false,
    };

    await expect(
      new AgentServiceCoordinationExecutor(service).execute(request),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "malformed_output",
      runId: run.id,
    });
  });

  it("fails safely when the scheduler did not assign an Agent", async () => {
    const service: AgentExecutionService = {
      sendMessage: async () => {
        throw new Error("must not execute");
      },
      waitForRun: async () => makeRun(),
      cancelRun: async () => false,
    };

    await expect(
      new AgentServiceCoordinationExecutor(service).execute(makeRequest(null)),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "agent_capability_mismatch",
    });
  });

  it("propagates Attempt cancellation to its correlated Agent Run", async () => {
    const request = makeRequest();
    const queued = makeRun({
      agentId: request.attempt.agentId!,
      status: "queued",
      output: null,
      completedAt: null,
    });
    let finish!: (run: AgentRun) => void;
    const completion = new Promise<AgentRun>((resolve) => {
      finish = resolve;
    });
    const cancelledRunIds: string[] = [];
    const service: AgentExecutionService = {
      sendMessage: async () => ({ run: queued }),
      waitForRun: () => completion,
      cancelRun: async (runId) => {
        cancelledRunIds.push(runId);
        finish({
          ...queued,
          status: "cancelled",
          error: "Run was cancelled",
          completedAt: timestamp,
        });
        return true;
      },
    };
    const executor = new AgentServiceCoordinationExecutor(service);
    const execution = executor.execute(request);
    await expect.poll(() => executor.cancel(request.attempt.id)).toBe(true);

    await expect(execution).resolves.toMatchObject({
      status: "failed",
      runId: queued.id,
    });
    expect(cancelledRunIds).toEqual([queued.id]);
  });
});
