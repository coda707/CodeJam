import type { FailureClass } from "./contracts.js";

export function classifyExecutionFailure(error: unknown): FailureClass {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (
    message.includes("rate limit") ||
    message.includes("provider") ||
    message.includes("unavailable") ||
    /\b(429|502|503|504)\b/.test(message)
  ) {
    return "transient_provider_error";
  }
  if (
    message.includes("malformed") ||
    message.includes("structured output") ||
    message.includes("invalid json")
  ) {
    return "malformed_output";
  }
  if (message.includes("test") || message.includes("acceptance")) {
    return "test_failure";
  }
  if (
    message.includes("capability") ||
    message.includes("agent not found") ||
    message.includes("agent is already") ||
    message.includes("agent is stopped") ||
    message.includes("already running") ||
    message.includes("agent before")
  ) {
    return "agent_capability_mismatch";
  }
  return "tool_error";
}
