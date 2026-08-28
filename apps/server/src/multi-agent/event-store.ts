import {
  coordinationEventSchema,
  type CoordinationEvent,
} from "./contracts.js";
import type { CoordinationEventSink } from "./ports.js";
import type { CoordinationStore } from "./coordination-store.js";

export class JsonCoordinationEventSink implements CoordinationEventSink {
  constructor(private readonly store: CoordinationStore) {}

  async append(event: CoordinationEvent): Promise<void> {
    await this.store.appendEvent(coordinationEventSchema.parse(event));
  }
}
