import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../errors.js";
import type { CoordinationArtifact, FailureClass } from "./contracts.js";
import type {
  ArtifactCaptureResult,
  ArtifactContent,
  CoordinationArtifactRepository,
  TaskExecutionRequest,
} from "./ports.js";
import type { CoordinationStore } from "./coordination-store.js";

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTEMPT_ARTIFACT_BYTES = 8 * 1024 * 1024;

interface PreparedArtifact {
  record: CoordinationArtifact;
  content: Buffer;
  destination: string;
}

class ArtifactCaptureFailure extends Error {
  constructor(
    message: string,
    readonly failureClass: FailureClass,
  ) {
    super(message);
  }
}

export class NoopCoordinationArtifactRepository
  implements CoordinationArtifactRepository
{
  async capture(): Promise<ArtifactCaptureResult> {
    return { status: "captured", artifacts: [] };
  }

  async readArtifact(): Promise<ArtifactContent | null> {
    return null;
  }
}

export class FileCoordinationArtifactStore
  implements CoordinationArtifactRepository
{
  constructor(
    private readonly root: string,
    private readonly store: CoordinationStore,
    private readonly resolveAgentWorkspace: (agentId: string) => string,
  ) {}

  async capture(
    request: TaskExecutionRequest,
    output: { artifactPaths: string[] },
  ): Promise<ArtifactCaptureResult> {
    try {
      const uniquePaths = [...new Set(output.artifactPaths)];
      if (uniquePaths.length === 0) return { status: "captured", artifacts: [] };
      const agentId = request.attempt.agentId;
      if (!agentId) {
        throw new ArtifactCaptureFailure(
          "Artifacts require an assigned producer Agent",
          "agent_capability_mismatch",
        );
      }

      const workspace = await realpath(this.resolveAgentWorkspace(agentId));
      const prepared: PreparedArtifact[] = [];
      let totalBytes = 0;
      for (const sourcePath of uniquePaths) {
        const item = await this.prepareArtifact(request, agentId, workspace, sourcePath);
        totalBytes += item.content.byteLength;
        if (totalBytes > MAX_ATTEMPT_ARTIFACT_BYTES) {
          throw new ArtifactCaptureFailure(
            `Attempt artifacts exceed ${MAX_ATTEMPT_ARTIFACT_BYTES} bytes`,
            "budget_exceeded",
          );
        }
        prepared.push(item);
      }

      const written: string[] = [];
      try {
        for (const item of prepared) {
          await mkdir(path.dirname(item.destination), { recursive: true });
          const temporary = `${item.destination}.tmp-${randomUUID()}`;
          try {
            await writeFile(temporary, item.content, { flag: "wx", mode: 0o600 });
            await rename(temporary, item.destination);
          } finally {
            await rm(temporary, { force: true });
          }
          written.push(item.destination);
        }
        const artifacts = prepared.map((item) => item.record);
        await this.store.createArtifacts(artifacts);
        return { status: "captured", artifacts };
      } catch (error) {
        await Promise.all(written.map((file) => rm(file, { force: true })));
        throw error;
      }
    } catch (error) {
      return {
        status: "rejected",
        failureClass:
          error instanceof ArtifactCaptureFailure ? error.failureClass : "tool_error",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
      };
    }
  }

  async readArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactContent | null> {
    let records: CoordinationArtifact[];
    try {
      records = this.store.getArtifacts(sessionId);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return null;
      throw error;
    }
    const record = records.find((artifact) => artifact.id === artifactId);
    if (!record || record.sessionId !== sessionId || !record.path) return null;

    const candidate = path.join(this.root, ...record.path.split("/"));
    const source = await realpath(candidate).catch(() => null);
    if (!source) return null;
    const storageRoot = await realpath(this.root).catch(() => null);
    if (!storageRoot) return null;
    const relative = path.relative(storageRoot, source);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    const details = await lstat(source).catch(() => null);
    if (!details || details.isSymbolicLink() || !details.isFile()) return null;
    if (details.size > MAX_ARTIFACT_BYTES) return null;

    const content = (await readFile(source, "utf8")).slice(0, MAX_ARTIFACT_BYTES);
    return {
      content: redactSecrets(content),
      ...(record.sourcePath ? { sourcePath: record.sourcePath } : {}),
      contentHash: record.contentHash,
    };
  }

  private async prepareArtifact(
    request: TaskExecutionRequest,
    agentId: string,
    workspace: string,
    sourcePath: string,
  ): Promise<PreparedArtifact> {
    if (
      !sourcePath.trim() ||
      path.isAbsolute(sourcePath) ||
      sourcePath.split(/[\\/]/).includes("..")
    ) {
      throw new ArtifactCaptureFailure(
        `Unsafe artifact path: ${sourcePath || "<empty>"}`,
        "unsafe_action",
      );
    }
    const candidate = path.resolve(workspace, sourcePath);
    const source = await realpath(candidate).catch(() => {
      throw new ArtifactCaptureFailure(
        `Artifact does not exist: ${sourcePath}`,
        "malformed_output",
      );
    });
    const relative = path.relative(workspace, source);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ArtifactCaptureFailure(
        `Artifact escapes the Agent workspace: ${sourcePath}`,
        "unsafe_action",
      );
    }
    const details = await lstat(candidate);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new ArtifactCaptureFailure(
        `Artifact must be a regular file: ${sourcePath}`,
        "unsafe_action",
      );
    }
    if (details.size > MAX_ARTIFACT_BYTES) {
      throw new ArtifactCaptureFailure(
        `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes: ${sourcePath}`,
        "budget_exceeded",
      );
    }

    const content = await readFile(source);
    const id = randomUUID();
    const safeName = path.basename(relative).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storedPath = path.posix.join(
      request.session.id,
      request.attempt.id,
      `${id}-${safeName || "artifact"}`,
    );
    return {
      content,
      destination: path.join(this.root, ...storedPath.split("/")),
      record: {
        id,
        sessionId: request.session.id,
        taskId: request.task.id,
        producerAgentId: agentId,
        attemptId: request.attempt.id,
        type: inferArtifactType(relative),
        schemaVersion: 1,
        sourcePath: relative.split(path.sep).join("/"),
        path: storedPath,
        contentHash: createHash("sha256").update(content).digest("hex"),
        verificationStatus: "unverified",
        createdAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Redacts common secret shapes from Artifact content before it is ever exposed
 * through the evidence UI or served back to a browser. This is a conservative
 * text-level guard; it is not a substitute for never persisting secrets.
 */
export function redactSecrets(content: string): string {
  return content
    .replace(/\b(sk|sk-ant|sk-ark|ark)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}\b/gi, "$1[REDACTED_TOKEN]")
    .replace(
      /(api[_-]?key\s*[:=]\s*)[^\s"'`,;]+/gi,
      "$1[REDACTED_KEY]",
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    );
}

function inferArtifactType(relativePath: string): CoordinationArtifact["type"] {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".patch") || lower.endsWith(".diff")) return "patch";
  if (/test|junit|coverage/.test(lower)) return "test_report";
  if (/review/.test(lower)) return "review";
  return "report";
}
