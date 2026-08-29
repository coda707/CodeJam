import { useMemo } from "react";
import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
} from "../../types";
import { formatNumber } from "./presentation";
import { buildTaskInspectorModel } from "./taskInspectorModel";

interface TaskInspectorProps {
  taskId: string | null;
  tasks: readonly CoordinationTask[];
  attempts: readonly CoordinationAttempt[];
  artifacts: readonly CoordinationArtifact[];
  agentNames: ReadonlyMap<string, string>;
  onSelectTask: (taskId: string) => void;
}

export function TaskInspector({
  taskId,
  tasks,
  attempts,
  artifacts,
  agentNames,
  onSelectTask,
}: TaskInspectorProps) {
  const model = useMemo(
    () =>
      buildTaskInspectorModel(
        taskId,
        tasks,
        attempts,
        artifacts,
        agentNames,
      ),
    [agentNames, artifacts, attempts, taskId, tasks],
  );

  if (!model) {
    return (
      <article
        id="task-inspector"
        className="coordination-panel task-inspector"
      >
        <span className="eyebrow">Task Inspector</span>
        <h2>Select a Task</h2>
        <p className="task-inspector-empty">
          Choose a graph node to inspect its contract and evidence.
        </p>
      </article>
    );
  }

  const { task } = model;
  return (
    <article
      id="task-inspector"
      className="coordination-panel task-inspector"
      aria-labelledby="task-inspector-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Task Inspector</span>
          <h2 id="task-inspector-title">{task.title}</h2>
        </div>
        <span className={`evidence-status evidence-${task.status}`}>
          {task.status}
        </span>
      </div>

      <dl className="task-inspector-identity">
        <div>
          <dt>Task ID</dt>
          <dd>
            <code>{task.id}</code>
          </dd>
        </div>
        <div>
          <dt>Assigned Agent</dt>
          <dd>
            {task.assignedAgentId ? (
              <>
                <strong>{model.assignedAgentName ?? "Unknown Agent"}</strong>
                <code>{task.assignedAgentId}</code>
              </>
            ) : (
              "Unassigned"
            )}
          </dd>
        </div>
      </dl>

      <section className="task-inspector-section">
        <h3>Instructions</h3>
        <p>{task.instructions}</p>
      </section>

      <section className="task-inspector-section">
        <h3>Dependencies</h3>
        {model.dependencies.length > 0 ? (
          <div className="task-inspector-links">
            {model.dependencies.map((dependency) =>
              dependency.task ? (
                <button
                  type="button"
                  key={dependency.id}
                  onClick={() => onSelectTask(dependency.id)}
                >
                  <strong>{dependency.task.title}</strong>
                  <code>{dependency.id}</code>
                </button>
              ) : (
                <div key={dependency.id} className="task-inspector-missing">
                  <strong>Missing dependency</strong>
                  <code>{dependency.id}</code>
                </div>
              ),
            )}
          </div>
        ) : (
          <p>Entry Task with no dependencies.</p>
        )}
      </section>

      <section className="task-inspector-section">
        <h3>Acceptance Criteria</h3>
        <div className="task-inspector-list">
          {task.acceptanceCriteria.map((criterion) => (
            <article key={criterion.id}>
              <div>
                <strong>{criterion.description}</strong>
                <span>{criterion.kind}</span>
              </div>
              <code>{criterion.value}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="task-inspector-section">
        <h3>Attempts</h3>
        <div className="task-inspector-list">
          {model.attempts.map((attempt) => {
            const tokens =
              (attempt.usage?.inputTokens ?? 0) +
              (attempt.usage?.outputTokens ?? 0);
            return (
              <article key={attempt.id}>
                <div>
                  <strong>{attempt.status}</strong>
                  {tokens > 0 && <span>{formatNumber(tokens)} tokens</span>}
                </div>
                <dl>
                  <div>
                    <dt>Attempt</dt>
                    <dd>
                      <code>{attempt.id}</code>
                    </dd>
                  </div>
                  {attempt.agentId && (
                    <div>
                      <dt>Agent</dt>
                      <dd>
                        <code>{attempt.agentId}</code>
                      </dd>
                    </div>
                  )}
                  {attempt.runId && (
                    <div>
                      <dt>Run</dt>
                      <dd>
                        <code>{attempt.runId}</code>
                      </dd>
                    </div>
                  )}
                  {attempt.retryOfAttemptId && (
                    <div>
                      <dt>Retry of</dt>
                      <dd>
                        <code>{attempt.retryOfAttemptId}</code>
                      </dd>
                    </div>
                  )}
                </dl>
                {attempt.errorMessage && (
                  <p className="task-inspector-error">
                    {attempt.errorClass
                      ? `${attempt.errorClass}: `
                      : ""}
                    {attempt.errorMessage}
                  </p>
                )}
                {attempt.workerOutput && (
                  <div className="worker-output">
                    <strong>Verified WorkerOutput</strong>
                    <p>{attempt.workerOutput.summary}</p>
                    {attempt.workerOutput.evidence.length > 0 && (
                      <ul>
                        {attempt.workerOutput.evidence.map((evidence, index) => (
                          <li key={`${attempt.id}-${index}`}>{evidence}</li>
                        ))}
                      </ul>
                    )}
                    {attempt.workerOutput.artifactPaths.length > 0 && (
                      <p>
                        Reported paths: {attempt.workerOutput.artifactPaths.join(", ")}
                      </p>
                    )}
                    {attempt.workerOutput.unresolvedIssues.length > 0 && (
                      <p className="task-inspector-error">
                        Unresolved: {attempt.workerOutput.unresolvedIssues.join("; ")}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {model.attempts.length === 0 && <p>No Attempts recorded.</p>}
        </div>
      </section>

      <section className="task-inspector-section">
        <h3>Artifacts</h3>
        <div className="task-inspector-list">
          {model.artifacts.map((artifact) => (
            <article key={artifact.id}>
              <div>
                <strong>{artifact.sourcePath ?? artifact.type}</strong>
                <span>{artifact.verificationStatus}</span>
              </div>
              <dl>
                <div>
                  <dt>Artifact</dt>
                  <dd>
                    <code>{artifact.id}</code>
                  </dd>
                </div>
                {artifact.attemptId && (
                  <div>
                    <dt>Attempt</dt>
                    <dd>
                      <code>{artifact.attemptId}</code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{artifact.contentHash}</code>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
          {model.artifacts.length === 0 && <p>No Artifacts recorded.</p>}
        </div>
      </section>
    </article>
  );
}
