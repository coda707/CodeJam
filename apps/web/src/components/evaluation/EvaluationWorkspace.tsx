import { useState, type ChangeEvent } from "react";
import { formatDuration, formatNumber } from "../coordination/presentation";
import { primaryStrategies, summarizeStrategy } from "./evaluationModel";
import type {
  EvaluationDataset,
  EvaluationStrategy,
  StrategySummary,
} from "./evaluationTypes";
import { parseEvaluationDataset } from "./evaluationValidation";

const strategyNames: Record<EvaluationStrategy, string> = {
  single_agent: "Single Agent",
  static_team: "Static Team",
  mosaic: "MOSAIC",
};

const percent = (value: number | null) =>
  value === null ? "Not measured" : `${(value * 100).toFixed(1)}%`;

interface EvaluationComparisonProps {
  dataset: EvaluationDataset;
  fileName?: string;
  onClear?: () => void;
}

function StrategyCard({ summary }: { summary: StrategySummary }) {
  return (
    <article className={`evaluation-strategy strategy-${summary.strategy}`}>
      <div className="evaluation-strategy-heading">
        <div>
          <span>{summary.runCount} primary runs</span>
          <h2>{strategyNames[summary.strategy]}</h2>
        </div>
        <strong>{percent(summary.taskSuccessRate)}</strong>
      </div>
      <dl>
        <div><dt>Acceptance tests</dt><dd>{percent(summary.acceptanceTestPassRate)}</dd></div>
        <div><dt>Criteria coverage</dt><dd>{percent(summary.acceptanceCriteriaCoverage)}</dd></div>
        <div><dt>Recovery success</dt><dd>{percent(summary.recoverySuccessRate)}</dd></div>
        <div><dt>Failure localization</dt><dd>{percent(summary.failureLocalizationAccuracy)}</dd></div>
        <div><dt>Total tokens</dt><dd>{formatNumber(summary.totalTokens)}</dd></div>
        <div><dt>Average latency</dt><dd>{formatDuration(summary.averageLatencyMs)}</dd></div>
        <div><dt>Agent calls</dt><dd>{formatNumber(summary.totalAgentCalls)}</dd></div>
        <div><dt>Duplicate work</dt><dd>{percent(summary.duplicateWorkRate)}</dd></div>
        <div><dt>Failed Attempts</dt><dd>{formatNumber(summary.totalFailedAttempts)}</dd></div>
        <div><dt>Human interventions</dt><dd>{formatNumber(summary.totalHumanInterventions)}</dd></div>
        <div><dt>Coordination overhead</dt><dd>{formatDuration(summary.averageCoordinationOverheadMs)}</dd></div>
      </dl>
    </article>
  );
}

export function EvaluationComparison({
  dataset,
  fileName,
  onClear,
}: EvaluationComparisonProps) {
  const summaries = primaryStrategies.map((strategy) => ({
    strategy,
    summary: summarizeStrategy(strategy, dataset.runs),
  }));
  const missing = summaries
    .filter((item) => item.summary === null)
    .map((item) => strategyNames[item.strategy]);
  const ablations = dataset.runs.filter((run) => run.variant);

  return (
    <section className="evaluation-workspace">
      <header className="evaluation-header">
        <div>
          <span className="eyebrow">Comparative Evaluation</span>
          <h1>{dataset.name}</h1>
          <p>
            Single Agent, Static Team and MOSAIC results calculated only from
            the imported evidence file.
          </p>
        </div>
        <div className="evaluation-source-actions">
          <span className={`evaluation-source source-${dataset.source.kind}`}>
            {dataset.source.kind === "real" ? "Real run evidence" : "Fixture data"}
          </span>
          {onClear && (
            <button className="button button-ghost" onClick={onClear}>
              Clear dataset
            </button>
          )}
        </div>
      </header>

      <div
        className={`evaluation-provenance provenance-${dataset.source.kind}`}
        role={dataset.source.kind === "fixture" ? "alert" : "status"}
      >
        <strong>{dataset.source.label}</strong>
        <span>
          {dataset.source.kind === "fixture"
            ? "Development fixture only. Do not use these values as project evidence."
            : "Imported as real evidence. Verify every reference before reporting conclusions."}
        </span>
        <small>
          Generated {new Date(dataset.generatedAt).toLocaleString()}
          {fileName ? ` · ${fileName}` : ""}
        </small>
      </div>

      {missing.length > 0 && (
        <div className="evaluation-incomplete" role="status">
          <strong>Comparison incomplete</strong>
          <span>Missing primary results for {missing.join(", ")}.</span>
        </div>
      )}

      <div className="evaluation-strategies">
        {summaries.map(({ strategy, summary }) =>
          summary ? (
            <StrategyCard key={strategy} summary={summary} />
          ) : (
            <article key={strategy} className="evaluation-strategy strategy-missing">
              <span>No primary runs</span>
              <h2>{strategyNames[strategy]}</h2>
              <p>Import at least one non-ablation run for this strategy.</p>
            </article>
          ),
        )}
      </div>

      <article className="evaluation-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Traceability</span>
            <h2>Imported runs and evidence</h2>
          </div>
          <span>{dataset.runs.length} runs</span>
        </div>
        <div className="evaluation-runs">
          {dataset.runs.map((run) => (
            <article key={run.id}>
              <div>
                <strong>{run.taskName}</strong>
                <span>{strategyNames[run.strategy]}{run.variant ? ` · ${run.variant}` : ""}</span>
              </div>
              <p>{run.metrics.taskSucceeded ? "Task succeeded" : "Task failed"} · {run.id}</p>
              <ul>
                {run.evidenceRefs.map((reference) => (
                  <li key={reference}><code>{reference}</code></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </article>

      <article className="evaluation-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Ablations</span>
            <h2>Controlled capability removals</h2>
          </div>
          <span>{ablations.length} runs</span>
        </div>
        {ablations.length ? (
          <div className="evaluation-ablations">
            {ablations.map((run) => (
              <div key={run.id}>
                <strong>{run.variant}</strong>
                <span>{run.taskName}</span>
                <span>{run.metrics.taskSucceeded ? "Succeeded" : "Failed"}</span>
                <span>{formatNumber(run.metrics.totalTokens)} tokens</span>
                <span>{formatDuration(run.metrics.latencyMs)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="evaluation-empty-copy">
            No ablation runs imported. The handout requires at least one controlled removal.
          </p>
        )}
      </article>
    </section>
  );
}

export function EvaluationWorkspace() {
  const [dataset, setDataset] = useState<EvaluationDataset | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const importDataset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      if (file.size > 1_000_000) throw new Error("Evaluation file must be 1 MB or smaller");
      const parsed = parseEvaluationDataset(JSON.parse(await file.text()));
      setDataset(parsed);
      setFileName(file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (dataset) {
    return (
      <EvaluationComparison
        dataset={dataset}
        fileName={fileName}
        onClear={() => {
          setDataset(null);
          setFileName("");
          setError(null);
        }}
      />
    );
  }

  return (
    <section className="evaluation-workspace">
      <header className="evaluation-header">
        <div>
          <span className="eyebrow">Comparative Evaluation</span>
          <h1>Compare evidence, not claims</h1>
          <p>
            Import validated results for Single Agent, Static Team and MOSAIC.
            No example scores are shown as real execution evidence.
          </p>
        </div>
      </header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <article className="evaluation-import">
        <div className="evaluation-import-mark">E</div>
        <h2>Import an evaluation dataset</h2>
        <p>
          JSON only, schema version 1, up to 100 evidence-linked runs and 1 MB.
          The imported data remains in this browser view and is not sent to the server.
        </p>
        <label className="button button-primary">
          Choose JSON file
          <input type="file" accept="application/json,.json" onChange={importDataset} />
        </label>
      </article>
      <article className="evaluation-format evaluation-panel">
        <span className="eyebrow">Required comparison</span>
        <h2>What each Run must record</h2>
        <div>
          <span>Task and test success</span>
          <span>Acceptance coverage</span>
          <span>Tokens and latency</span>
          <span>Agent calls and duplicate work</span>
          <span>Failed Attempts and recovery</span>
          <span>Human interventions</span>
          <span>Coordination overhead</span>
          <span>Failure localization</span>
          <span>Evidence references</span>
        </div>
      </article>
    </section>
  );
}
