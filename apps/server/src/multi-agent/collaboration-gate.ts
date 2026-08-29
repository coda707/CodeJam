import type { CoordinationTopology } from "./contracts.js";

export interface CollaborationGateDecision {
  topology: CoordinationTopology;
  singleAgent: boolean;
  explanation: string;
}

const PARALLEL_HINTS = [
  "independent",
  "in parallel",
  "parallel",
  "multiple ",
  "several ",
  "each ",
  "separately",
];

const SEQUENTIAL_HINTS = ["then", "after", "first ", "next ", "finally", "stage"];

const RISK_HINTS = ["test", "verify", "security", "refactor", "migration", "audit"];

const SPLIT_HINTS = [" and ", ", ", "\n", ";"];

/**
 * Deterministic collaboration gate. The LLM-free heuristic decides whether a
 * single Agent suffices or a multi-Agent topology is warranted, and picks the
 * topology. The explanation is surfaced to the UI so reviewers can follow the
 * decision, matching the "collaboration decision and explanation" requirement.
 */
export class HeuristicCollaborationGate {
  decide(userTask: string, participantCount = 0): CollaborationGateDecision {
    const normalized = userTask.toLowerCase();

    const riskScore = RISK_HINTS.filter((hint) => normalized.includes(hint)).length;
    const parallelScore = PARALLEL_HINTS.filter((hint) =>
      normalized.includes(hint),
    ).length;
    const sequentialScore = SEQUENTIAL_HINTS.filter((hint) =>
      normalized.includes(hint),
    ).length;
    const splitScore = SPLIT_HINTS.filter((hint) => normalized.includes(hint)).length;

    const decomposable =
      splitScore >= 2 ||
      parallelScore > 0 ||
      sequentialScore > 0 ||
      normalized.length > 400;

    if (!decomposable && participantCount <= 1) {
      return {
        topology: "single",
        singleAgent: true,
        explanation:
          "The task is small and shows no decomposition signals, so a single Agent is the lowest-coordination-cost choice.",
      };
    }

    if (parallelScore > 0 && riskScore > 0) {
      return {
        topology: "dag",
        singleAgent: false,
        explanation:
          "The task combines independent work items with verification risk, so a DAG with a convergence step is the safest topology.",
      };
    }

    if (parallelScore > 0) {
      return {
        topology: "parallel",
        singleAgent: false,
        explanation:
          "The task lists several independent work items, so they can proceed in parallel before a convergence step.",
      };
    }

    if (riskScore > 0 && sequentialScore > 0) {
      return {
        topology: "sequential",
        singleAgent: false,
        explanation:
          "The task has ordered stages plus verification risk, so a sequential plan with a final verification step is appropriate.",
      };
    }

    return {
      topology: "sequential",
      singleAgent: false,
      explanation:
        "The task shows ordered dependencies, so it is planned as a sequential pipeline.",
    };
  }
}
