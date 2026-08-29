import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { api } from "../../api";
import type {
  Agent,
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationMetrics,
  CoordinationSession,
  CoordinationTask,
  SystemInfo,
} from "../../types";
import { CoordinationEmptyState } from "./CoordinationEmptyState";
import { EventTimeline } from "./EventTimeline";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { reconcileSelectedTaskId } from "./graphModel";
import { MetricsSummary } from "./MetricsSummary";
import { activeSessionStatuses } from "./presentation";
import { SessionCommandBar } from "./SessionCommandBar";
import { SessionRail } from "./SessionRail";
import { TaskGraph } from "./TaskGraph";
import { TaskInspector } from "./TaskInspector";
import { WorkspaceHeader } from "./WorkspaceHeader";

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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
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
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setLoading(false));
  }, [refreshDetails, selectedId]);

  useEffect(() => {
    if (
      !selectedId ||
      !session ||
      !activeSessionStatuses.has(session.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshDetails(selectedId).catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [refreshDetails, selectedId, session]);

  useEffect(() => {
    setSelectedTaskId((current) => reconcileSelectedTaskId(tasks, current));
  }, [tasks]);

  const createSession = async (event: FormEvent) => {
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
      <WorkspaceHeader executorMode={executorMode} />

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            x
          </button>
        </div>
      )}

      <div className="coordination-layout">
        <SessionRail
          agents={agents}
          sessions={sessions}
          selectedId={selectedId}
          participantIds={participantIds}
          userTask={userTask}
          busy={busy}
          loading={loading}
          usesRealAgents={usesRealAgents}
          onUserTaskChange={setUserTask}
          onToggleParticipant={toggleParticipant}
          onCreate={createSession}
          onSelect={setSelectedId}
        />

        <div className="coordination-detail">
          {session ? (
            <>
              <SessionCommandBar
                session={session}
                attemptCount={attempts.length}
                busy={busy}
                usesRealAgents={usesRealAgents}
                onStart={startSession}
                onStop={stopSession}
              />
              <div className="task-workspace">
                <TaskGraph
                  tasks={tasks}
                  agentNames={agentNames}
                  usesRealAgents={usesRealAgents}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={setSelectedTaskId}
                />
                <TaskInspector
                  taskId={selectedTaskId}
                  tasks={tasks}
                  attempts={attempts}
                  artifacts={artifacts}
                  agentNames={agentNames}
                  onSelectTask={setSelectedTaskId}
                />
              </div>
              <EvidenceWorkspace
                attempts={attempts}
                artifacts={artifacts}
                tasks={tasks}
                agentNames={agentNames}
                executorMode={executorMode}
              />
              <EventTimeline events={events} />
              {metrics && <MetricsSummary metrics={metrics} />}
            </>
          ) : (
            <CoordinationEmptyState />
          )}
        </div>
      </div>
    </section>
  );
}
