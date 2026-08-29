import type { CoordinationEvent } from "../../types";
import { formatTime, shortId } from "./presentation";

interface EventTimelineProps {
  events: CoordinationEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
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
        {events.map((event) => (
          <li key={event.id}>
            <span
              className={`event-dot event-${event.type.split(".").at(-1)}`}
            />
            <time>{formatTime(event.createdAt)}</time>
            <div>
              <strong>{event.type}</strong>
              <span>
                {event.taskId ? `Task ${shortId(event.taskId)} / ` : ""}
                {Object.keys(event.payload).length > 0
                  ? JSON.stringify(event.payload)
                  : "State transition recorded"}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
