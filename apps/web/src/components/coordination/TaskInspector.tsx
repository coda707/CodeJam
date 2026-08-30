import { useMemo, useState } from "react";
import { api } from "../../api";
import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
} from "../../types";
import { formatNumber } from "./presentation";
import { CopyIdentifier } from "./CopyIdentifier";
import { buildTaskInspectorModel } from "./taskInspectorModel";

interface ArtifactPreview {
  artifactId: string;
  loading: boolean;
  content: string | null;
  error: string | null;
}

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
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);

  const previewArtifact = async (artifact: CoordinationArtifact) => {
    setPreview({ artifactId: artifact.id, loading: true, content: null, error: null });
    try {
      const result = await api.coordinationArtifactContent(
        artifact.sessionId,
        artifact.id,
      );
      setPreview({
        artifactId: artifact.id,
        loading: false,
        content: result.content,
        error: null,
      });
    } catch (reason) {
      setPreview({
        artifactId: artifact.id,
        loading: false,
        content: null,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

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
            <CopyIdentifier label="Task ID" value={task.id} />
          </dd>
        </div>
        <div>
          <dt>Assigned Agent</dt>
          <dd>
            {task.assignedAgentId ? (
              <>
                <strong>{model.assignedAgentName ?? "Unknown Agent"}</strong>
                <CopyIdentifier label="Agent ID" value={task.assignedAgentId} />
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
                      <CopyIdentifier label="Attempt ID" value={attempt.id} />
                    </dd>
                  </div>
                  {attempt.agentId && (
                    <div>
                      <dt>Agent</dt>
                      <dd>
                        <CopyIdentifier label="Agent ID" value={attempt.agentId} />
                      </dd>
                    </div>
                  )}
                  {attempt.runId && (
                    <div>
                      <dt>Run</dt>
                      <dd>
                        <CopyIdentifier label="Run ID" value={attempt.runId} />
                      </dd>
                    </div>
                  )}
                  {attempt.retryOfAttemptId && (
                    <div>
                      <dt>Retry of</dt>
                      <dd>
                        <CopyIdentifier
                          label="source Attempt ID"
                          value={attempt.retryOfAttemptId}
                        />
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
                    <CopyIdentifier label="Artifact ID" value={artifact.id} />
                  </dd>
                </div>
                {artifact.attemptId && (
                  <div>
                    <dt>Attempt</dt>
                    <dd>
                      <CopyIdentifier
                        label="Attempt ID"
                        value={artifact.attemptId}
                      />
                    </dd>
                  </div>
                )}
                <div>
                  <dt>SHA-256</dt>
                  <dd>
                    <CopyIdentifier label="Artifact SHA-256" value={artifact.contentHash} />
                  </dd>
                </div>
              </dl>
              <div className="artifact-preview">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => void previewArtifact(artifact)}
                  disabled={preview?.artifactId === artifact.id && preview.loading}
                >
                  {preview?.artifactId === artifact.id && preview.loading
                    ? "Loading…"
                    : "Preview"}
                </button>
                {preview?.artifactId === artifact.id && preview.error && (
                  <p className="task-inspector-error">{preview.error}</p>
                )}
                {preview?.artifactId === artifact.id && preview.content !== null && (
                  <pre className="artifact-content">{preview.content}</pre>
                )}
              </div>
            </article>
          ))}
          {model.artifacts.length === 0 && <p>No Artifacts recorded.</p>}
        </div>
      </section>
    </article>
  );
}
