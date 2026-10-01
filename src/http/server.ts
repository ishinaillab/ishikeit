import Fastify from "fastify";
import type { Logger } from "pino";
import type { InboundStore } from "../persistence/inbound.js";
import { sha256Hex } from "../persistence/inbound.js";
import { metaIngressIdentity, normalizeMetaEnvelope } from "../channels/meta-normalizer.js";
import { verifyMetaChallenge, verifyMetaSignature } from "../security/meta.js";
import { normalizeTelegramUpdate, telegramIngressIdentity } from "../channels/telegram-normalizer.js";
import { verifyTelegramWebhookSecret } from "../security/telegram.js";
import { normalizeTikTokBusinessWebhook, tiktokBusinessIngressIdentity } from "../channels/tiktok-normalizer.js";
import { verifyTikTokSignature } from "../security/tiktok.js";
import { runtimeContract } from "../version.js";
import type { OperationalMetricsReader } from "../observability/operational-metrics.js";
import { verifyBearerAuthorization } from "../security/bearer.js";

export interface ServerDeps {
  logger: Logger;
  ready: () => Promise<boolean>;
  inbound: InboundStore;
  appSecret: string;
  verifyToken: string;
  telegram?: {
    botId: string;
    webhookSecret: string;
  };
  tiktok?: {
    appId: string;
    clientSecret: string;
    businessId: string;
    maxSignatureAgeSeconds: number;
  };
  webhookBodyLimit?: number;
  metrics?: OperationalMetricsReader;
  opsMetricsToken?: string;
  runtimeState?: {
    processorEnabled: boolean;
    actionDispatchEnabled: boolean;
    processorCutoverAt: string | null;
    processorCanaryPartitionCount: number;
    videoInterpreterProvider: "none" | "gemini";
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
      processorCanaryPartitionCount: 0,
      videoInterpreterProvider: "none"
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

  if (deps.telegram !== undefined) {
    const telegram = deps.telegram;
    server.register((scope, _opts, done) => {
      scope.removeContentTypeParser("application/json");
      scope.addContentTypeParser(
        "application/json",
        { parseAs: "buffer", bodyLimit: deps.webhookBodyLimit ?? 1_048_576 },
        (_req, body, cb) => cb(null, body)
      );

      scope.post<{ Body: Buffer }>("/ishikeit/webhooks/telegram", async (req, reply) => {
        if (!Buffer.isBuffer(req.body)) {
          return reply.code(415).send({ status: "unsupported_body" });
        }

        const suppliedSecret = Array.isArray(req.headers["x-telegram-bot-api-secret-token"])
          ? req.headers["x-telegram-bot-api-secret-token"][0]
          : req.headers["x-telegram-bot-api-secret-token"];
        if (!verifyTelegramWebhookSecret(suppliedSecret, telegram.webhookSecret)) {
          return reply.code(401).send({ status: "rejected" });
        }

        let events;
        try {
          events = normalizeTelegramUpdate(
            JSON.parse(req.body.toString("utf8")) as unknown,
            telegram.botId
          );
        } catch {
          return reply.code(422).send({ status: "invalid_payload" });
        }

        const rawHash = sha256Hex(req.body);
        let created = 0;
        for (const event of events) {
          if (await deps.inbound.ingest(event, telegramIngressIdentity(event), rawHash) === "created") {
            created++;
          }
        }

        return reply.code(200).send({ status: created > 0 ? "accepted" : "duplicate" });
      });

      done();
    });
  }

  if (deps.tiktok !== undefined) {
    const tiktok = deps.tiktok;
    server.register((scope, _opts, done) => {
      scope.removeContentTypeParser("application/json");
      scope.addContentTypeParser(
        "application/json",
        { parseAs: "buffer", bodyLimit: deps.webhookBodyLimit ?? 1_048_576 },
        (_req, body, cb) => cb(null, body)
      );

      scope.post<{ Body: Buffer }>("/ishikeit/webhooks/tiktok", async (req, reply) => {
        if (!Buffer.isBuffer(req.body)) {
          return reply.code(415).send({ status: "unsupported_body" });
        }

        const rawSignature = Array.isArray(req.headers["tiktok-signature"])
          ? req.headers["tiktok-signature"][0]
          : req.headers["tiktok-signature"];
        if (!verifyTikTokSignature(req.body, rawSignature, tiktok.clientSecret, {
          maxAgeSeconds: tiktok.maxSignatureAgeSeconds
        })) {
          return reply.code(401).send({ status: "rejected" });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(req.body.toString("utf8")) as unknown;
        } catch {
          return reply.code(422).send({ status: "invalid_payload" });
        }

        if (
          typeof payload === "object"
          && payload !== null
          && "user_openid" in payload
          && typeof payload.user_openid === "string"
          && payload.user_openid !== tiktok.businessId
        ) {
          return reply.code(200).send({ status: "ignored" });
        }

        let events;
        try {
          events = normalizeTikTokBusinessWebhook(
            payload,
            tiktok.appId,
            tiktok.businessId
          );
        } catch {
          return reply.code(422).send({ status: "invalid_payload" });
        }

        const rawHash = sha256Hex(req.body);
        let created = 0;
        for (const event of events) {
          if (await deps.inbound.ingest(event, tiktokBusinessIngressIdentity(event), rawHash) === "created") {
            created++;
          }
        }

        return reply.code(200).send({ status: created > 0 ? "accepted" : "duplicate" });
      });

      done();
    });
  }

  return server;
}
