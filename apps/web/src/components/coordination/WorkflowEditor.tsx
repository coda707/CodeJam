import { useEffect, useMemo, useState } from "react";
import type { Agent, Workflow, WorkflowTaskInput } from "../../types";

interface WorkflowEditorProps {
  agents: Agent[];
  participantIds: string[];
  workflow: Workflow | null;
  onApply: (workflow: Workflow) => void;
  onClose: () => void;
}

interface TaskDraft {
  key: string;
  title: string;
  instructions: string;
  dependencies: string;
  capabilities: string;
  assignedAgentId: string;
  resultPath: string;
  verificationCommand: string;
}

const keyPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const unsafeCommandSyntax = /[;&|><`$()\r\n]/;

const csv = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const isAllowedCommand = (value: string) => {
  const command = value.trim();
  if (!command || unsafeCommandSyntax.test(command)) return false;
  const tokens = command.split(/\s+/);
  const [executable, ...args] = tokens;
  const allowed =
    (executable === "npm" && args[0] === "test") ||
    (executable === "npm" &&
      args[0] === "run" &&
      ["test", "build", "check"].includes(args[1] ?? "")) ||
    (executable === "npx" && args[0] === "vitest" && args[1] === "run") ||
    (executable === "node" && args[0] === "--test");
  return allowed && args.every((arg) => /^[A-Za-z0-9_./:@=,+-]+$/.test(arg));
};

const createTaskDraft = (index: number, previousKey?: string): TaskDraft => ({
  key: `task-${index + 1}`,
  title: `Task ${index + 1}`,
  instructions: "",
  dependencies: previousKey ?? "",
  capabilities: "",
  assignedAgentId: "",
  resultPath: `mosaic/task-${index + 1}.txt`,
  verificationCommand: `node --test mosaic/task-${index + 1}.test.mjs`,
});

const toDraft = (task: WorkflowTaskInput): TaskDraft => ({
  key: task.key,
  title: task.title,
  instructions: task.instructions,
  dependencies: task.dependencies?.join(", ") ?? "",
  capabilities: task.requiredCapabilities?.join(", ") ?? "",
  assignedAgentId: task.assignedAgentId ?? "",
  resultPath:
    task.acceptanceCriteria.find((criterion) => criterion.kind === "file_exists")
      ?.value ?? "",
  verificationCommand:
    task.acceptanceCriteria.find((criterion) => criterion.kind === "command")
      ?.value ?? "",
});

const validateDraft = (
  tasks: TaskDraft[],
  participantIds: string[],
  turnTaking: boolean,
) => {
  if (tasks.length === 0) return "Add at least one Task.";
  if (turnTaking && participantIds.length < 2) {
    return "Round robin requires at least two selected participant Agents.";
  }
  const keys = new Set(tasks.map((task) => task.key.trim()));
  if (keys.size !== tasks.length) return "Task keys must be unique.";
  for (const task of tasks) {
    const key = task.key.trim();
    if (!keyPattern.test(key)) {
      return `Task key "${key || "(empty)"}" must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, or underscores.`;
    }
    if (!task.title.trim() || !task.instructions.trim()) {
      return `Task "${key}" needs a title and instructions.`;
    }
    if (task.title.trim().length > 160 || task.instructions.trim().length > 10_000) {
      return `Task "${key}" exceeds the title or instruction limit.`;
    }
    const taskDependencies = csv(task.dependencies);
    const capabilities = csv(task.capabilities);
    if (taskDependencies.length > 32) {
      return `Task "${key}" has too many dependencies.`;
    }
    if (capabilities.length > 16 || capabilities.some((item) => item.length > 80)) {
      return `Task "${key}" has too many capabilities or a capability is too long.`;
    }
    if (!task.resultPath.trim()) return `Task "${key}" needs a result file.`;
    if (
      task.resultPath.trim().length > 2_000 ||
      task.verificationCommand.trim().length > 2_000
    ) {
      return `Task "${key}" exceeds the evidence value limit.`;
    }
    if (!isAllowedCommand(task.verificationCommand)) {
      return `Task "${key}" needs an allowlisted verification command.`;
    }
    if (
      task.assignedAgentId &&
      !participantIds.includes(task.assignedAgentId)
    ) {
      return `Task "${key}" is assigned to an Agent outside this Session.`;
    }
    for (const dependency of taskDependencies) {
      if (dependency === key) return `Task "${key}" cannot depend on itself.`;
      if (!keys.has(dependency)) {
        return `Task "${key}" references unknown dependency "${dependency}".`;
      }
    }
  }
  const dependencies = new Map(
    tasks.map((task) => [task.key.trim(), csv(task.dependencies)]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cycle = (dependencies.get(key) ?? []).some(hasCycle);
    visiting.delete(key);
    visited.add(key);
    return cycle;
  };
  if ([...keys].some(hasCycle)) return "Task dependencies must form an acyclic graph.";
  return null;
};

const toWorkflowTask = (task: TaskDraft): WorkflowTaskInput => {
  const key = task.key.trim();
  const dependencies = csv(task.dependencies);
  const requiredCapabilities = csv(task.capabilities);
  return {
    key,
    title: task.title.trim(),
    instructions: task.instructions.trim(),
    dependencies,
    requiredCapabilities,
    acceptanceCriteria: [
      {
        id: `${key}-file`,
        kind: "file_exists",
        description: "Capture the result file as execution evidence",
        value: task.resultPath.trim(),
      },
      {
        id: `${key}-test`,
        kind: "command",
        description: "Run the allowlisted verification command",
        value: task.verificationCommand.trim(),
      },
    ],
    ...(task.assignedAgentId
      ? { assignedAgentId: task.assignedAgentId }
      : {}),
  };
};

export function WorkflowEditor({
  agents,
  participantIds,
  workflow,
  onApply,
  onClose,
}: WorkflowEditorProps) {
  const [tasks, setTasks] = useState<TaskDraft[]>(() =>
    workflow?.tasks.length
      ? workflow.tasks.map(toDraft)
      : [createTaskDraft(0)],
  );
  const [turnTaking, setTurnTaking] = useState(
    Boolean(workflow?.turnTaking),
  );
  const [error, setError] = useState<string | null>(null);
  const participants = useMemo(
    () =>
      participantIds.map((id) => ({
        id,
        name: agents.find((agent) => agent.id === id)?.name ?? id,
      })),
    [agents, participantIds],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const updateTask = (index: number, patch: Partial<TaskDraft>) => {
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...patch } : task,
      ),
    );
    setError(null);
  };

  const apply = () => {
    const validationError = validateDraft(tasks, participantIds, turnTaking);
    if (validationError) {
      setError(validationError);
      return;
    }
    onApply({
      tasks: tasks.map(toWorkflowTask),
      ...(turnTaking
        ? {
            turnTaking: {
              agentIds: participantIds,
              pattern: "round_robin" as const,
            },
          }
        : {}),
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal workflow-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-editor-title"
        aria-describedby="workflow-editor-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Execution contract</span>
            <h2 id="workflow-editor-title">Workflow</h2>
            <p id="workflow-editor-description">
              Define the DAG, Agent routing, and mechanical evidence required for
              every Task.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close Workflow editor"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="workflow-turn-taking">
          <label>
            <input
              type="checkbox"
              checked={turnTaking}
              onChange={(event) => {
                setTurnTaking(event.target.checked);
                setError(null);
              }}
            />
            <span>
              <strong>Round-robin routing</strong>
              <small>Use the participant order shown below.</small>
            </span>
          </label>
          {turnTaking && (
            <ol>
              {participants.map((participant) => (
                <li key={participant.id}>{participant.name}</li>
              ))}
            </ol>
          )}
        </div>

        <div className="workflow-task-list">
          {tasks.map((task, index) => (
            <article className="workflow-task-card" key={`${index}-${task.key}`}>
              <header>
                <div>
                  <span>Task {index + 1}</span>
                  <strong>{task.title || "Untitled Task"}</strong>
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  disabled={tasks.length === 1}
                  onClick={() => {
                    setTasks((current) =>
                      current.filter((_, taskIndex) => taskIndex !== index),
                    );
                    setError(null);
                  }}
                >
                  Remove
                </button>
              </header>
              <div className="workflow-field-grid">
                <label>
                  Key
                  <input
                    value={task.key}
                    onChange={(event) =>
                      updateTask(index, { key: event.target.value })
                    }
                    maxLength={64}
                  />
                </label>
                <label>
                  Title
                  <input
                    value={task.title}
                    onChange={(event) =>
                      updateTask(index, { title: event.target.value })
                    }
                    maxLength={160}
                  />
                </label>
              </div>
              <label>
                Instructions
                <textarea
                  value={task.instructions}
                  onChange={(event) =>
                    updateTask(index, { instructions: event.target.value })
                  }
                  placeholder="State the deliverable, files to create, and evidence to report."
                  rows={3}
                  maxLength={10_000}
                />
              </label>
              <div className="workflow-field-grid">
                <label>
                  Dependencies
                  <input
                    value={task.dependencies}
                    onChange={(event) =>
                      updateTask(index, { dependencies: event.target.value })
                    }
                    placeholder="task-1, task-2"
                  />
                </label>
                <label>
                  Capabilities
                  <input
                    value={task.capabilities}
                    onChange={(event) =>
                      updateTask(index, { capabilities: event.target.value })
                    }
                    placeholder="typescript, testing"
                  />
                </label>
              </div>
              <label>
                Fixed Agent
                <select
                  value={task.assignedAgentId}
                  onChange={(event) =>
                    updateTask(index, { assignedAgentId: event.target.value })
                  }
                >
                  <option value="">Automatic routing</option>
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="workflow-field-grid workflow-evidence-fields">
                <label>
                  Result file
                  <input
                    value={task.resultPath}
                    onChange={(event) =>
                      updateTask(index, { resultPath: event.target.value })
                    }
                    placeholder="mosaic/result.txt"
                    maxLength={2_000}
                  />
                </label>
                <label>
                  Verification command
                  <input
                    value={task.verificationCommand}
                    onChange={(event) =>
                      updateTask(index, {
                        verificationCommand: event.target.value,
                      })
                    }
                    placeholder="node --test mosaic/result.test.mjs"
                    maxLength={2_000}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>

        <button
          type="button"
          className="button button-ghost workflow-add-task"
          disabled={tasks.length >= 32}
          onClick={() =>
            setTasks((current) => [
              ...current,
              createTaskDraft(current.length, current.at(-1)?.key),
            ])
          }
        >
          + Add Task
        </button>

        {error && (
          <p className="workflow-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={apply}>
            Apply Workflow
          </button>
        </div>
      </section>
    </div>
  );
}
