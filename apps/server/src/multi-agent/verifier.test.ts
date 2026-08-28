import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VerificationRequest } from "./ports.js";
import { MechanicalCoordinationVerifier } from "./verifier.js";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeRequest(): VerificationRequest {
  const sessionId = randomUUID();
  const taskId = randomUUID();
  const attemptId = randomUUID();
  const agentId = randomUUID();
  return {
    session: {
      id: sessionId,
      userTask: "Verify a report",
      status: "verifying",
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
      createdAt: timestamp,
    },
    task: {
      id: taskId,
      sessionId,
      title: "Create report",
      instructions: "Create reports/result.txt",
      dependencies: [],
      requiredCapabilities: ["reporting"],
      acceptanceCriteria: [
        {
          id: "report-exists",
          kind: "file_exists",
          description: "The report is captured",
          value: "reports/result.txt",
        },
      ],
      status: "verifying",
      assignedAgentId: agentId,
      attemptCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    attempt: {
      id: attemptId,
      sessionId,
      taskId,
      agentId,
      status: "running",
      createdAt: timestamp,
      startedAt: timestamp,
    },
    artifacts: [
      {
        id: randomUUID(),
        sessionId,
        taskId,
        producerAgentId: agentId,
        attemptId,
        type: "report",
        schemaVersion: 1,
        sourcePath: "reports/result.txt",
        path: `${sessionId}/${attemptId}/report.txt`,
        contentHash: "a".repeat(64),
        verificationStatus: "unverified",
        createdAt: timestamp,
      },
    ],
    output: {
      summary: "Created report",
      artifactPaths: ["reports/result.txt"],
      evidence: ["File was written"],
      unresolvedIssues: [],
    },
  };
}

describe("MechanicalCoordinationVerifier", () => {
  it("accepts captured file evidence that satisfies the criterion", async () => {
    await expect(new MechanicalCoordinationVerifier().verify(makeRequest())).resolves.toMatchObject(
      { status: "accepted" },
    );
  });

  it("rejects missing or unresolved evidence", async () => {
    const missing = makeRequest();
    missing.artifacts = [];
    await expect(new MechanicalCoordinationVerifier().verify(missing)).resolves.toMatchObject({
      status: "rejected",
      failureClass: "test_failure",
    });

    const unresolved = makeRequest();
    unresolved.output.unresolvedIssues = ["Tests are still failing"];
    await expect(
      new MechanicalCoordinationVerifier().verify(unresolved),
    ).resolves.toMatchObject({ status: "rejected", failureClass: "no_progress" });
  });
});
