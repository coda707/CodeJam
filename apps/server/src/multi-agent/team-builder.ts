import { HttpError } from "../errors.js";
import {
  teamBuilderOutputSchema,
  type PlannerOutput,
  type TeamBuilderOutput,
} from "./contracts.js";
import type {
  AgentDescriptor,
  CoordinationTeamBuilder,
  CoordinationTeamBuilderRequest,
} from "./ports.js";

export function validateTeamBuilderOutput(
  value: unknown,
  plan: PlannerOutput,
  candidateAgentIds: string[],
): TeamBuilderOutput {
  const output = teamBuilderOutputSchema.parse(value);
  const candidates = new Set(candidateAgentIds);
  const participants = new Set(output.participantAgentIds);
  if (participants.size !== output.participantAgentIds.length) {
    throw new HttpError(400, "Team builder output contains duplicate participants");
  }
  for (const participant of participants) {
    if (!candidates.has(participant)) {
      throw new HttpError(400, "Team builder selected an unknown Agent");
    }
  }

  const taskKeys = new Set(plan.tasks.map((task) => task.key));
  const assignedTaskKeys = new Set<string>();
  for (const assignment of output.assignments) {
    if (!taskKeys.has(assignment.taskKey)) {
      throw new HttpError(400, "Team builder assigned an unknown Task");
    }
    if (!participants.has(assignment.agentId)) {
      throw new HttpError(400, "Team builder assigned a non-participant Agent");
    }
    if (assignedTaskKeys.has(assignment.taskKey)) {
      throw new HttpError(400, "Team builder assigned a Task more than once");
    }
    assignedTaskKeys.add(assignment.taskKey);
  }
  if (participants.size > 0 && assignedTaskKeys.size !== plan.tasks.length) {
    throw new HttpError(400, "Team builder must assign every planned Task");
  }
  if (participants.size === 0 && output.assignments.length > 0) {
    throw new HttpError(400, "Team builder cannot assign Tasks without participants");
  }
  return output;
}

export class ParticipantOrderTeamBuilder implements CoordinationTeamBuilder {
  async select(
    request: CoordinationTeamBuilderRequest,
  ): Promise<TeamBuilderOutput> {
    const participantAgentIds = [...new Set(request.candidateAgentIds)];
    const assignments = participantAgentIds.length
      ? request.plan.tasks.map((task, index) => ({
          taskKey: task.key,
          agentId: participantAgentIds[index % participantAgentIds.length]!,
        }))
      : [];
    return validateTeamBuilderOutput(
      {
        participantAgentIds,
        assignments,
        explanation: participantAgentIds.length
          ? "Tasks are assigned to selected Agents in participant order."
          : "No Agents were supplied, so the executor will run without an Agent assignment.",
      },
      request.plan,
      request.candidateAgentIds,
    );
  }
}

const capabilityTokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter(Boolean),
  );

function capabilityScore(candidate: AgentDescriptor, required: string[]): number {
  if (required.length === 0) return 1;
  const profile = capabilityTokens(
    [candidate.name, candidate.description, candidate.instructions].join(" "),
  );
  const matched = required.filter((capability) => {
    const tokens = capabilityTokens(capability);
    if (tokens.size === 0) return false;
    return [...tokens].every((token) =>
      [...profile].some((word) => word === token || word.includes(token)),
    );
  }).length;
  return matched / required.length;
}

function selectionScore(candidate: AgentDescriptor, required: string[]): number {
  let score = capabilityScore(candidate, required);
  if (candidate.status === "busy") score -= 0.5;
  if (candidate.status === "stopped" || candidate.status === "error") score -= 1;
  return score;
}

/**
 * Capability-based Team Builder. Scores each candidate Agent against a Task's
 * `requiredCapabilities` using their name, description and instructions, with a
 * small reliability adjustment for status. When no candidates are supplied or
 * every score is at the participant-order floor, it falls back to the stable
 * participant-order assignment so the fake path keeps working.
 */
export class CapabilityTeamBuilder implements CoordinationTeamBuilder {
  async select(
    request: CoordinationTeamBuilderRequest,
  ): Promise<TeamBuilderOutput> {
    const participantAgentIds = [...new Set(request.candidateAgentIds)];
    const candidates = request.candidates?.filter((candidate) =>
      participantAgentIds.includes(candidate.id),
    );

    if (!candidates || candidates.length === 0) {
      return new ParticipantOrderTeamBuilder().select(request);
    }

    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const assignments = request.plan.tasks.map((task) => {
      let bestAgentId = participantAgentIds[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const agentId of participantAgentIds) {
        const candidate = byId.get(agentId);
        if (!candidate) continue;
        const score = selectionScore(candidate, task.requiredCapabilities);
        if (score > bestScore) {
          bestScore = score;
          bestAgentId = agentId;
        }
      }
      return { taskKey: task.key, agentId: bestAgentId! };
    });

    const allFloor = assignments.every((assignment, index) => {
      const participantId = participantAgentIds[index % participantAgentIds.length];
      return assignment.agentId === participantId;
    });

    return validateTeamBuilderOutput(
      {
        participantAgentIds,
        assignments,
        explanation:
          candidates.length > 0 && !allFloor
            ? "Tasks are assigned to the highest-scoring Agent by capability match."
            : "Capability scores were inconclusive, so Tasks were assigned in participant order.",
      },
      request.plan,
      request.candidateAgentIds,
    );
  }
}
