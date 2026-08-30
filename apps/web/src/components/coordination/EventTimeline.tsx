import { useMemo, useState } from "react";
import type { CoordinationEvent, CoordinationTask } from "../../types";
import { presentCoordinationEvent } from "./eventPresentation";
import { formatTime } from "./presentation";

interface EventTimelineProps {
  events: CoordinationEvent[];
  tasks: CoordinationTask[];
  agentNames: Map<string, string>;
}

export function EventTimeline({ events, tasks, agentNames }: EventTimelineProps) {
  const [taskFilter, setTaskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const eventTypes = useMemo(
    () => [...new Set(events.map((event) => event.type))].sort(),
    [events],
  );
  const selectedTask = tasks.some((task) => task.id === taskFilter)
    ? taskFilter
    : "all";
  const selectedType = eventTypes.includes(typeFilter) ? typeFilter : "all";
  const visibleEvents = events.filter(
    (event) =>
      (selectedTask === "all" || event.taskId === selectedTask) &&
      (selectedType === "all" || event.type === selectedType),
  );

  return (
    <article className="coordination-panel timeline-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Event Timeline</span>
          <h2>Persisted coordination evidence</h2>
        </div>
        <span>{visibleEvents.length} / {events.length} events</span>
      </div>
      <div className="timeline-filters">
        <label>
          Task
          <select
            value={selectedTask}
            onChange={(event) => setTaskFilter(event.target.value)}
          >
            <option value="all">All Tasks</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Event type
          <select
            value={selectedType}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All event types</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="coordination-timeline">
        {visibleEvents.map((event) => {
          const presentation = presentCoordinationEvent(event, tasks, agentNames);
          return (
            <li key={event.id}>
              <span
                className={`event-dot event-${event.type.split(".").at(-1)}`}
              />
              <time>{formatTime(event.createdAt)}</time>
              <div>
                <strong>{presentation.title}</strong>
                <span>{presentation.description}</span>
                <small>{event.type}</small>
              </div>
            </li>
          );
        })}
      </ol>
      {visibleEvents.length === 0 && (
        <p className="timeline-empty">No events match these filters.</p>
      )}
    </article>
  );
}
