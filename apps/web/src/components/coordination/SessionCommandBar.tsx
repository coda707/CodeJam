import type { CoordinationSession } from "../../types";
import { activeSessionStatuses } from "./presentation";
import { CopyIdentifier } from "./CopyIdentifier";

interface SessionCommandBarProps {
  session: CoordinationSession;
  attemptCount: number;
  busy: boolean;
  usesRealAgents: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function SessionCommandBar({
  session,
  attemptCount,
  busy,
  usesRealAgents,
  onStart,
  onStop,
}: SessionCommandBarProps) {
  return (
    <article className="coordination-panel session-summary">
      <div>
        <span className="eyebrow">
          Session <CopyIdentifier label="Session ID" value={session.id} compact />
        </span>
        <h2>{session.userTask}</h2>
        <div className="session-metadata">
          <span>{session.topology}</span>
          <span>{session.participantAgentIds.length} participants</span>
          <span>{attemptCount} attempts</span>
          <span>{session.budget.maxConcurrentTasks} concurrent</span>
          <span>{session.budget.maxAttemptsPerTask} attempts / Task</span>
          <span>{session.budget.maxAgentCalls} call limit</span>
          {session.budget.deadlineAt && (
            <span>Deadline {new Date(session.budget.deadlineAt).toLocaleString()}</span>
          )}
        </div>
      </div>
      <div className="session-controls">
        <span className={`coordination-status status-${session.status}`}>
          {session.status}
        </span>
        {session.status === "planning" && (
          <button
            className="button button-primary"
            onClick={onStart}
            disabled={
              busy ||
              (usesRealAgents && session.participantAgentIds.length === 0)
            }
          >
            Start Session
          </button>
        )}
        {activeSessionStatuses.has(session.status) && (
          <button
            className="button button-danger"
            onClick={onStop}
            disabled={busy}
          >
            Stop
          </button>
        )}
      </div>
    </article>
  );
}
