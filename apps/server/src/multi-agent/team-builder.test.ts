import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlannerOutput } from "./contracts.js";
import {
  ParticipantOrderTeamBuilder,
  validateTeamBuilderOutput,
} from "./team-builder.js";

const plan: PlannerOutput = {
  topology: "sequential",
  explanation: "Execute two Tasks in order.",
  tasks: ["plan", "deliver"].map((key) => ({
    key,
    title: `Task ${key}`,
    instructions: `Complete ${key}`,
    dependencies: key === "deliver" ? ["plan"] : [],
    requiredCapabilities: [],
    acceptanceCriteria: [
      {
        id: `${key}-output`,
        kind: "artifact",
        description: "Produce structured output",
        value: "worker-output",
      },
    ],
  })),
};

describe("ParticipantOrderTeamBuilder", () => {
  it("assigns every Task across participants in stable order", async () => {
    const agents = [randomUUID(), randomUUID()];

    await expect(
      new ParticipantOrderTeamBuilder().select({
        userTask: "Deliver a feature",
        plan,
        candidateAgentIds: agents,
      }),
    ).resolves.toMatchObject({
      participantAgentIds: agents,
      assignments: [
        { taskKey: "plan", agentId: agents[0] },
        { taskKey: "deliver", agentId: agents[1] },
      ],
    });
  });

  it("rejects assignments to an unknown Agent", () => {
    const candidate = randomUUID();

    expect(() =>
      validateTeamBuilderOutput(
        {
          participantAgentIds: [candidate],
          assignments: [
            { taskKey: "plan", agentId: candidate },
            { taskKey: "deliver", agentId: randomUUID() },
          ],
          explanation: "Invalid assignment",
        },
        plan,
        [candidate],
      ),
    ).toThrow(/non-participant/i);
  });
});
