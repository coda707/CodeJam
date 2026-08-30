import { HttpError } from "../errors.js";
import {
  recoveryDecisionSchema,
  type FailureClass,
  type RecoveryDecision,
} from "./contracts.js";
import type {
  CoordinationRecoveryPolicy,
  RecoveryPolicyRequest,
} from "./ports.js";

export function validateRecoveryDecision(
  value: unknown,
  request: RecoveryPolicyRequest,
): RecoveryDecision {
  const decision = recoveryDecisionSchema.parse(value);
  if (decision.action === "reassign") {
    if (!decision.nextAgentId) {
      throw new HttpError(400, "Agent reassignment requires nextAgentId");
    }
    if (!request.availableAgentIds.includes(decision.nextAgentId)) {
      throw new HttpError(400, "Recovery policy selected an unknown Agent");
    }
  }
  if (
    ["retry", "reassign"].includes(decision.action) &&
    request.attempts.length >= request.session.budget.maxAttemptsPerTask
  ) {
    throw new HttpError(409, "Task recovery exceeded the Attempt budget");
  }
  return decision;
}

export class StopCoordinationRecoveryPolicy
  implements CoordinationRecoveryPolicy
{
  async decide(): Promise<RecoveryDecision> {
    return {
      action: "stop",
      reason: "A foundation task failed",
    };
  }
}

const RETRY_CLASSES: FailureClass[] = [
  "transient_provider_error",
  "malformed_output",
  "tool_error",
];

const REASSIGN_CLASSES: FailureClass[] = ["timeout", "agent_capability_mismatch"];

export interface ClassificationRecoveryPolicyOptions {
  testFailureAction?: "repair" | "request_approval";
  noProgressAction?: "replan" | "stop";
}

/**
 * Failure-class-aware recovery policy. Maps a classified failure to a targeted
 * action (handout §11): retry transient/malformed/tool failures, reassign
 * timeouts and capability mismatches to a different Agent, create a repair Task
 * for test/acceptance failures, re-plan the unfinished subgraph on no-progress,
 * request human approval for test failures (when opted into), and stop on
 * budget or unsafe cases. It respects the Attempt budget itself so the service
 * never sees an over-budget decision as a 409.
 */
export class ClassificationRecoveryPolicy implements CoordinationRecoveryPolicy {
  private readonly testFailureAction: "repair" | "request_approval";
  private readonly noProgressAction: "replan" | "stop";

  constructor(options: ClassificationRecoveryPolicyOptions = {}) {
    this.testFailureAction = options.testFailureAction ?? "repair";
    this.noProgressAction = options.noProgressAction ?? "replan";
  }

  async decide(request: RecoveryPolicyRequest): Promise<RecoveryDecision> {
    if (request.attempts.length >= request.session.budget.maxAttemptsPerTask) {
      return { action: "stop", reason: "Attempt budget exceeded" };
    }

    const failedAttempt = request.failedAttempt;
    const failureClass = failedAttempt.errorClass ?? "tool_error";
    const available = request.availableAgentIds;

    if (RETRY_CLASSES.includes(failureClass)) {
      return {
        action: "retry",
        reason: `Retrying ${failureClass} failure`,
      };
    }

    if (REASSIGN_CLASSES.includes(failureClass)) {
      const nextAgentId = available.find(
        (agentId) => agentId !== failedAttempt.agentId,
      );
      if (nextAgentId) {
        return {
          action: "reassign",
          reason: `Reassigning after ${failureClass} failure`,
          nextAgentId,
        };
      }
      return {
        action: "retry",
        reason: `No alternative Agent for ${failureClass}; retrying the same Agent`,
      };
    }

    if (failureClass === "test_failure") {
      return this.testFailureAction === "request_approval"
        ? {
            action: "request_approval",
            reason: "Acceptance criteria failed; human approval is required to proceed",
          }
        : {
            action: "repair",
            reason: "Acceptance criteria failed; spawning a repair Task",
          };
    }

    if (failureClass === "no_progress") {
      return this.noProgressAction === "stop"
        ? { action: "stop", reason: "No progress; stopping" }
        : { action: "replan", reason: "No progress; re-planning the unfinished subgraph" };
    }

    return {
      action: "stop",
      reason: `Unrecoverable failure class: ${failureClass}`,
    };
  }
}
