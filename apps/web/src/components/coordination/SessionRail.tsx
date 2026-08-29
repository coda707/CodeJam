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
  usesRealAgents: boolean;
  onUserTaskChange: (value: string) => void;
  onToggleParticipant: (agentId: string) => void;
  onCreate: (event: FormEvent) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionRail({
  agents,
  sessions,
  selectedId,
  participantIds,
  userTask,
  busy,
  loading,
  usesRealAgents,
  onUserTaskChange,
  onToggleParticipant,
  onCreate,
  onSelect,
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
      <div className="coordination-session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={session.id === selectedId ? "selected" : ""}
            onClick={() => onSelect(session.id)}
          >
            <strong>{session.userTask}</strong>
            <span>
              {shortId(session.id)} / {session.status}
            </span>
          </button>
        ))}
        {!loading && sessions.length === 0 && (
          <p className="coordination-empty">
            Create the first Session to see its DAG.
          </p>
        )}
      </div>
    </aside>
  );
}
