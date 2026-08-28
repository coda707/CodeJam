import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectCoordinationMetrics } from "./metrics.js";
import {
  makeCoordinationArtifact,
  makeCoordinationSession,
  makeTaskAttempt,
  makeTaskNode,
} from "./test-support/factories.js";

describe("projectCoordinationMetrics", () => {
  it("projects persisted usage, failures, recovery and evidence counts", () => {
    const sessionId = randomUUID();
    const taskId = randomUUID();
    const failedAttemptId = randomUUID();
    const recoveredAttemptId = randomUUID();
    const agentId = randomUUID();
    const session = makeCoordinationSession({
      id: sessionId,
      userTask: "Recover and verify",
      status: "completed",
      participantAgentIds: [agentId],
      startedAt: "2026-08-29T00:00:01.000Z",
      completedAt: "2026-08-29T00:00:04.500Z",
    });
    const task = makeTaskNode(session, {
      id: taskId,
      title: "Recovered task",
      instructions: "Complete it",
      status: "succeeded",
      assignedAgentId: agentId,
      attemptCount: 2,
      updatedAt: "2026-08-29T00:00:04.500Z",
    });
    const failedAttempt = makeTaskAttempt(session, task, {
      id: failedAttemptId,
      agentId,
      runId: randomUUID(),
      status: "failed",
      errorClass: "timeout",
      errorMessage: "timed out",
      usage: { inputTokens: 10, outputTokens: 2 },
      completedAt: "2026-08-29T00:00:02.000Z",
    });
    const recoveredAttempt = makeTaskAttempt(session, task, {
      id: recoveredAttemptId,
      agentId,
      runId: randomUUID(),
      status: "succeeded",
      retryOfAttemptId: failedAttemptId,
      usage: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 3 },
      createdAt: "2026-08-29T00:00:02.100Z",
      completedAt: "2026-08-29T00:00:04.500Z",
    });
    const metrics = projectCoordinationMetrics(
      session,
      [task],
      [failedAttempt, recoveredAttempt],
      [
        makeCoordinationArtifact(session, task, recoveredAttempt, {
          producerAgentId: agentId,
          sourcePath: "result.txt",
          contentHash: "b".repeat(64),
        }),
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
