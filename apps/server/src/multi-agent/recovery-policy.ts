import { HttpError } from "../errors.js";
import {
  recoveryDecisionSchema,
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
