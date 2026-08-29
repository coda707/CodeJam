export interface DetailRequestTicket {
  sessionId: string;
  version: number;
}

export interface DetailRequestGate {
  begin: (
    sessionId: string,
    selectedSessionId: string | null,
  ) => DetailRequestTicket | null;
  invalidate: () => void;
  isCurrent: (
    ticket: DetailRequestTicket,
    selectedSessionId: string | null,
  ) => boolean;
}

export function createDetailRequestGate(): DetailRequestGate {
  let version = 0;

  return {
    begin(sessionId, selectedSessionId) {
      if (sessionId !== selectedSessionId) return null;
      version += 1;
      return { sessionId, version };
    },
    invalidate() {
      version += 1;
    },
    isCurrent(ticket, selectedSessionId) {
      return (
        ticket.version === version && ticket.sessionId === selectedSessionId
      );
    },
  };
}
