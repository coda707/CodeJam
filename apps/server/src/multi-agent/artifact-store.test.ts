import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../store.js";
import { FileCoordinationArtifactStore } from "./artifact-store.js";
import type { CoordinationSession, TaskAttempt, TaskNode } from "./contracts.js";
import { CoordinationStore } from "./coordination-store.js";

const temporaryDirectories: string[] = [];
const timestamp = "2026-08-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-store-test-"));
  temporaryDirectories.push(root);
  const workspace = path.join(root, "workspace");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(workspace, { recursive: true });
  const jsonStore = new JsonStore(path.join(root, "database.json"));
  await jsonStore.initialize();
  const store = new CoordinationStore(jsonStore);
  const agentId = randomUUID();
  const session: CoordinationSession = {
    id: randomUUID(),
    userTask: "Capture real evidence",
    status: "executing",
    topology: "sequential",
    participantAgentIds: [agentId],
    rootTraceId: randomUUID(),
    budget: {
      maxTasks: 8,
      maxConcurrentTasks: 2,
      maxAttemptsPerTask: 2,
      maxAgentCalls: 8,
      maxEvents: 500,
    },
    createdAt: timestamp,
  };
  const task: TaskNode = {
    id: randomUUID(),
    sessionId: session.id,
    title: "Produce a report",
    instructions: "Write the report",
    dependencies: [],
    requiredCapabilities: ["reporting"],
    acceptanceCriteria: [
      {
        id: "report",
        kind: "file_exists",
        description: "Report exists",
        value: "reports/result.txt",
      },
    ],
    status: "running",
    assignedAgentId: agentId,
    attemptCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const attempt: TaskAttempt = {
    id: randomUUID(),
    sessionId: session.id,
    taskId: task.id,
    agentId,
    status: "running",
    createdAt: timestamp,
    startedAt: timestamp,
  };
  await store.createSession(session, [task]);
  await store.createAttempt(attempt);
  return {
    root,
    workspace,
    artifactRoot,
    store,
    session,
    task,
    attempt,
    repository: new FileCoordinationArtifactStore(
      artifactRoot,
      store,
      () => workspace,
    ),
  };
}

describe("FileCoordinationArtifactStore", () => {
  it("copies a bounded workspace file and persists its SHA-256 metadata", async () => {
    const fixture = await makeFixture();
    const source = path.join(fixture.workspace, "reports", "result.txt");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "verified result", "utf8");

    const captured = await fixture.repository.capture(
      {
        session: fixture.session,
        task: fixture.task,
        attempt: fixture.attempt,
        dependencyContext: [],
      },
      {
        summary: "Produced the report",
        artifactPaths: ["reports/result.txt"],
        evidence: [],
        unresolvedIssues: [],
      },
    );

    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    expect(captured.artifacts).toHaveLength(1);
    const artifact = captured.artifacts[0]!;
    expect(artifact).toMatchObject({
      sourcePath: "reports/result.txt",
      verificationStatus: "unverified",
      contentHash: createHash("sha256").update("verified result").digest("hex"),
    });
    expect(fixture.store.getArtifacts(fixture.session.id)).toEqual([artifact]);
    await expect(
      readFile(path.join(fixture.artifactRoot, ...artifact.path!.split("/")), "utf8"),
    ).resolves.toBe("verified result");
  });

  it("rejects traversal before reading or persisting an Artifact", async () => {
    const fixture = await makeFixture();
    await writeFile(path.join(fixture.root, "secret.txt"), "outside", "utf8");

    await expect(
      fixture.repository.capture(
        {
          session: fixture.session,
          task: fixture.task,
          attempt: fixture.attempt,
          dependencyContext: [],
        },
        {
          summary: "Claimed an outside file",
          artifactPaths: ["../secret.txt"],
          evidence: [],
          unresolvedIssues: [],
        },
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      failureClass: "unsafe_action",
    });
    expect(fixture.store.getArtifacts(fixture.session.id)).toEqual([]);
  });
});
