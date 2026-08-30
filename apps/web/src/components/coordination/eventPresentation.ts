import type { CoordinationEvent, CoordinationTask } from "../../types";
import { shortId } from "./presentation";

const titles: Record<string, string> = {
  "session.created": "Session created",
  "session.started": "Execution started",
  "session.completed": "Session completed",
  "session.failed": "Session failed",
  "session.cancelled": "Session cancelled",
  "session.approved": "Human approval recorded",
  "session.rejected": "Human rejection recorded",
  "plan.created": "Plan created",
  "plan.revised": "Plan revised",
  "agent.selected": "Agent selected",
  "task.ready": "Task ready",
  "task.leased": "Task leased",
  "task.started": "Task started",
  "task.succeeded": "Task succeeded",
  "task.failed": "Task failed",
  "task.retried": "Task scheduled for retry",
  "task.reassigned": "Task reassigned",
  "attempt.created": "Attempt created",
  "attempt.started": "Attempt started",
  "attempt.succeeded": "Attempt succeeded",
  "attempt.failed": "Attempt failed",
  "attempt.cancelled": "Attempt cancelled",
  "artifact.created": "Artifact captured",
  "artifact.accepted": "Artifact accepted",
  "artifact.rejected": "Artifact rejected",
  "verification.started": "Verification started",
  "verification.passed": "Verification passed",
  "verification.failed": "Verification failed",
  "recovery.decided": "Recovery decision recorded",
  "integration.completed": "Integration completed",
};

const text = (event: CoordinationEvent, key: string) => {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const number = (event: CoordinationEvent, key: string) => {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const stringList = (event: CoordinationEvent, key: string) => {
  const value = event.payload[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
};

const fallbackDescription = (event: CoordinationEvent) => {
  const entries = Object.entries(event.payload).map(([key, value]) => {
    const rendered = Array.isArray(value)
      ? value.join(", ")
      : value === null
        ? "none"
        : String(value);
    return `${key}: ${rendered}`;
  });
  return entries.join(" · ") || "State transition recorded.";
};

export interface EventPresentation {
  title: string;
  description: string;
}

export function presentCoordinationEvent(
  event: CoordinationEvent,
  tasks: readonly CoordinationTask[],
  agentNames: ReadonlyMap<string, string>,
): EventPresentation {
  const task = tasks.find((item) => item.id === event.taskId);
  const taskName = task?.title ?? (event.taskId ? `Task ${shortId(event.taskId)}` : "Task");
  const agentName = event.agentId
    ? agentNames.get(event.agentId) ?? `Agent ${shortId(event.agentId)}`
    : "Agent";
  const reason = text(event, "reason");
  const error = text(event, "error");
  const failureClass = text(event, "failureClass");

  let description: string | null = null;
  switch (event.type) {
    case "session.created":
      description = `Created a ${text(event, "topology") ?? "coordination"} Session with ${number(event, "taskCount") ?? 0} Tasks.`;
      break;
    case "session.started":
      description = "The accepted plan entered execution.";
      break;
    case "session.completed":
      description = `Completed ${number(event, "completedTaskCount") ?? 0} Tasks.`;
      break;
    case "session.failed":
    case "session.cancelled":
    case "session.approved":
    case "session.rejected":
      description = reason ?? fallbackDescription(event);
      break;
    case "plan.created":
    case "plan.revised":
      description = text(event, "explanation") ?? fallbackDescription(event);
      break;
    case "agent.selected":
      description = `${agentName} was selected for ${taskName}. ${text(event, "explanation") ?? ""}`.trim();
      break;
    case "task.ready":
      description = `${taskName} has no unresolved dependencies.`;
      break;
    case "task.leased":
      description = `${taskName} was leased for Attempt ${number(event, "attemptCount") ?? "unknown"}.`;
      break;
    case "task.started":
      description = `${agentName} started ${taskName}.`;
      break;
    case "task.succeeded":
      description = `${taskName} completed successfully.`;
      break;
    case "task.failed":
      description = `${taskName} failed and entered recovery evaluation.`;
      break;
    case "task.retried":
      description = `${taskName} will retry. ${reason ?? ""}`.trim();
      break;
    case "task.reassigned":
      description = `${taskName} was reassigned to ${agentName}. ${reason ?? ""}`.trim();
      break;
    case "attempt.created":
      description = `A new Attempt was created for ${taskName}.`;
      break;
    case "attempt.started":
      description = `${agentName} started an Attempt for ${taskName}.`;
      break;
    case "attempt.succeeded":
      description = text(event, "summary") ?? `${taskName} produced an accepted output.`;
      break;
    case "attempt.failed":
      description = `${failureClass ?? "Execution failure"}: ${error ?? "No error detail recorded."}`;
      break;
    case "attempt.cancelled":
      description = `The active Attempt for ${taskName} was cancelled.`;
      break;
    case "verification.started":
      description = `Verification started for ${taskName}.`;
      break;
    case "verification.passed": {
      const evidence = stringList(event, "evidence");
      description = evidence?.length
        ? `Accepted ${taskName}: ${evidence.join(" · ")}`
        : `${taskName} passed verification.`;
      break;
    }
    case "verification.failed":
      description = `${failureClass ?? "Verification failure"}: ${error ?? "No error detail recorded."}`;
      break;
    case "artifact.created":
      description = `Captured ${text(event, "sourcePath") ?? text(event, "type") ?? "an Artifact"} for ${taskName}.`;
      break;
    case "artifact.accepted":
      description = `Accepted an Artifact produced by ${taskName}.`;
      break;
    case "artifact.rejected":
      description = `Rejected an Artifact produced by ${taskName}.`;
      break;
    case "recovery.decided": {
      const action = text(event, "action")?.replaceAll("_", " ") ?? "unknown action";
      const nextAgentId = text(event, "nextAgentId");
      const target = nextAgentId
        ? agentNames.get(nextAgentId) ?? `Agent ${shortId(nextAgentId)}`
        : null;
      description = `${action}${target ? ` with ${target}` : ""}: ${reason ?? "No reason recorded."}`;
      break;
    }
    default:
      description = fallbackDescription(event);
  }

  return {
    title: titles[event.type] ?? event.type.replaceAll(".", " "),
    description,
  };
}
