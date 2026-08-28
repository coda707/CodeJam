import {
  coordinationMetricsSchema,
  type CoordinationArtifact,
  type CoordinationEvent,
  type CoordinationMetrics,
  type CoordinationSession,
  type TaskAttempt,
  type TaskNode,
} from "./contracts.js";

export function projectCoordinationMetrics(
  session: CoordinationSession,
  tasks: TaskNode[],
  attempts: TaskAttempt[],
  artifacts: CoordinationArtifact[],
  events: CoordinationEvent[],
  now = new Date().toISOString(),
): CoordinationMetrics {
  const failedAttempts = attempts.filter((attempt) =>
    ["failed", "timed_out"].includes(attempt.status),
  ).length;
  const retryAttempts = attempts.filter((attempt) => attempt.retryOfAttemptId).length;
  const recoveredTasks = tasks.filter(
    (task) => task.status === "succeeded" && task.attemptCount > 1,
  ).length;
  const active = [
    "forming_team",
    "executing",
    "verifying",
    "recovering",
    "waiting_approval",
  ].includes(session.status);
  const recoveryStatus: CoordinationMetrics["recoveryStatus"] =
    failedAttempts === 0
      ? "not_needed"
      : active
        ? "in_progress"
        : recoveredTasks > 0 && session.status === "completed"
          ? "succeeded"
          : session.status === "failed"
            ? "failed"
            : "not_attempted";
  const started = Date.parse(session.startedAt ?? session.createdAt);
  const ended = Date.parse(session.completedAt ?? now);

  return coordinationMetricsSchema.parse({
    sessionId: session.id,
    totalTasks: tasks.length,
    totalAttempts: attempts.length,
    totalAgentCalls: attempts.filter((attempt) => attempt.runId).length,
    failedAttempts,
    retryAttempts,
    recoveredTasks,
    inputTokens: attempts.reduce(
      (total, attempt) => total + (attempt.usage?.inputTokens ?? 0),
      0,
    ),
    cachedInputTokens: attempts.reduce(
      (total, attempt) => total + (attempt.usage?.cachedInputTokens ?? 0),
      0,
    ),
    outputTokens: attempts.reduce(
      (total, attempt) => total + (attempt.usage?.outputTokens ?? 0),
      0,
    ),
    totalArtifacts: artifacts.length,
    acceptedArtifacts: artifacts.filter(
      (artifact) => artifact.verificationStatus === "accepted",
    ).length,
    totalEvents: events.length,
    durationMs: Math.max(0, Number.isFinite(ended - started) ? ended - started : 0),
    recoveryStatus,
  });
}
