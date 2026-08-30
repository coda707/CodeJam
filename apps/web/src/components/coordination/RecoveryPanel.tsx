import { useState, type FormEvent } from "react";
import type {
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
} from "../../types";
import { shortId } from "./presentation";
import { CopyIdentifier } from "./CopyIdentifier";

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
  const decision = findLatest(
    events,
    (event) => event.type === "recovery.decided",
  );
  const failedAttempt =
    attempts.find((attempt) => attempt.id === decision?.attemptId) ??
    findLatest(attempts, (attempt) =>
      ["failed", "timed_out"].includes(attempt.status),
    );
  const followUpAttempt = failedAttempt
    ? attempts.find((attempt) => attempt.retryOfAttemptId === failedAttempt.id)
    : undefined;
  const humanDecision = decision
    ? findLatest(
        events,
        (event) =>
          event.createdAt >= decision.createdAt &&
          ["session.approved", "session.rejected"].includes(event.type),
      )
    : undefined;
  const task = tasks.find(
    (item) => item.id === (decision?.taskId ?? failedAttempt?.taskId),
  );
  const action = payloadText(decision, "action");
  const decisionReason = payloadText(decision, "reason");
  const nextAgentId = payloadText(decision, "nextAgentId");
  const waiting = session.status === "waiting_approval";
  const outcomeTitle = waiting
    ? "Awaiting human decision"
    : humanDecision?.type === "session.rejected"
      ? "Rejected and stopped"
      : followUpAttempt
        ? `Follow-up ${followUpAttempt.status}`
        : humanDecision?.type === "session.approved"
          ? "Approved; execution resumed"
          : session.status === "failed"
            ? "Session failed"
            : session.status === "completed"
              ? "Session completed"
              : "Recovery in progress";
  const outcomeReason = payloadText(humanDecision, "reason");

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

      <div className="recovery-flow" aria-label="Recovery evidence chain">
        <section>
          <span>1 · Failure</span>
          <strong>{task?.title ?? "Session-level recovery"}</strong>
          {failedAttempt && (
            <CopyIdentifier
              label="failed Attempt ID"
              value={failedAttempt.id}
              compact
            />
          )}
          <small>{failedAttempt?.errorClass ?? "Failure class unavailable"}</small>
          {failedAttempt?.errorMessage && <small>{failedAttempt.errorMessage}</small>}
        </section>
        <span className="recovery-flow-arrow" aria-hidden="true">→</span>
        <section>
          <span>2 · Decision</span>
          <strong>{action?.replaceAll("_", " ") ?? "Decision unavailable"}</strong>
          <small>{decisionReason ?? session.failureReason ?? "No reason recorded."}</small>
          {nextAgentId && (
            <CopyIdentifier label="recovery Agent ID" value={nextAgentId} compact />
          )}
          {nextAgentId && (
            <small>{agentNames.get(nextAgentId) ?? shortId(nextAgentId)}</small>
          )}
        </section>
        <span className="recovery-flow-arrow" aria-hidden="true">→</span>
        <section>
          <span>3 · Outcome</span>
          <strong>{outcomeTitle}</strong>
          {followUpAttempt && (
            <CopyIdentifier
              label="follow-up Attempt ID"
              value={followUpAttempt.id}
              compact
            />
          )}
          {outcomeReason && <small>{outcomeReason}</small>}
        </section>
      </div>

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
