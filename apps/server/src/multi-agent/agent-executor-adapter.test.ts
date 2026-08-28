import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentRun } from "../types.js";
import {
  AgentServiceCoordinationExecutor,
  buildWorkerPrompt,
  type AgentExecutionService,
} from "./agent-executor-adapter.js";
import {
  COORDINATION_TEST_TIMESTAMP,
  makeTaskExecutionRequest,
} from "./test-support/factories.js";

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
    startedAt: COORDINATION_TEST_TIMESTAMP,
    completedAt: COORDINATION_TEST_TIMESTAMP,
    createdAt: COORDINATION_TEST_TIMESTAMP,
    ...overrides,
  };
}

describe("AgentServiceCoordinationExecutor", () => {
  it("launches an Agent Run and returns strict WorkerOutput with correlation", async () => {
    const request = makeTaskExecutionRequest();
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

  it("includes verified dependency output and Artifact evidence in the prompt", () => {
    const request = makeTaskExecutionRequest();
    const dependencyTaskId = randomUUID();
    const dependencyAttemptId = randomUUID();
    request.dependencyContext = [
      {
        task: {
          ...request.task,
          id: dependencyTaskId,
          title: "Prepare the implementation plan",
          status: "succeeded",
        },
        attempt: {
          ...request.attempt,
          id: dependencyAttemptId,
          taskId: dependencyTaskId,
          status: "succeeded",
          workerOutput: {
            summary: "Use a two-stage implementation",
            artifactPaths: ["reports/plan.md"],
            evidence: ["Plan verified"],
            unresolvedIssues: [],
          },
        },
        artifacts: [
          {
            id: randomUUID(),
            sessionId: request.session.id,
            taskId: dependencyTaskId,
            attemptId: dependencyAttemptId,
            type: "plan",
            schemaVersion: 1,
            sourcePath: "reports/plan.md",
            contentHash: "a".repeat(64),
            verificationStatus: "accepted",
            createdAt: COORDINATION_TEST_TIMESTAMP,
          },
        ],
      },
    ];

    const prompt = buildWorkerPrompt(request);

    expect(prompt).toContain("Verified dependency context:");
    expect(prompt).toContain("Use a two-stage implementation");
    expect(prompt).toContain("reports/plan.md");
    expect(prompt).toContain("a".repeat(64));
  });

  it("rejects malformed Agent output instead of trusting completion", async () => {
    const request = makeTaskExecutionRequest();
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
      new AgentServiceCoordinationExecutor(service).execute(
        makeTaskExecutionRequest(null),
      ),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "agent_capability_mismatch",
    });
  });

  it("propagates Attempt cancellation to its correlated Agent Run", async () => {
    const request = makeTaskExecutionRequest();
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
          completedAt: COORDINATION_TEST_TIMESTAMP,
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
