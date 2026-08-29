import { describe, expect, it } from "vitest";
import { createDetailRequestGate } from "./detailRequestGate";

describe("createDetailRequestGate", () => {
  it("only accepts the newest request for the selected Session", () => {
    const gate = createDetailRequestGate();
    const first = gate.begin("session-a", "session-a");
    const second = gate.begin("session-b", "session-b");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    expect(gate.isCurrent(first!, "session-a")).toBe(false);
    expect(gate.isCurrent(second!, "session-a")).toBe(false);
    expect(gate.isCurrent(second!, "session-b")).toBe(true);
  });

  it("does not invalidate the current request for an old Session refresh", () => {
    const gate = createDetailRequestGate();
    const current = gate.begin("session-b", "session-b");
    const oldMutationRefresh = gate.begin("session-a", "session-b");

    expect(current).not.toBeNull();
    expect(oldMutationRefresh).toBeNull();
    expect(gate.isCurrent(current!, "session-b")).toBe(true);
  });

  it("invalidates an in-flight request when its owner is cleared", () => {
    const gate = createDetailRequestGate();
    const request = gate.begin("session-a", "session-a");

    expect(request).not.toBeNull();

    gate.invalidate();

    expect(gate.isCurrent(request!, "session-a")).toBe(false);
  });
});
