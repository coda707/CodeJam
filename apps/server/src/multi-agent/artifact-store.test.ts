import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../store.js";
import { FileCoordinationArtifactStore, redactSecrets } from "./artifact-store.js";
import { CoordinationStore } from "./coordination-store.js";
import {
  makeCoordinationSession,
  makeTaskAttempt,
  makeTaskNode,
} from "./test-support/factories.js";

const temporaryDirectories: string[] = [];

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
  const session = makeCoordinationSession({
    userTask: "Capture real evidence",
    participantAgentIds: [agentId],
  });
  const task = makeTaskNode(session, {
    title: "Produce a report",
    instructions: "Write the report",
    requiredCapabilities: ["reporting"],
    acceptanceCriteria: [
      {
        id: "report",
        kind: "file_exists",
        description: "Report exists",
        value: "reports/result.txt",
      },
    ],
    assignedAgentId: agentId,
  });
  const attempt = makeTaskAttempt(session, task, { agentId });
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

  it("reads a captured Artifact back with its hash and secret redaction", async () => {
    const fixture = await makeFixture();
    const source = path.join(fixture.workspace, "reports", "result.txt");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "apiKey=sk-ark-0123456789abcdef result", "utf8");

    const captured = await fixture.repository.capture(
      {
        session: fixture.session,
        task: fixture.task,
        attempt: fixture.attempt,
        dependencyContext: [],
      },
      {
        summary: "Produced a report",
        artifactPaths: ["reports/result.txt"],
        evidence: [],
        unresolvedIssues: [],
      },
    );
    if (captured.status !== "captured") throw new Error("capture failed");
    const artifact = captured.artifacts[0]!;

    await expect(
      fixture.repository.readArtifact(fixture.session.id, artifact.id),
    ).resolves.toEqual({
      content: "apiKey=[REDACTED_KEY] result",
      sourcePath: "reports/result.txt",
      contentHash: artifact.contentHash,
    });
  });

  it("does not reveal content for an unknown or foreign Artifact", async () => {
    const fixture = await makeFixture();
    const foreign = await makeFixture();

    await expect(
      fixture.repository.readArtifact(fixture.session.id, randomUUID()),
    ).resolves.toBeNull();
    // A real Artifact from another Session must not be readable through this one.
    const source = path.join(fixture.workspace, "reports", "result.txt");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "private", "utf8");
    const captured = await fixture.repository.capture(
      {
        session: fixture.session,
        task: fixture.task,
        attempt: fixture.attempt,
        dependencyContext: [],
      },
      {
        summary: "Captured",
        artifactPaths: ["reports/result.txt"],
        evidence: [],
        unresolvedIssues: [],
      },
    );
    if (captured.status !== "captured") throw new Error("capture failed");
    await expect(
      foreign.repository.readArtifact(fixture.session.id, captured.artifacts[0]!.id),
    ).resolves.toBeNull();
  });
});

describe("redactSecrets", () => {
  it("redacts keys, bearer tokens, apiKey assignments and private keys", () => {
    const input = [
      "Authorization: Bearer abc123secret_token_xyz",
      "ARK_API_KEY=sk-ark-abcdefgh12345678",
      "private: -----BEGIN RSA PRIVATE KEY-----body-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const output = redactSecrets(input);

    expect(output).toContain("Bearer [REDACTED_TOKEN]");
    expect(output).toContain("[REDACTED_KEY]");
    expect(output).toContain("[REDACTED_PRIVATE_KEY]");
    expect(output).not.toContain("abc123secret_token_xyz");
    expect(output).not.toContain("sk-ark-abcdefgh12345678");
  });
});
