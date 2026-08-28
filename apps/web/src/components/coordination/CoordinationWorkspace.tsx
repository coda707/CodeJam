import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type {
  Agent,
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
  CoordinationMetrics,
  SystemInfo,
} from "../../types";

const activeStatuses = new Set([
  "forming_team",
  "executing",
  "verifying",
  "recovering",
]);

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const shortId = (value: string) => value.slice(0, 8);
const formatNumber = (value: number) => new Intl.NumberFormat().format(value);
const formatDuration = (value: number) =>
  value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;

interface CoordinationWorkspaceProps {
  agents: Agent[];
  executorMode: SystemInfo["coordinationExecutor"];
}

export function CoordinationWorkspace({
  agents,
  executorMode,
}: CoordinationWorkspaceProps) {
  const [sessions, setSessions] = useState<CoordinationSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<CoordinationSession | null>(null);
  const [tasks, setTasks] = useState<CoordinationTask[]>([]);
  const [attempts, setAttempts] = useState<CoordinationAttempt[]>([]);
  const [artifacts, setArtifacts] = useState<CoordinationArtifact[]>([]);
  const [metrics, setMetrics] = useState<CoordinationMetrics | null>(null);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [userTask, setUserTask] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const usesRealAgents = executorMode === "agent";

  const refreshSessions = useCallback(async () => {
    const result = await api.coordinationSessions();
    setSessions(result.sessions);
    setSelectedId((current) =>
      current && result.sessions.some((item) => item.id === current)
        ? current
        : (result.sessions[0]?.id ?? null),
    );
  }, []);

  const refreshDetails = useCallback(async (id: string) => {
    const [
      sessionResult,
      taskResult,
      attemptResult,
      eventResult,
      artifactResult,
      metricResult,
    ] = await Promise.all([
      api.coordinationSession(id),
      api.coordinationTasks(id),
      api.coordinationAttempts(id),
      api.coordinationEvents(id),
      api.coordinationArtifacts(id),
      api.coordinationMetrics(id),
    ]);
    setSession(sessionResult.session);
    setTasks(taskResult.tasks);
    setAttempts(attemptResult.attempts);
    setEvents(eventResult.events);
    setArtifacts(artifactResult.artifacts);
    setMetrics(metricResult.metrics);
    setSessions((current) =>
      current.map((item) =>
        item.id === sessionResult.session.id ? sessionResult.session : item,
      ),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshSessions()
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedId) {
      setSession(null);
      setTasks([]);
      setAttempts([]);
      setEvents([]);
      setArtifacts([]);
      setMetrics(null);
      return;
    }
    setLoading(true);
    void refreshDetails(selectedId)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [refreshDetails, selectedId]);

  useEffect(() => {
    if (!selectedId || !session || !activeStatuses.has(session.status)) return;
    const timer = window.setInterval(() => {
      void refreshDetails(selectedId).catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [refreshDetails, selectedId, session]);

  const createSession = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userTask.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createCoordinationSession({
        userTask: userTask.trim(),
        participantAgentIds: participantIds,
      });
      setUserTask("");
      setParticipantIds([]);
      await refreshSessions();
      setSelectedId(result.session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const startSession = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.startCoordinationSession(session.id);
      await refreshDetails(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const stopSession = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.stopCoordinationSession(session.id);
      await refreshDetails(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleParticipant = (agentId: string) => {
    setParticipantIds((current) =>
      current.includes(agentId)
        ? current.filter((item) => item !== agentId)
        : [...current, agentId],
    );
  };

  return (
    <section className="coordination-workspace">
      <header className="coordination-heading">
        <div>
          <span className="eyebrow">MOSAIC coordination</span>
          <h1>Task graph and execution evidence</h1>
          <p>
            {usesRealAgents
              ? "Tasks execute through the existing AgentService Run path with strict WorkerOutput validation."
              : "This safe default uses a deterministic Fake Executor. Existing Playground Agents remain real and unchanged."}
          </p>
        </div>
        <span className="foundation-badge">
          {usesRealAgents ? "MOSAIC · Agent Executor" : "Foundation · Fake Executor"}
        </span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="coordination-layout">
        <aside className="coordination-panel coordination-create-panel">
          <form onSubmit={createSession}>
            <span className="eyebrow">New Session</span>
            <h2>Coordinate a task</h2>
            <label>
              User task
              <textarea
                value={userTask}
                onChange={(event) => setUserTask(event.target.value)}
                placeholder="Describe a small task for the two-node foundation DAG…"
                rows={5}
                maxLength={50_000}
                required
              />
            </label>
            <fieldset className="participant-picker">
              <legend>Participant Agents</legend>
              {agents.length === 0 ? (
                <p>
                  {usesRealAgents
                    ? "Create at least one ready Agent before using the real executor."
                    : "No Agents selected. The Fake Executor can still prove the flow."}
                </p>
              ) : (
                agents.map((agent) => (
                  <label key={agent.id}>
                    <input
                      type="checkbox"
                      checked={participantIds.includes(agent.id)}
                      onChange={() => toggleParticipant(agent.id)}
                    />
                    <span>{agent.name}</span>
                    <small>{agent.status}</small>
                  </label>
                ))
              )}
            </fieldset>
            <button
              className="button button-primary coordination-create"
              disabled={
                busy ||
                !userTask.trim() ||
                (usesRealAgents && participantIds.length === 0)
              }
            >
              Create foundation Session
            </button>
          </form>

          <div className="session-list-heading">
            <span>Sessions</span>
            <span>{sessions.length}</span>
          </div>
          <div className="coordination-session-list">
            {sessions.map((item) => (
              <button
                key={item.id}
                className={item.id === selectedId ? "selected" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.userTask}</strong>
                <span>
                  {shortId(item.id)} · {item.status}
                </span>
              </button>
            ))}
            {!loading && sessions.length === 0 && (
              <p className="coordination-empty">Create the first Session to see its DAG.</p>
            )}
          </div>
        </aside>

        <div className="coordination-detail">
          {session ? (
            <>
              <article className="coordination-panel session-summary">
                <div>
                  <span className="eyebrow">Session {shortId(session.id)}</span>
                  <h2>{session.userTask}</h2>
                  <div className="session-metadata">
                    <span>{session.topology}</span>
                    <span>{session.participantAgentIds.length} participants</span>
                    <span>{attempts.length} attempts</span>
                  </div>
                </div>
                <div className="session-controls">
                  <span className={`coordination-status status-${session.status}`}>
                    {session.status}
                  </span>
                  {session.status === "planning" && (
                    <button
                      className="button button-primary"
                      onClick={startSession}
                      disabled={
                        busy ||
                        (usesRealAgents && session.participantAgentIds.length === 0)
                      }
                    >
                      Start Session
                    </button>
                  )}
                  {activeStatuses.has(session.status) && (
                    <button
                      className="button button-danger"
                      onClick={stopSession}
                      disabled={busy}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </article>

              {metrics && (
                <article className="coordination-panel metrics-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">Session Metrics</span>
                      <h2>Authoritative evidence projection</h2>
                    </div>
                    <span>Recovery: {metrics.recoveryStatus}</span>
                  </div>
                  <div className="metrics-grid">
                    <div>
                      <strong>{metrics.totalAgentCalls}</strong>
                      <span>Agent calls</span>
                    </div>
                    <div>
                      <strong>{metrics.totalAttempts}</strong>
                      <span>Attempts</span>
                    </div>
                    <div>
                      <strong>{metrics.failedAttempts}</strong>
                      <span>Failed</span>
                    </div>
                    <div>
                      <strong>{metrics.acceptedArtifacts}</strong>
                      <span>Verified artifacts</span>
                    </div>
                    <div>
                      <strong>{formatNumber(metrics.inputTokens + metrics.outputTokens)}</strong>
                      <span>Model tokens</span>
                    </div>
                    <div>
                      <strong>{formatDuration(metrics.durationMs)}</strong>
                      <span>Duration</span>
                    </div>
                  </div>
                </article>
              )}

              <article className="coordination-panel graph-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Coordination Graph</span>
                    <h2>Dependency-aware task flow</h2>
                  </div>
                  <span>{tasks.length} nodes</span>
                </div>
                <div className="foundation-graph" aria-label="Coordination task graph">
                  {tasks.map((task, index) => (
                    <div className="graph-step" key={task.id}>
                      <article className={`task-node task-${task.status}`}>
                        <div className="task-node-topline">
                          <span>{index + 1}</span>
                          <strong>{task.status}</strong>
                        </div>
                        <h3>{task.title}</h3>
                        <p>{task.requiredCapabilities.join(" · ") || "general"}</p>
                        <small>
                          {task.assignedAgentId
                            ? agentNames.get(task.assignedAgentId) ?? shortId(task.assignedAgentId)
                            : usesRealAgents
                              ? "Awaiting Agent"
                              : "Fake Executor"}
                        </small>
                      </article>
                      {index < tasks.length - 1 && (
                        <div className="graph-edge" aria-hidden="true">
                          <span />→
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>

              <article className="coordination-panel evidence-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Execution Evidence</span>
                    <h2>Attempts, Runs and verified Artifacts</h2>
                  </div>
                  <span>{attempts.length} attempts · {artifacts.length} artifacts</span>
                </div>
                <div className="evidence-grid">
                  <section>
                    <h3>Attempts</h3>
                    <div className="evidence-list">
                      {attempts.map((attempt) => {
                        const task = tasks.find((item) => item.id === attempt.taskId);
                        const tokens =
                          (attempt.usage?.inputTokens ?? 0) +
                          (attempt.usage?.outputTokens ?? 0);
                        return (
                          <article key={attempt.id}>
                            <div>
                              <strong>{task?.title ?? `Task ${shortId(attempt.taskId)}`}</strong>
                              <span className={`evidence-status evidence-${attempt.status}`}>
                                {attempt.status}
                              </span>
                            </div>
                            <p>
                              {attempt.agentId
                                ? agentNames.get(attempt.agentId) ?? shortId(attempt.agentId)
                                : executorMode === "fake"
                                  ? "Fake Executor"
                                  : "Unassigned"}
                              {attempt.runId ? ` · Run ${shortId(attempt.runId)}` : ""}
                              {tokens > 0 ? ` · ${formatNumber(tokens)} tokens` : ""}
                            </p>
                            {attempt.retryOfAttemptId && (
                              <small>Retry of {shortId(attempt.retryOfAttemptId)}</small>
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
                            {artifact.type} · sha256:{artifact.contentHash.slice(0, 12)}…
                          </p>
                          <small>
                            Attempt {artifact.attemptId ? shortId(artifact.attemptId) : "unknown"}
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

              <article className="coordination-panel timeline-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Event Timeline</span>
                    <h2>Persisted coordination evidence</h2>
                  </div>
                  <span>{events.length} events</span>
                </div>
                <ol className="coordination-timeline">
                  {events.map((item) => (
                    <li key={item.id}>
                      <span className={`event-dot event-${item.type.split(".").at(-1)}`} />
                      <time>{formatTime(item.createdAt)}</time>
                      <div>
                        <strong>{item.type}</strong>
                        <span>
                          {item.taskId ? `Task ${shortId(item.taskId)} · ` : ""}
                          {Object.keys(item.payload).length > 0
                            ? JSON.stringify(item.payload)
                            : "State transition recorded"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            </>
          ) : (
            <div className="coordination-panel coordination-empty-state">
              <div>M</div>
              <h2>Create a Coordination Session</h2>
              <p>The fixed DAG and its persisted event evidence will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
