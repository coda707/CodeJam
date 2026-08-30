import type {
  CoordinationCommandRunner,
  CoordinationVerifier,
  VerificationRequest,
  VerificationResult,
} from "./ports.js";

const UNSAFE_SHELL_SYNTAX = /[;&|><`$()\r\n]/;

export interface VerificationCommand {
  executable: "npm" | "npx" | "node";
  args: string[];
}

/** Parse only argv-style test/build commands; no shell is involved. */
export function parseVerificationCommand(command: string): VerificationCommand | null {
  const normalized = command.trim();
  if (!normalized || UNSAFE_SHELL_SYNTAX.test(normalized)) return null;
  const tokens = normalized.split(/\s+/);
  const [executable, ...args] = tokens;
  const prefix = [executable, ...args.slice(0, 2)].join(" ").toLowerCase();
  const allowed =
    (executable === "npm" && args[0] === "test") ||
    (executable === "npm" && args[0] === "run" && ["test", "build", "check"].includes(args[1] ?? "")) ||
    (prefix === "npx vitest run") ||
    (executable === "node" && args[0] === "--test");
  if (!allowed) return null;
  // Options and paths are passed directly to execFile. Quoting is deliberately
  // unsupported so the displayed command exactly matches the executed argv.
  if (args.some((arg) => !/^[A-Za-z0-9_./:@=,+-]+$/.test(arg))) return null;
  return { executable: executable as VerificationCommand["executable"], args };
}

export interface MechanicalVerifierOptions {
  commandRunner?: CoordinationCommandRunner;
  commandTimeoutMs?: number;
  /** Require the completion proof to contain a captured hash and a passing command. */
  requireStrongEvidence?: boolean;
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
  private readonly commandTimeoutMs: number;
  private readonly requireStrongEvidence: boolean;

  constructor(options: MechanicalVerifierOptions = {}) {
    this.commandRunner = options.commandRunner;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    this.requireStrongEvidence = options.requireStrongEvidence ?? false;
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
    const hasCommandCriterion = request.task.acceptanceCriteria.some(
      (criterion) => criterion.kind === "command",
    );
    if (this.requireStrongEvidence && request.artifacts.length === 0) {
      failures.push("Completion requires at least one captured file with a SHA-256 hash");
    }
    if (this.requireStrongEvidence && !hasCommandCriterion) {
      failures.push("Completion requires at least one test command criterion");
    }
    for (const criterion of request.task.acceptanceCriteria) {
      if (criterion.kind === "artifact") {
        const satisfied = request.artifacts.some(
            (artifact) =>
              (criterion.value === "any-file") ||
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
    if (!parseVerificationCommand(command)) {
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

/** Explicitly non-production verifier used only by the deterministic fake executor. */
export class SimulationCoordinationVerifier implements CoordinationVerifier {
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    return request.output.unresolvedIssues.length === 0
      ? { status: "accepted", evidence: ["Simulation output accepted"] }
      : {
          status: "rejected",
          failureClass: "no_progress",
          evidence: request.output.unresolvedIssues,
        };
  }
}
