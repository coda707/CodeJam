import { useMemo } from "react";
import type { CoordinationTask } from "../../types";
import { buildTaskGraphModel } from "./graphModel";
import { shortId } from "./presentation";

interface TaskGraphProps {
  tasks: readonly CoordinationTask[];
  agentNames: ReadonlyMap<string, string>;
  usesRealAgents: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function TaskGraph({
  tasks,
  agentNames,
  usesRealAgents,
  selectedTaskId,
  onSelectTask,
}: TaskGraphProps) {
  const model = useMemo(() => buildTaskGraphModel(tasks), [tasks]);
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  return (
    <article className="coordination-panel graph-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Coordination Graph</span>
          <h2>Dependency-aware task flow</h2>
        </div>
        <span>
          {tasks.length} nodes / {model.edges.length} edges
        </span>
      </div>
      <div className="foundation-graph" aria-label="Coordination task graph">
        {model.layers.map((layer, layerIndex) => (
          <div className="task-graph-layer" key={layer.index}>
            <div className="task-graph-stage">
              <span>Stage {layerIndex + 1}</span>
              <div className="task-graph-layer-tasks">
                {layer.tasks.map((task) => {
                  const dependencies = task.dependencies.map(
                    (dependencyId) =>
                      tasksById.get(dependencyId)?.title ??
                      `Missing Task ${shortId(dependencyId)}`,
                  );
                  return (
                    <button
                      type="button"
                      className={`task-node task-${task.status}${
                        selectedTaskId === task.id ? " selected" : ""
                      }`}
                      key={task.id}
                      aria-pressed={selectedTaskId === task.id}
                      aria-controls="task-inspector"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <span className="task-node-topline">
                        <span>{shortId(task.id)}</span>
                        <strong>{task.status}</strong>
                      </span>
                      <span className="task-node-title">{task.title}</span>
                      <span className="task-node-capabilities">
                        {task.requiredCapabilities.join(" / ") || "general"}
                      </span>
                      <span className="task-node-agent">
                        {task.assignedAgentId
                          ? agentNames.get(task.assignedAgentId) ??
                            shortId(task.assignedAgentId)
                          : usesRealAgents
                            ? "Awaiting Agent"
                            : "Fake Executor"}
                      </span>
                      <span className="task-node-dependencies">
                        {dependencies.length > 0
                          ? `After: ${dependencies.join(", ")}`
                          : "Entry Task"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      {model.edges.length > 0 && (
        <div className="graph-dependencies">
          <span className="eyebrow">Dependency Links</span>
          <ul className="dependency-links" aria-label="Dependency links">
            {model.edges.map((edge) => {
              const source = tasksById.get(edge.fromTaskId);
              const target = tasksById.get(edge.toTaskId);
              const sourceTitle =
                source?.title ?? `Missing Task ${shortId(edge.fromTaskId)}`;
              const targetTitle =
                target?.title ?? `Missing Task ${shortId(edge.toTaskId)}`;
              return (
                <li
                  className="dependency-link"
                  key={`${edge.fromTaskId}:${edge.toTaskId}`}
                  data-edge-from={edge.fromTaskId}
                  data-edge-to={edge.toTaskId}
                  aria-label={`Dependency from ${sourceTitle}, ${edge.fromTaskId}, to ${targetTitle}, ${edge.toTaskId}`}
                >
                  <span>
                    <strong>{sourceTitle}</strong>
                    <code>{shortId(edge.fromTaskId)}</code>
                  </span>
                  <span className="dependency-link-arrow" aria-hidden="true">
                    →
                  </span>
                  <span>
                    <strong>{targetTitle}</strong>
                    <code>{shortId(edge.toTaskId)}</code>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {model.issues.length > 0 && (
        <div className="graph-issues" role="alert">
          {model.issues.length} graph data issue
          {model.issues.length === 1 ? "" : "s"} detected. All Tasks remain
          visible for diagnosis.
        </div>
      )}
    </article>
  );
}
