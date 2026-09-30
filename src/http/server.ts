import Fastify from "fastify";
import type { Logger } from "pino";
import type { InboundStore } from "../persistence/inbound.js";
import { sha256Hex } from "../persistence/inbound.js";
import { metaIngressIdentity, normalizeMetaEnvelope } from "../channels/meta-normalizer.js";
import { verifyMetaChallenge, verifyMetaSignature } from "../security/meta.js";
import { runtimeContract } from "../version.js";
import type { OperationalMetricsReader } from "../observability/operational-metrics.js";
import { verifyBearerAuthorization } from "../security/bearer.js";

export interface ServerDeps {
  logger: Logger;
  ready: () => Promise<boolean>;
  inbound: InboundStore;
  appSecret: string;
  verifyToken: string;
  webhookBodyLimit?: number;
  metrics?: OperationalMetricsReader;
  opsMetricsToken?: string;
  runtimeState?: {
    processorEnabled: boolean;
    actionDispatchEnabled: boolean;
    processorCutoverAt: string | null;
    processorCanaryPartitionCount: number;
  };
}

export function buildServer(deps: ServerDeps) {
  const server = Fastify({
    loggerInstance: deps.logger,
    bodyLimit: deps.webhookBodyLimit ?? 1_048_576
  });

  server.get("/health/live", () => ({ status: "ok" }));
  server.get("/health/capabilities", () => ({
    ...runtimeContract,
    runtime: deps.runtimeState ?? {
      processorEnabled: false,
      actionDispatchEnabled: false,
      processorCutoverAt: null,
      processorCanaryPartitionCount: 0
    }
  }));
  server.get("/health/ready", async (_req, reply) =>
    (await deps.ready())
      ? { status: "ready" }
      : reply.code(503).send({ status: "not_ready" })
  );

  if ((deps.metrics === undefined) !== (deps.opsMetricsToken === undefined)) {
    throw new Error("operational metrics require both a reader and a bearer token");
  }

  if (deps.metrics !== undefined && deps.opsMetricsToken !== undefined) {
    const metrics = deps.metrics;
    const opsMetricsToken = deps.opsMetricsToken;
    server.get<{ Querystring: { window?: string } }>("/ops/metrics", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsMetricsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }

      const rawWindow = req.query.window ?? "60";
      if (!/^\d+$/.test(rawWindow)) {
        return reply.code(400).send({ status: "invalid_window" });
      }
      const windowMinutes = Number(rawWindow);
      if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
        return reply.code(400).send({ status: "invalid_window" });
      }

      reply.header("cache-control", "private, no-store");
      try {
        return await metrics.snapshot(windowMinutes);
      } catch (error) {
        deps.logger.error({ err: error }, "operational metrics snapshot failed");
        return reply.code(503).send({ status: "metrics_unavailable" });
      }
    });
  }

  server.register((scope, _opts, done) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: deps.webhookBodyLimit ?? 1_048_576 },
      (_req, body, cb) => cb(null, body)
    );

    scope.get<{
      Querystring: {
        "hub.mode"?: string;
        "hub.verify_token"?: string;
        "hub.challenge"?: string;
      };
    }>("/ishikeit/webhooks/meta", (req, reply) => {
      const challenge = verifyMetaChallenge(
        req.query["hub.mode"],
        req.query["hub.verify_token"],
        req.query["hub.challenge"],
        deps.verifyToken
      );

      return challenge === undefined
        ? reply.code(403).send()
        : reply.code(200).type("text/plain; charset=utf-8").send(challenge);
    });

    scope.post<{ Body: Buffer }>("/ishikeit/webhooks/meta", async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        return reply.code(415).send({ status: "unsupported_body" });
      }

      const signature = Array.isArray(req.headers["x-hub-signature-256"])
        ? req.headers["x-hub-signature-256"][0]
        : req.headers["x-hub-signature-256"];

      if (!verifyMetaSignature(req.body, signature, deps.appSecret)) {
        return reply.code(401).send({ status: "rejected" });
      }

      let events;
      try {
        events = normalizeMetaEnvelope(JSON.parse(req.body.toString("utf8")) as unknown);
      } catch {
        return reply.code(422).send({ status: "invalid_payload" });
      }

      const rawHash = sha256Hex(req.body);
      let created = 0;

      for (const event of events) {
        if (await deps.inbound.ingest(event, metaIngressIdentity(event), rawHash) === "created") {
          created++;
        }
      }

      return reply.code(200).send({ status: created > 0 ? "accepted" : "duplicate" });
    });

    done();
  });

  return server;
}
