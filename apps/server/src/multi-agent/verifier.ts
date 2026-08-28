import type {
  CoordinationVerifier,
  VerificationRequest,
  VerificationResult,
} from "./ports.js";

export class MechanicalCoordinationVerifier implements CoordinationVerifier {
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    if (request.output.unresolvedIssues.length > 0) {
      return {
        status: "rejected",
        failureClass: "no_progress",
        evidence: request.output.unresolvedIssues.map(
          (issue) => `Unresolved issue: ${issue}`,
        ),
      };
    }

    const failures: string[] = [];
    for (const criterion of request.task.acceptanceCriteria) {
      if (criterion.kind === "artifact") {
        const satisfied =
          criterion.value === "worker-output" ||
          request.artifacts.some(
            (artifact) =>
              artifact.type === criterion.value ||
              artifact.sourcePath === criterion.value,
          );
        if (!satisfied) failures.push(`Missing Artifact: ${criterion.value}`);
      } else if (criterion.kind === "file_exists") {
        if (!request.artifacts.some((artifact) => artifact.sourcePath === criterion.value)) {
          failures.push(`Missing captured file: ${criterion.value}`);
        }
      } else {
        failures.push(
          `${criterion.kind} criterion requires an explicitly configured verifier: ${criterion.id}`,
        );
      }
    }

    if (failures.length > 0) {
      return { status: "rejected", failureClass: "test_failure", evidence: failures };
    }
    return {
      status: "accepted",
      evidence: [
        "WorkerOutput schema accepted",
        ...request.artifacts.map(
          (artifact) =>
            `${artifact.sourcePath ?? artifact.path ?? artifact.id}:sha256:${artifact.contentHash}`,
        ),
        ...request.output.evidence,
      ].slice(0, 32),
    };
  }
}
