interface CoordinationEmptyStateProps {
  hasSelection: boolean;
  loading: boolean;
  errorMessage?: string | null;
  onRetry: () => void;
}

export function CoordinationEmptyState({
  hasSelection,
  loading,
  errorMessage,
  onRetry,
}: CoordinationEmptyStateProps) {
  const heading = loading
    ? "Loading Session"
    : hasSelection
      ? "Session unavailable"
      : "Create a Coordination Session";
  const description = loading
    ? "MOSAIC is loading the selected Session and its persisted evidence."
    : hasSelection
      ? "The selected Session could not be loaded. Review the error and try another Session."
      : "The Task DAG and its persisted event evidence will appear here.";

  return (
    <div
      className="coordination-panel coordination-empty-state"
      aria-busy={loading}
      aria-live="polite"
    >
      <div>M</div>
      <h2>{heading}</h2>
      <p>{description}</p>
      {hasSelection && !loading && errorMessage && (
        <p className="coordination-empty-error">{errorMessage}</p>
      )}
      {hasSelection && !loading && (
        <button className="button button-primary" onClick={onRetry}>
          Retry Session
        </button>
      )}
    </div>
  );
}
