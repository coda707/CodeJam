import type {
  CoordinationCommandRunner,
  CoordinationVerifier,
  VerificationRequest,
  VerificationResult,
} from "./ports.js";

const DEFAULT_COMMAND_ALLOWLIST = [
  /^npm\s+(test|run\s+test)(\s|$)/i,
  /^npm\s+run\s+build(\s|$)/i,
  /^npx\s+vitest\s+run(\s|$)/i,
  /^node\s+--test(\s|$)/i,
];

export interface MechanicalVerifierOptions {
  commandRunner?: CoordinationCommandRunner;
  commandAllowlist?: RegExp[];
  commandTimeoutMs?: number;
}

/**
 * Mechanical verifier. Besides `artifact`/`file_exists` criteria, it can run a
 * `command` criterion through an injected {@link CoordinationCommandRunner}
 * against an allowlist. Without a runner (or when the command is not allowlisted)
 * a `command` criterion is rejected as "requires an explicitly configured
 * verifier", preserving the foundation default and its tests.
 */
export class MechanicalCoordinationVerifier implements CoordinationVerifier {
  private readonly commandRunner: CoordinationCommandRunner | undefined;
  private readonly allowlist: RegExp[];
  private readonly commandTimeoutMs: number;

  constructor(options: MechanicalVerifierOptions = {}) {
    this.commandRunner = options.commandRunner;
    this.allowlist = options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  }

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
    const commandEvidence: string[] = [];
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
      } else if (criterion.kind === "command") {
        const outcome = await this.runCommandCriterion(criterion.value, request);
        if (outcome.passed) {
          commandEvidence.push(...outcome.evidence);
        } else {
          failures.push(...outcome.evidence);
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
        ...commandEvidence,
        ...request.artifacts.map(
          (artifact) =>
            `${artifact.sourcePath ?? artifact.path ?? artifact.id}:sha256:${artifact.contentHash}`,
        ),
        ...request.output.evidence,
      ].slice(0, 32),
    };
  }

  private async runCommandCriterion(
    command: string,
    request: VerificationRequest,
  ): Promise<{ passed: boolean; evidence: string[] }> {
    if (!this.commandRunner || !request.attempt.agentId) {
      return {
        passed: false,
        evidence: [
          `command criterion requires an explicitly configured verifier and producer Agent: ${command}`,
        ],
      };
    }
    if (!this.allowlist.some((pattern) => pattern.test(command))) {
      return {
        passed: false,
        evidence: [`command not allowlisted for verification: ${command}`],
      };
    }
    try {
      const result = await this.commandRunner.run(
        command,
        request.attempt.agentId,
        this.commandTimeoutMs,
      );
      const passed = result.exitCode === 0;
      const summary = `command "${command}" exited ${result.exitCode}`;
      const detail = [result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1_000);
      return {
        passed,
        evidence: passed
          ? [summary, detail].filter(Boolean)
          : [`${summary}: ${detail || "no output"}`],
      };
    } catch (error) {
      return {
        passed: false,
        evidence: [
          `command failed to run: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}
