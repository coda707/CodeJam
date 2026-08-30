import { formatTime } from "./presentation";

interface RefreshStatusProps {
  failedAt: string;
  refreshing: boolean;
  onRetry: () => void;
}

export function RefreshStatus({
  failedAt,
  refreshing,
  onRetry,
}: RefreshStatusProps) {
  return (
    <div className="coordination-refresh-status" role="status" aria-live="polite">
      <div>
        <strong>Showing last confirmed Session data</strong>
        <span>
          Refresh failed at <time dateTime={failedAt}>{formatTime(failedAt)}</time>.
          Evidence may be stale.
        </span>
      </div>
      <button
        type="button"
        className="button button-ghost"
        disabled={refreshing}
        onClick={onRetry}
      >
        {refreshing ? "Refreshing..." : "Retry refresh"}
      </button>
    </div>
  );
}
