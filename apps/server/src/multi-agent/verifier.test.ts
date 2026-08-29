import { describe, expect, it } from "vitest";
import { makeVerificationRequest } from "./test-support/factories.js";
import { MechanicalCoordinationVerifier } from "./verifier.js";

function makeCommandRequest() {
  const request = makeVerificationRequest();
  request.task.acceptanceCriteria = [
    {
      id: "run-tests",
      kind: "command",
      description: "Run the test suite",
      value: "npm test",
    },
  ];
  return request;
}

describe("MechanicalCoordinationVerifier", () => {
  it("accepts captured file evidence that satisfies the criterion", async () => {
    await expect(
      new MechanicalCoordinationVerifier().verify(makeVerificationRequest()),
    ).resolves.toMatchObject({ status: "accepted" });
  });

  it("rejects missing or unresolved evidence", async () => {
    const missing = makeVerificationRequest();
    missing.artifacts = [];
    await expect(new MechanicalCoordinationVerifier().verify(missing)).resolves.toMatchObject({
      status: "rejected",
      failureClass: "test_failure",
    });

    const unresolved = makeVerificationRequest();
    unresolved.output.unresolvedIssues = ["Tests are still failing"];
    await expect(
      new MechanicalCoordinationVerifier().verify(unresolved),
    ).resolves.toMatchObject({ status: "rejected", failureClass: "no_progress" });
  });

  it("accepts an allowlisted command that exits zero", async () => {
    const verifier = new MechanicalCoordinationVerifier({
      commandRunner: {
        run: async () => ({ exitCode: 0, stdout: "12 passing", stderr: "" }),
      },
    });
    await expect(verifier.verify(makeCommandRequest())).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it("rejects an allowlisted command that exits non-zero", async () => {
    const verifier = new MechanicalCoordinationVerifier({
      commandRunner: {
        run: async () => ({ exitCode: 1, stdout: "", stderr: "2 failing" }),
      },
    });
    await expect(verifier.verify(makeCommandRequest())).resolves.toMatchObject({
      status: "rejected",
      failureClass: "test_failure",
    });
  });

  it("rejects a command that is not allowlisted", async () => {
    const request = makeCommandRequest();
    request.task.acceptanceCriteria[0]!.value = "rm -rf /";
    const verifier = new MechanicalCoordinationVerifier({
      commandRunner: {
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
    });
    const result = await verifier.verify(request);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.evidence.join(" ")).toContain("not allowlisted");
    }
  });

  it("rejects a command criterion when no runner is configured", async () => {
    const result = await new MechanicalCoordinationVerifier().verify(makeCommandRequest());
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.evidence.join(" ")).toContain("explicitly configured");
    }
  });
});
