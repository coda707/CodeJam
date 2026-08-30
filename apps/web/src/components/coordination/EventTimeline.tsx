import type { CoordinationEvent, CoordinationTask } from "../../types";
import { presentCoordinationEvent } from "./eventPresentation";
import { formatTime } from "./presentation";

interface EventTimelineProps {
  events: CoordinationEvent[];
  tasks: CoordinationTask[];
  agentNames: Map<string, string>;
}

export function EventTimeline({ events, tasks, agentNames }: EventTimelineProps) {
  return (
    <article className="coordination-panel timeline-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Event Timeline</span>
          <h2>Persisted coordination evidence</h2>
        </div>
        <span>{events.length} events</span>
      </div>
      <ol className="coordination-timeline">
        {events.map((event) => {
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
    </article>
  );
}
