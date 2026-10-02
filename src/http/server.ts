import { createHash } from "node:crypto";
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
import type { TikTokOAuthController } from "../auth/tiktok-oauth.js";
import type { InstagramOAuthController } from "../auth/instagram-oauth.js";
import type { InstagramDataLifecycle } from "../privacy/instagram-data-lifecycle.js";
import { verifyMetaSignedRequest } from "../security/meta-signed-request.js";

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
  tiktokOAuth?: {
    service: TikTokOAuthController;
    configuredBusinessId?: string;
  };
  instagramOAuth?: {
    service: InstagramOAuthController;
    compliance?: {
      appSecret: string;
      dataLifecycle: InstagramDataLifecycle;
      statusBaseUrl: string;
    };
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

  if (deps.metrics !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("operational metrics require a bearer token");
  }
  if (deps.tiktokOAuth !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("TikTok OAuth operations require an operational bearer token");
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

  if (deps.tiktokOAuth !== undefined && deps.opsMetricsToken !== undefined) {
    const tiktokOAuth = deps.tiktokOAuth;
    const opsToken = deps.opsMetricsToken;

    server.post("/ops/tiktok/oauth/start", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }
      reply.header("cache-control", "private, no-store");
      try {
        return {
          status: "authorization_required",
          ...await tiktokOAuth.service.beginAuthorization()
        };
      } catch (error) {
        deps.logger.error({ err: error }, "TikTok OAuth authorization start failed");
        return reply.code(503).send({ status: "oauth_unavailable" });
      }
    });

    server.get("/ops/tiktok/oauth/status", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }
      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokOAuth.service.status(tiktokOAuth.configuredBusinessId);
      } catch (error) {
        deps.logger.error({ err: error }, "TikTok OAuth status failed");
        return reply.code(503).send({ status: "oauth_unavailable" });
      }
    });

    server.get<{
      Querystring: { state?: string; auth_code?: string; code?: string };
    }>("/ishikeit/oauth/tiktok/callback/", async (req, reply) => {
      reply.header("cache-control", "no-store");
      const state = req.query.state;
      const authCode = req.query.auth_code ?? req.query.code;
      if (state === undefined || authCode === undefined) {
        return reply
          .code(400)
          .type("text/plain; charset=utf-8")
          .send("TikTok authorization could not be completed.");
      }

      try {
        const result = await tiktokOAuth.service.completeAuthorization(state, authCode);
        return reply
          .code(200)
          .type("text/plain; charset=utf-8")
          .send(
            `TikTok authorization completed for Business Account ${result.businessId}. You may close this window.`
          );
      } catch (error) {
        deps.logger.warn({ err: error }, "TikTok OAuth callback failed");
        return reply
          .code(400)
          .type("text/plain; charset=utf-8")
          .send("TikTok authorization could not be completed. Start a new authorization request.");
      }
    });
  }

  if (deps.instagramOAuth !== undefined) {
    const instagramOAuth = deps.instagramOAuth;

    server.get("/ishikeit/oauth/instagram/login/", async (_req, reply) => {
      reply.header("cache-control", "no-store");
      try {
        const started = await instagramOAuth.service.beginAuthorization();
        return reply.code(302).header("location", started.authorizationUrl).send();
      } catch (error) {
        deps.logger.error({ err: error }, "Instagram OAuth authorization start failed");
        return reply.code(503).type("text/plain; charset=utf-8")
          .send("Instagram authorization is temporarily unavailable.");
      }
    });

    server.get<{
      Querystring: {
        state?: string;
        code?: string;
        error?: string;
        error_reason?: string;
        error_description?: string;
      };
    }>("/ishikeit/oauth/instagram/callback/", async (req, reply) => {
      reply.header("cache-control", "no-store");
      const state = req.query.state;
      const code = req.query.code;
      if (req.query.error !== undefined || state === undefined || code === undefined) {
        return reply.code(400).type("text/plain; charset=utf-8")
          .send("Instagram authorization was not completed.");
      }

      try {
        const result = await instagramOAuth.service.completeAuthorization(state, code);
        return reply.code(200).type("text/plain; charset=utf-8")
          .send("Instagram authorization completed for account " + result.accountId + ". You may close this window.");
      } catch (error) {
        const stateFingerprint = createHash("sha256")
          .update(state)
          .digest("hex")
          .slice(0, 12);
        deps.logger.warn({
          err: error,
          stateFingerprint,
          stateLength: state.length,
          codeLength: code.length
        }, "Instagram OAuth callback failed");
        return reply.code(400).type("text/plain; charset=utf-8")
          .send("Instagram authorization could not be completed. Start a new authorization request.");
      }
    });

    if (instagramOAuth.compliance !== undefined) {
      const compliance = instagramOAuth.compliance;

      server.register((scope, _opts, done) => {
        scope.addContentTypeParser(
          "application/x-www-form-urlencoded",
          { parseAs: "string", bodyLimit: 65_536 },
          (_req, body, cb) => cb(null, body)
        );

        scope.post<{ Body: string }>(
          "/ishikeit/oauth/instagram/deauthorize/",
          async (req, reply) => {
            const signedRequest = new URLSearchParams(req.body).get("signed_request");
            const payload = signedRequest === null
              ? undefined
              : verifyMetaSignedRequest(signedRequest, compliance.appSecret);
            if (payload === undefined) {
              return reply.code(401).send({ status: "rejected" });
            }

            try {
              await compliance.dataLifecycle.deauthorize(payload.userId);
              return reply.code(200).send({ status: "deauthorized" });
            } catch (error) {
              deps.logger.error({ err: error }, "Instagram deauthorization callback failed");
              return reply.code(503).send({ status: "temporarily_unavailable" });
            }
          }
        );

        scope.post<{ Body: string }>(
          "/ishikeit/oauth/instagram/data-deletion/",
          async (req, reply) => {
            const signedRequest = new URLSearchParams(req.body).get("signed_request");
            const payload = signedRequest === null
              ? undefined
              : verifyMetaSignedRequest(signedRequest, compliance.appSecret);
            if (payload === undefined) {
              return reply.code(401).send({ status: "rejected" });
            }

            try {
              const result = await compliance.dataLifecycle.requestDeletion(
                payload.userId,
                compliance.statusBaseUrl
              );
              return reply.code(200).send({
                url: result.statusUrl,
                confirmation_code: result.confirmationCode
              });
            } catch (error) {
              deps.logger.error({ err: error }, "Instagram data deletion callback failed");
              return reply.code(503).send({ status: "temporarily_unavailable" });
            }
          }
        );

        done();
      });

      server.get<{ Params: { confirmationCode: string } }>(
        "/ishikeit/privacy/data-deletion/status/:confirmationCode",
        async (req, reply) => {
          reply.header("cache-control", "no-store");
          const code = req.params.confirmationCode;
          if (!/^[A-Za-z0-9]{16,64}$/u.test(code)) {
            return reply.code(404).type("text/plain; charset=utf-8")
              .send("Data deletion request not found.");
          }

          const status = await compliance.dataLifecycle.deletionStatus(code);
          if (status === undefined) {
            return reply.code(404).type("text/plain; charset=utf-8")
              .send("Data deletion request not found.");
          }
          const completed = status.completedAt === undefined
            ? ""
            : ` Completed at ${status.completedAt}.`;
          return reply.code(200).type("text/plain; charset=utf-8")
            .send(
              `Data deletion request ${code}: ${status.status}. Requested at ${status.requestedAt}.${completed}`
            );
        }
      );
    }

    if (deps.opsMetricsToken !== undefined) {
      const opsToken = deps.opsMetricsToken;
      server.post("/ops/instagram/oauth/start", async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401).send({ status: "unauthorized" });
        }
        reply.header("cache-control", "private, no-store");
        try {
          return { status: "authorization_required", ...await instagramOAuth.service.beginAuthorization() };
        } catch (error) {
          deps.logger.error({ err: error }, "Instagram OAuth operational start failed");
          return reply.code(503).send({ status: "oauth_unavailable" });
        }
      });

      server.get<{ Querystring: { account_id?: string } }>
      ("/ops/instagram/oauth/status", async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401).send({ status: "unauthorized" });
        }
        reply.header("cache-control", "private, no-store");
        try {
          return await instagramOAuth.service.status(req.query.account_id);
        } catch (error) {
          deps.logger.error({ err: error }, "Instagram OAuth status failed");
          return reply.code(503).send({ status: "oauth_unavailable" });
        }
      });
    }
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
