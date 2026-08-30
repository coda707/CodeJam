import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { createDetailRequestGate } from "./detailRequestGate";
import { EventTimeline } from "./EventTimeline";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { reconcileSelectedTaskId } from "./graphModel";
import { MetricsSummary } from "./MetricsSummary";
import { activeSessionStatuses } from "./presentation";
import { RefreshStatus } from "./RefreshStatus";
import { RecoveryPanel } from "./RecoveryPanel";
import { SessionCommandBar } from "./SessionCommandBar";
import { SessionRail } from "./SessionRail";
import { TaskGraph } from "./TaskGraph";
import { TaskInspector } from "./TaskInspector";
import { WorkspaceHeader } from "./WorkspaceHeader";

interface CoordinationWorkspaceProps {
  agents: Agent[];
  executorMode: SystemInfo["coordinationExecutor"];
}

interface WorkspaceError {
  message: string;
  scope: "sessions" | "create" | "action";
  sessionId?: string;
}

interface DetailIssue {
  message: string;
  sessionId: string;
  stale: boolean;
  failedAt: string;
}

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

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
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [detailIssue, setDetailIssue] = useState<DetailIssue | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const detailSnapshotIdRef = useRef<string | null>(null);
  const detailRequestGate = useRef(createDetailRequestGate());
  const sessionListRequestVersion = useRef(0);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const usesRealAgents = executorMode === "agent";
  const displayedSession = session?.id === selectedId ? session : null;

  const selectSession = useCallback((id: string | null) => {
    if (selectedIdRef.current === id) return;
    selectedIdRef.current = id;
    detailRequestGate.current.invalidate();
    detailSnapshotIdRef.current = null;
    setSelectedId(id);
    setSession(null);
    setTasks([]);
    setAttempts([]);
    setEvents([]);
    setArtifacts([]);
    setMetrics(null);
    setSelectedTaskId(null);
    setDetailsLoading(id !== null);
    setWorkspaceError(null);
    setDetailIssue(null);
  }, []);

  const applySessionState = useCallback((next: CoordinationSession) => {
    setSessions((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    if (selectedIdRef.current === next.id) setSession(next);
  }, []);

  const refreshSessions = useCallback(async () => {
    const requestVersion = ++sessionListRequestVersion.current;
    try {
      const result = await api.coordinationSessions();
      if (requestVersion !== sessionListRequestVersion.current) return false;
      setSessions(result.sessions);
      const current = selectedIdRef.current;
      const next =
        current && result.sessions.some((item) => item.id === current)
          ? current
          : (result.sessions[0]?.id ?? null);
      if (next !== current) selectSession(next);
      setWorkspaceError((value) =>
        value?.scope === "sessions" ? null : value,
      );
      return true;
    } catch (reason) {
      if (requestVersion !== sessionListRequestVersion.current) return false;
      throw reason;
    }
  }, [selectSession]);

  const refreshDetails = useCallback(async (id: string) => {
    const ticket = detailRequestGate.current.begin(id, selectedIdRef.current);
    if (!ticket) return false;
    try {
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
      if (!detailRequestGate.current.isCurrent(ticket, selectedIdRef.current)) {
        return false;
      }
      setSession(sessionResult.session);
      setTasks(taskResult.tasks);
      setAttempts(attemptResult.attempts);
      setEvents(eventResult.events);
      setArtifacts(artifactResult.artifacts);
      setMetrics(metricResult.metrics);
      detailSnapshotIdRef.current = id;
      setDetailIssue(null);
      setSessions((current) =>
        current.map((item) =>
          item.id === sessionResult.session.id ? sessionResult.session : item,
        ),
      );
      return true;
    } catch (reason) {
      if (!detailRequestGate.current.isCurrent(ticket, selectedIdRef.current)) {
        return false;
      }
      setDetailIssue((current) => ({
        message: errorMessage(reason),
        sessionId: id,
        stale: detailSnapshotIdRef.current === id,
        failedAt:
          current?.sessionId === id && current.stale
            ? current.failedAt
            : new Date().toISOString(),
      }));
      throw reason;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshSessions()
      .catch((reason) => {
        if (!cancelled) {
          setWorkspaceError({ message: errorMessage(reason), scope: "sessions" });
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
      sessionListRequestVersion.current += 1;
    };
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedId) {
      detailRequestGate.current.invalidate();
      setSession(null);
      setTasks([]);
      setAttempts([]);
      setEvents([]);
      setArtifacts([]);
      setMetrics(null);
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    void refreshDetails(selectedId)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled && selectedIdRef.current === selectedId) {
          setDetailsLoading(false);
        }
      });
    return () => {
      cancelled = true;
      detailRequestGate.current.invalidate();
    };
  }, [detailReloadVersion, refreshDetails, selectedId]);

  useEffect(() => {
    if (
      !selectedId ||
      !displayedSession ||
      !activeSessionStatuses.has(displayedSession.status)
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await refreshDetails(selectedId);
      } catch {}
      if (!cancelled && selectedIdRef.current === selectedId) {
        timer = window.setTimeout(poll, 500);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [displayedSession?.status, refreshDetails, selectedId]);

  useEffect(() => {
    setSelectedTaskId((current) => reconcileSelectedTaskId(tasks, current));
  }, [tasks]);

  const createSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!userTask.trim()) return;
    setBusy(true);
    setWorkspaceError(null);
    try {
      const result = await api.createCoordinationSession({
        userTask: userTask.trim(),
        participantAgentIds: participantIds,
      });
      setUserTask("");
      setParticipantIds([]);
      await refreshSessions();
      selectSession(result.session.id);
    } catch (reason) {
      setWorkspaceError({ message: errorMessage(reason), scope: "create" });
    } finally {
      setBusy(false);
    }
  };

  const startSession = async () => {
    if (!displayedSession) return;
    const sessionId = displayedSession.id;
    setBusy(true);
    setWorkspaceError(null);
    try {
      const result = await api.startCoordinationSession(sessionId);
      applySessionState(result.session);
      await refreshDetails(sessionId);
    } catch (reason) {
      if (selectedIdRef.current === sessionId) {
        setWorkspaceError({
          message: errorMessage(reason),
          scope: "action",
          sessionId,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const stopSession = async () => {
    if (!displayedSession) return;
    const sessionId = displayedSession.id;
    setBusy(true);
    setWorkspaceError(null);
    try {
      const result = await api.stopCoordinationSession(sessionId);
      applySessionState(result.session);
      await refreshDetails(sessionId);
    } catch (reason) {
      if (selectedIdRef.current === sessionId) {
        setWorkspaceError({
          message: errorMessage(reason),
          scope: "action",
          sessionId,
        });
      }
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

  const retrySelectedSession = () => {
    if (!selectedId) return;
    detailRequestGate.current.invalidate();
    setDetailIssue(null);
    setDetailsLoading(true);
    setDetailReloadVersion((value) => value + 1);
  };

  const resolveApproval = async (
    decision: "approve" | "reject",
    reason: string,
  ) => {
    if (!displayedSession) return;
    const sessionId = displayedSession.id;
    setBusy(true);
    setWorkspaceError(null);
    try {
      const result = await (decision === "approve"
        ? api.approveCoordinationSession(sessionId, reason)
        : api.rejectCoordinationSession(sessionId, reason));
      applySessionState(result.session);
      await refreshDetails(sessionId);
    } catch (reason) {
      if (selectedIdRef.current === sessionId) {
        setWorkspaceError({
          message: errorMessage(reason),
          scope: "action",
          sessionId,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const retrySessions = async () => {
    setSessionsLoading(true);
    setWorkspaceError(null);
    try {
      await refreshSessions();
    } catch (reason) {
      setWorkspaceError({ message: errorMessage(reason), scope: "sessions" });
    } finally {
      setSessionsLoading(false);
    }
  };

  return (
    <section className="coordination-workspace">
      <WorkspaceHeader executorMode={executorMode} />

      {workspaceError && workspaceError.scope !== "sessions" && (
        <div className="error-banner" role="alert">
          <span>{workspaceError.message}</span>
          <button
            aria-label="Dismiss error"
            onClick={() => setWorkspaceError(null)}
          >
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
          loading={sessionsLoading}
          listUnavailable={workspaceError?.scope === "sessions"}
          usesRealAgents={usesRealAgents}
          onUserTaskChange={setUserTask}
          onToggleParticipant={toggleParticipant}
          onCreate={createSession}
          onSelect={selectSession}
          onRetrySessions={() => void retrySessions()}
        />

        <div className="coordination-detail">
          {displayedSession ? (
            <>
              {detailIssue?.sessionId === displayedSession.id &&
                detailIssue.stale && (
                  <RefreshStatus
                    failedAt={detailIssue.failedAt}
                    refreshing={detailsLoading}
                    onRetry={retrySelectedSession}
                  />
                )}
              <SessionCommandBar
                session={displayedSession}
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
              <RecoveryPanel
                session={displayedSession}
                tasks={tasks}
                attempts={attempts}
                events={events}
                agentNames={agentNames}
                busy={busy}
                onApprove={(reason) => resolveApproval("approve", reason)}
                onReject={(reason) => resolveApproval("reject", reason)}
              />
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
            <CoordinationEmptyState
              hasSelection={selectedId !== null}
              loading={detailsLoading}
              errorMessage={
                detailIssue?.sessionId === selectedId
                  ? detailIssue.message
                  : null
              }
              onRetry={retrySelectedSession}
            />
          )}
        </div>
      </div>
    </section>
  );
}
