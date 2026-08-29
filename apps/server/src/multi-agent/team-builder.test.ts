import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlannerOutput } from "./contracts.js";
import {
  CapabilityTeamBuilder,
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

const capabilityPlan: PlannerOutput = {
  topology: "sequential",
  explanation: "Two specialized tasks.",
  tasks: [
    {
      key: "plan",
      title: "Plan",
      instructions: "Produce a plan",
      dependencies: [],
      requiredCapabilities: ["planning"],
      acceptanceCriteria: [
        {
          id: "plan-output",
          kind: "artifact",
          description: "Structured output",
          value: "worker-output",
        },
      ],
    },
    {
      key: "deliver",
      title: "Deliver",
      instructions: "Ship the result",
      dependencies: ["plan"],
      requiredCapabilities: ["delivery"],
      acceptanceCriteria: [
        {
          id: "deliver-output",
          kind: "artifact",
          description: "Structured output",
          value: "worker-output",
        },
      ],
    },
  ],
};

describe("CapabilityTeamBuilder", () => {
  it("assigns each Task to the highest-scoring Agent by capability", async () => {
    const planner = new CapabilityTeamBuilder();
    const planningId = randomUUID();
    const deliveryId = randomUUID();
    const planningAgent = {
      id: planningId,
      name: "Planner",
      description: "planning and analysis specialist",
      instructions: "Produce bounded plans",
      status: "ready" as const,
    };
    const deliveryAgent = {
      id: deliveryId,
      name: "Builder",
      description: "delivery and implementation specialist",
      instructions: "Ship and verify code",
      status: "ready" as const,
    };

    const output = await planner.select({
      userTask: "Plan then deliver",
      plan: capabilityPlan,
      candidateAgentIds: [planningId, deliveryId],
      candidates: [planningAgent, deliveryAgent],
    });

    expect(output.assignments).toEqual([
      { taskKey: "plan", agentId: planningId },
      { taskKey: "deliver", agentId: deliveryId },
    ]);
  });

  it("falls back to participant order when no candidates are supplied", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const output = await new CapabilityTeamBuilder().select({
      userTask: "Plan then deliver",
      plan: capabilityPlan,
      candidateAgentIds: [firstId, secondId],
    });

    expect(output.assignments).toEqual([
      { taskKey: "plan", agentId: firstId },
      { taskKey: "deliver", agentId: secondId },
    ]);
  });
});
