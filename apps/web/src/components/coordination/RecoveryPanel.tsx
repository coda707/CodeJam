import { useState, type FormEvent } from "react";
import type {
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
} from "../../types";
import { shortId } from "./presentation";

interface RecoveryPanelProps {
  session: CoordinationSession;
  tasks: CoordinationTask[];
  attempts: CoordinationAttempt[];
  events: CoordinationEvent[];
  agentNames: Map<string, string>;
  busy: boolean;
  onApprove: (reason: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}

const payloadText = (event: CoordinationEvent | undefined, key: string) => {
  const value = event?.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const findLatest = <T,>(items: T[], predicate: (item: T) => boolean) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) return item;
  }
  return undefined;
};

export function RecoveryPanel({
  session,
  tasks,
  attempts,
  events,
  agentNames,
  busy,
  onApprove,
  onReject,
}: RecoveryPanelProps) {
  const [reason, setReason] = useState("");
  const failedAttempt = findLatest(attempts, (attempt) =>
    ["failed", "timed_out"].includes(attempt.status),
  );
  const decision = findLatest(
    events,
    (event) => event.type === "recovery.decided",
  );
  const task = tasks.find(
    (item) => item.id === (decision?.taskId ?? failedAttempt?.taskId),
  );
  const action = payloadText(decision, "action");
  const decisionReason = payloadText(decision, "reason");
  const nextAgentId = payloadText(decision, "nextAgentId");
  const waiting = session.status === "waiting_approval";

  if (!waiting && !decision && !failedAttempt) return null;

  const submitApproval = async (event: FormEvent) => {
    event.preventDefault();
    const value = reason.trim();
    if (!value) return;
    await onApprove(value);
  };

  return (
    <article className="coordination-panel recovery-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Recovery</span>
          <h2>{waiting ? "Human decision required" : "Recovery evidence"}</h2>
        </div>
        {action && <span className="recovery-action">{action}</span>}
      </div>

      <div className="recovery-context">
        <div>
          <span>Task</span>
          <strong>{task?.title ?? "Session-level recovery"}</strong>
          {task && <small>{task.id}</small>}
        </div>
        <div>
          <span>Failed Attempt</span>
          <strong>
            {failedAttempt ? shortId(failedAttempt.id) : "Not recorded"}
          </strong>
          {failedAttempt && <small>{failedAttempt.id}</small>}
        </div>
        <div>
          <span>Failure class</span>
          <strong>{failedAttempt?.errorClass ?? "Unavailable"}</strong>
          {failedAttempt?.errorMessage && <small>{failedAttempt.errorMessage}</small>}
        </div>
        <div>
          <span>Recovery target</span>
          <strong>
            {nextAgentId
              ? agentNames.get(nextAgentId) ?? shortId(nextAgentId)
              : "Current assignment"}
          </strong>
          {nextAgentId && <small>{nextAgentId}</small>}
        </div>
      </div>

      <p className="recovery-reason">
        {decisionReason ?? session.failureReason ?? "No recovery reason recorded."}
      </p>

      {waiting && (
        <form className="approval-form" onSubmit={submitApproval}>
          <label htmlFor={`approval-reason-${session.id}`}>Decision reason</label>
          <textarea
            id={`approval-reason-${session.id}`}
            value={reason}
            maxLength={2000}
            required
            disabled={busy}
            placeholder="Record why this Session should continue or stop"
            onChange={(event) => setReason(event.target.value)}
          />
          <div>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !reason.trim()}
            >
              {busy ? "Submitting..." : "Approve and Continue"}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={busy || !reason.trim()}
              onClick={() => void onReject(reason.trim())}
            >
              Reject and Stop
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
