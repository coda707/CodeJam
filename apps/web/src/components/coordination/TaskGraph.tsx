import type { CoordinationTask } from "../../types";
import { shortId } from "./presentation";

interface TaskGraphProps {
  tasks: CoordinationTask[];
  agentNames: Map<string, string>;
  usesRealAgents: boolean;
}

export function TaskGraph({
  tasks,
  agentNames,
  usesRealAgents,
}: TaskGraphProps) {
  return (
    <article className="coordination-panel graph-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Coordination Graph</span>
          <h2>Dependency-aware task flow</h2>
        </div>
        <span>{tasks.length} nodes</span>
      </div>
      <div className="foundation-graph" aria-label="Coordination task graph">
        {tasks.map((task, index) => (
          <div className="graph-step" key={task.id}>
            <article className={`task-node task-${task.status}`}>
              <div className="task-node-topline">
                <span>{index + 1}</span>
                <strong>{task.status}</strong>
              </div>
              <h3>{task.title}</h3>
              <p>{task.requiredCapabilities.join(" / ") || "general"}</p>
              <small>
                {task.assignedAgentId
                  ? agentNames.get(task.assignedAgentId) ??
                    shortId(task.assignedAgentId)
                  : usesRealAgents
                    ? "Awaiting Agent"
                    : "Fake Executor"}
              </small>
            </article>
            {index < tasks.length - 1 && (
              <div className="graph-edge" aria-hidden="true">
                <span />-&gt;
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}
