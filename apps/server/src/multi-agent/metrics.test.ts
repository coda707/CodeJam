import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectCoordinationMetrics } from "./metrics.js";

describe("projectCoordinationMetrics", () => {
  it("projects persisted usage, failures, recovery and evidence counts", () => {
    const sessionId = randomUUID();
    const taskId = randomUUID();
    const failedAttemptId = randomUUID();
    const recoveredAttemptId = randomUUID();
    const agentId = randomUUID();
    const createdAt = "2026-08-29T00:00:00.000Z";
    const metrics = projectCoordinationMetrics(
      {
        id: sessionId,
        userTask: "Recover and verify",
        status: "completed",
        topology: "sequential",
        participantAgentIds: [agentId],
        rootTraceId: randomUUID(),
        budget: {
          maxTasks: 8,
          maxConcurrentTasks: 2,
          maxAttemptsPerTask: 2,
          maxAgentCalls: 8,
          maxEvents: 500,
        },
        createdAt,
        startedAt: "2026-08-29T00:00:01.000Z",
        completedAt: "2026-08-29T00:00:04.500Z",
      },
      [
        {
          id: taskId,
          sessionId,
          title: "Recovered task",
          instructions: "Complete it",
          dependencies: [],
          requiredCapabilities: ["delivery"],
          acceptanceCriteria: [
            {
              id: "result",
              kind: "artifact",
              description: "Result exists",
              value: "worker-output",
            },
          ],
          status: "succeeded",
          assignedAgentId: agentId,
          attemptCount: 2,
          createdAt,
          updatedAt: "2026-08-29T00:00:04.500Z",
        },
      ],
      [
        {
          id: failedAttemptId,
          sessionId,
          taskId,
          agentId,
          runId: randomUUID(),
          status: "failed",
          errorClass: "timeout",
          errorMessage: "timed out",
          usage: { inputTokens: 10, outputTokens: 2 },
          createdAt,
          completedAt: "2026-08-29T00:00:02.000Z",
        },
        {
          id: recoveredAttemptId,
          sessionId,
          taskId,
          agentId,
          runId: randomUUID(),
          status: "succeeded",
          retryOfAttemptId: failedAttemptId,
          usage: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 3 },
          createdAt: "2026-08-29T00:00:02.100Z",
          completedAt: "2026-08-29T00:00:04.500Z",
        },
      ],
      [
        {
          id: randomUUID(),
          sessionId,
          taskId,
          attemptId: recoveredAttemptId,
          producerAgentId: agentId,
          type: "report",
          schemaVersion: 1,
          sourcePath: "result.txt",
          path: `${sessionId}/${recoveredAttemptId}/result.txt`,
          contentHash: "b".repeat(64),
          verificationStatus: "accepted",
          createdAt,
        },
      ],
      [],
    );

    expect(metrics).toMatchObject({
      totalAgentCalls: 2,
      failedAttempts: 1,
      retryAttempts: 1,
      recoveredTasks: 1,
      inputTokens: 22,
      cachedInputTokens: 4,
      outputTokens: 5,
      acceptedArtifacts: 1,
      durationMs: 3_500,
      recoveryStatus: "succeeded",
    });
  });
});
