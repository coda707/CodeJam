import type { CoordinationMetrics } from "../../types";
import { formatDuration, formatNumber } from "./presentation";

interface MetricsSummaryProps {
  metrics: CoordinationMetrics;
}

export function MetricsSummary({ metrics }: MetricsSummaryProps) {
  return (
    <article className="coordination-panel metrics-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Session Metrics</span>
          <h2>Authoritative evidence projection</h2>
        </div>
        <span>Recovery: {metrics.recoveryStatus}</span>
      </div>
      <div className="metrics-grid">
        <div>
          <strong>{metrics.totalAgentCalls}</strong>
          <span>Agent calls</span>
        </div>
        <div>
          <strong>{metrics.totalAttempts}</strong>
          <span>Attempts</span>
        </div>
        <div>
          <strong>{metrics.failedAttempts}</strong>
          <span>Failed</span>
        </div>
        <div>
          <strong>{metrics.acceptedArtifacts}</strong>
          <span>Verified artifacts</span>
        </div>
        <div>
          <strong>
            {formatNumber(metrics.inputTokens + metrics.outputTokens)}
          </strong>
          <span>Model tokens</span>
        </div>
        <div>
          <strong>{formatDuration(metrics.durationMs)}</strong>
          <span>Duration</span>
        </div>
      </div>
    </article>
  );
}
