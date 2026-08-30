import type { FormEvent } from "react";
import type { Agent, CoordinationSession } from "../../types";
import { shortId } from "./presentation";

interface SessionRailProps {
  agents: Agent[];
  sessions: CoordinationSession[];
  selectedId: string | null;
  participantIds: string[];
  userTask: string;
  busy: boolean;
  loading: boolean;
  listUnavailable: boolean;
  usesRealAgents: boolean;
  onUserTaskChange: (value: string) => void;
  onToggleParticipant: (agentId: string) => void;
  onCreate: (event: FormEvent) => void;
  onSelect: (sessionId: string) => void;
  onRetrySessions: () => void;
}

export function SessionRail({
  agents,
  sessions,
  selectedId,
  participantIds,
  userTask,
  busy,
  loading,
  listUnavailable,
  usesRealAgents,
  onUserTaskChange,
  onToggleParticipant,
  onCreate,
  onSelect,
  onRetrySessions,
}: SessionRailProps) {
  return (
    <aside className="coordination-panel coordination-create-panel">
      <form onSubmit={onCreate}>
        <span className="eyebrow">New Session</span>
        <h2>Coordinate a task</h2>
        <label>
          User task
          <textarea
            value={userTask}
            onChange={(event) => onUserTaskChange(event.target.value)}
            placeholder="Describe a task for MOSAIC to coordinate..."
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
                  onChange={() => onToggleParticipant(agent.id)}
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
            loading ||
            !userTask.trim() ||
            (usesRealAgents && participantIds.length === 0)
          }
        >
          Create Session
        </button>
      </form>

      <div className="session-list-heading">
        <span>Sessions</span>
        <span>{sessions.length}</span>
      </div>
      <nav className="coordination-session-list" aria-label="Coordination sessions">
        {sessions.map((session) => (
          <button
            type="button"
            key={session.id}
            className={session.id === selectedId ? "selected" : ""}
            aria-current={session.id === selectedId ? "page" : undefined}
            onClick={() => onSelect(session.id)}
          >
            <strong>{session.userTask}</strong>
            <span>
              {shortId(session.id)} / {session.status}
            </span>
          </button>
        ))}
        {!loading && sessions.length === 0 && listUnavailable && (
          <div className="coordination-list-error" role="status">
            <p>Session history is unavailable.</p>
            <button
              type="button"
              className="button button-ghost"
              onClick={onRetrySessions}
            >
              Retry Sessions
            </button>
          </div>
        )}
        {!loading && sessions.length === 0 && !listUnavailable && (
          <p className="coordination-empty">
            Create the first Session to see its DAG.
          </p>
        )}
      </nav>
    </aside>
  );
}
