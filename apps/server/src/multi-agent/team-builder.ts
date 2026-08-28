import { HttpError } from "../errors.js";
import {
  teamBuilderOutputSchema,
  type PlannerOutput,
  type TeamBuilderOutput,
} from "./contracts.js";
import type {
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
