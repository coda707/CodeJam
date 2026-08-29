import type { SystemInfo } from "../../types";

interface WorkspaceHeaderProps {
  executorMode: SystemInfo["coordinationExecutor"];
}

export function WorkspaceHeader({ executorMode }: WorkspaceHeaderProps) {
  const usesRealAgents = executorMode === "agent";
  return (
    <header className="coordination-heading">
      <div>
        <span className="eyebrow">MOSAIC coordination</span>
        <h1>Task graph and execution evidence</h1>
        <p>
          {usesRealAgents
            ? "Tasks execute through the existing AgentService Run path with strict WorkerOutput validation."
            : "This safe default uses a deterministic Fake Executor. Existing Playground Agents remain real and unchanged."}
        </p>
      </div>
      <span className="foundation-badge">
        {usesRealAgents ? "MOSAIC / Agent Executor" : "Foundation / Fake Executor"}
      </span>
    </header>
  );
}
