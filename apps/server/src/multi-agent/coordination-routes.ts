import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CoordinationService } from "./coordination-service.js";
import { createCoordinationSessionInputSchema } from "./contracts.js";

const sessionIdParams = z.strictObject({ id: z.string().uuid() });

export function registerCoordinationRoutes(
  app: FastifyInstance,
  service: CoordinationService,
): void {
  app.get("/api/coordination/sessions", async () => ({
    sessions: service.listSessions(),
  }));

  app.post("/api/coordination/sessions", async (request, reply) => {
    const input = createCoordinationSessionInputSchema.parse(request.body);
    const result = await service.createSession(input);
    return reply.code(201).send(result);
  });

  app.get("/api/coordination/sessions/:id", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { session: service.getSession(id) };
  });

  app.post("/api/coordination/sessions/:id/start", async (request, reply) => {
    const { id } = sessionIdParams.parse(request.params);
    const session = await service.startSession(id);
    return reply.code(202).send({ session });
  });

  app.post("/api/coordination/sessions/:id/stop", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { session: await service.stopSession(id) };
  });

  app.get("/api/coordination/sessions/:id/tasks", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { tasks: service.getTasks(id) };
  });

  app.get("/api/coordination/sessions/:id/attempts", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { attempts: service.getAttempts(id) };
  });

  app.get("/api/coordination/sessions/:id/events", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { events: service.getEvents(id) };
  });

  app.get("/api/coordination/sessions/:id/artifacts", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { artifacts: service.getArtifacts(id) };
  });

  app.get("/api/coordination/sessions/:id/metrics", async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { metrics: service.getMetrics(id) };
  });
}
