import { describe, expect, it } from "vitest";
import { makeVerificationRequest } from "./test-support/factories.js";
import { MechanicalCoordinationVerifier } from "./verifier.js";

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
});
