import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type {
  Agent,
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
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

interface CoordinationWorkspaceProps {
  agents: Agent[];
}

export function CoordinationWorkspace({ agents }: CoordinationWorkspaceProps) {
  const [sessions, setSessions] = useState<CoordinationSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<CoordinationSession | null>(null);
  const [tasks, setTasks] = useState<CoordinationTask[]>([]);
  const [attempts, setAttempts] = useState<CoordinationAttempt[]>([]);
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
    const [sessionResult, taskResult, attemptResult, eventResult] = await Promise.all([
      api.coordinationSession(id),
      api.coordinationTasks(id),
      api.coordinationAttempts(id),
      api.coordinationEvents(id),
    ]);
    setSession(sessionResult.session);
    setTasks(taskResult.tasks);
    setAttempts(attemptResult.attempts);
    setEvents(eventResult.events);
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
          <span className="eyebrow">MOSAIC coordination foundation</span>
          <h1>Task graph and execution evidence</h1>
          <p>
            This shared milestone uses a clearly labelled deterministic Fake Executor.
            Existing Playground Agents remain real and unchanged.
          </p>
        </div>
        <span className="foundation-badge">Foundation · Fake Executor</span>
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
                <p>No Agents selected. The Fake Executor can still prove the flow.</p>
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
              disabled={busy || !userTask.trim()}
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
                      disabled={busy}
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
