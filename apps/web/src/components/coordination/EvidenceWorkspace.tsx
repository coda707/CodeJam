import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
  SystemInfo,
} from "../../types";
import { formatNumber, shortId } from "./presentation";
import { CopyIdentifier } from "./CopyIdentifier";

interface EvidenceWorkspaceProps {
  attempts: CoordinationAttempt[];
  artifacts: CoordinationArtifact[];
  tasks: CoordinationTask[];
  agentNames: Map<string, string>;
  executorMode: SystemInfo["coordinationExecutor"];
}

export function EvidenceWorkspace({
  attempts,
  artifacts,
  tasks,
  agentNames,
  executorMode,
}: EvidenceWorkspaceProps) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return (
    <article className="coordination-panel evidence-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Execution Evidence</span>
          <h2>Attempts, Runs and verified Artifacts</h2>
        </div>
        <span>
          {attempts.length} attempts / {artifacts.length} artifacts
        </span>
      </div>
      <div className="evidence-grid">
        <section>
          <h3>Attempts</h3>
          <div className="evidence-list">
            {attempts.map((attempt) => {
              const task = tasksById.get(attempt.taskId);
              const tokens =
                (attempt.usage?.inputTokens ?? 0) +
                (attempt.usage?.outputTokens ?? 0);
              return (
                <article key={attempt.id}>
                  <div>
                    <strong>
                      {task?.title ?? `Task ${shortId(attempt.taskId)}`}
                    </strong>
                    <span
                      className={`evidence-status evidence-${attempt.status}`}
                    >
                      {attempt.status}
                    </span>
                  </div>
                  <p>
                    {attempt.agentId
                      ? agentNames.get(attempt.agentId) ??
                        shortId(attempt.agentId)
                      : executorMode === "fake"
                        ? "Fake Executor"
                        : "Unassigned"}
                    {attempt.runId ? ` / Run ${shortId(attempt.runId)}` : ""}
                    {tokens > 0
                      ? ` / ${formatNumber(tokens)} tokens`
                      : ""}
                  </p>
                  <CopyIdentifier label="Attempt ID" value={attempt.id} compact />
                  {attempt.runId && (
                    <CopyIdentifier label="Run ID" value={attempt.runId} compact />
                  )}
                  {attempt.retryOfAttemptId && (
                    <small className="evidence-retry-link">
                      Retry of{" "}
                      <CopyIdentifier
                        label="source Attempt ID"
                        value={attempt.retryOfAttemptId}
                        compact
                      />
                    </small>
                  )}
                  {attempt.errorMessage && <small>{attempt.errorMessage}</small>}
                </article>
              );
            })}
            {attempts.length === 0 && <p>No Attempts recorded yet.</p>}
          </div>
        </section>
        <section>
          <h3>Artifacts</h3>
          <div className="evidence-list">
            {artifacts.map((artifact) => (
              <article key={artifact.id}>
                <div>
                  <strong>{artifact.sourcePath ?? artifact.type}</strong>
                  <span
                    className={`evidence-status evidence-${artifact.verificationStatus}`}
                  >
                    {artifact.verificationStatus}
                  </span>
                </div>
                <p>
                  {artifact.type} / sha256:
                  {artifact.contentHash.slice(0, 12)}...
                </p>
                <CopyIdentifier label="Artifact ID" value={artifact.id} compact />
                <small>
                  Attempt{" "}
                  {artifact.attemptId ? (
                    <CopyIdentifier
                      label="Attempt ID"
                      value={artifact.attemptId}
                      compact
                    />
                  ) : (
                    "unknown"
                  )}
                </small>
              </article>
            ))}
            {artifacts.length === 0 && (
              <p>No file Artifacts reported by this Session.</p>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}
