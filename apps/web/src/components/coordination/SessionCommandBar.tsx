import type { CoordinationSession } from "../../types";
import { activeSessionStatuses, shortId } from "./presentation";

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
        <span className="eyebrow">Session {shortId(session.id)}</span>
        <h2>{session.userTask}</h2>
        <div className="session-metadata">
          <span>{session.topology}</span>
          <span>{session.participantAgentIds.length} participants</span>
          <span>{attemptCount} attempts</span>
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
