import { createHash } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import type { Logger } from "pino";
import type { InboundStore } from "../persistence/inbound.js";
import type { MetaHandoffControl } from "../persistence/meta-handoff.js";
import { sha256Hex } from "../persistence/inbound.js";
import { metaIngressIdentity, normalizeMetaEnvelope } from "../channels/meta-normalizer.js";
import { verifyMetaChallenge, verifyMetaSignature } from "../security/meta.js";
import { normalizeTelegramUpdate, telegramIngressIdentity } from "../channels/telegram-normalizer.js";
import { verifyTelegramWebhookSecret } from "../security/telegram.js";
import { normalizeTikTokBusinessWebhook, tiktokBusinessIngressIdentity } from "../channels/tiktok-normalizer.js";
import { verifyTikTokSignature } from "../security/tiktok.js";
import { runtimeContract } from "../version.js";
import type { OperationalMetricsReader } from "../observability/operational-metrics.js";
import type { LocalWorkerDiagnostics } from "../observability/worker-loop-diagnostics.js";
import type { WorkerFleetSnapshot } from "../observability/durable-worker-heartbeats.js";
import type { IncidentReadback } from "../observability/operational-incident-monitor.js";
import { evaluateOperationalAlerts } from "../observability/operational-alerts.js";
import type { MetaUnknownReconciler } from "../persistence/meta-unknown-reconciliation.js";
import type { MetaGraphPreflightReader } from "../security/meta-graph-preflight.js";
import type { BuildIdentity } from "../observability/build-identity.js";
import { verifyBearerAuthorization } from "../security/bearer.js";
import type { TikTokOAuthController } from "../auth/tiktok-oauth.js";
import {
  TikTokMarketingOAuthNotAuthorizedError,
  type TikTokMarketingOAuthController
} from "../auth/tiktok-marketing-oauth.js";
import type { TikTokMarketingAdvertiserController } from "../marketing/tiktok-advertiser.js";
import {
  TikTokBusinessMessagingNotAuthorizedError,
  type TikTokBusinessMessagingReadController,
  TikTokBusinessMessagingValidationError
} from "../messaging/tiktok-business-read.js";
import type { TikTokBusinessWebhookController } from "../messaging/tiktok-webhook-config.js";
import type { TikTokMessagingProbeController } from "../messaging/tiktok-availability-probe.js";
import {
  TikTokCommentToMessageNotAuthorizedError,
  type TikTokBusinessCommentToMessageController
} from "../messaging/tiktok-comment-to-message.js";
import { instagramOAuthFailureDiagnostic, type InstagramOAuthController } from "../auth/instagram-oauth.js";
import type { InstagramDataLifecycle } from "../privacy/instagram-data-lifecycle.js";
import { verifyMetaSignedRequest } from "../security/meta-signed-request.js";
import {
  assertLatePointPublicKey,
  normalizeLatePointBookingChange,
  verifyLatePointAsymmetricWebhook,
  verifyLatePointWebhook
} from "../appointments/latepoint-booking-ingress.js";

export interface ServerDeps {
  logger: Logger;
  ready: () => Promise<boolean>;
  inbound: InboundStore;
  appSecret: string;
  /** Separate Instagram Login product secret; accepted only for object=instagram. */
  instagramWebhookAppSecret?: string;
  verifyToken: string;
  /** Independently keyed, non-sending WordPress booking lifecycle ingress. */
  latePointWebhook?: { secret?: string; publicKeyPem?: string };
  telegram?: {
    botId: string;
    webhookSecret: string;
    verifyBusinessConnection?: (connectionId: string) => Promise<{ ownerId: string }>;
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
  tiktokBusinessMessagingRead?: {
    service: TikTokBusinessMessagingReadController;
  };
  tiktokMessagingAvailabilityProbe?: TikTokMessagingProbeController;
  tiktokBusinessMessagingWebhook?: {
    service: TikTokBusinessWebhookController;
  };
  tiktokCommentToMessage?: {
    service: TikTokBusinessCommentToMessageController;
  };
  tiktokMarketingOAuth?: {
    service: TikTokMarketingOAuthController;
  };
  tiktokMarketingAdvertisers?: {
    service: TikTokMarketingAdvertiserController;
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
  /** Compiled-source fingerprint supplied by the startup process, never credentials. */
  buildIdentity?: BuildIdentity;
  metrics?: OperationalMetricsReader;
  localWorkerDiagnostics?: LocalWorkerDiagnostics;
  workerFleet?: { snapshot(): Promise<WorkerFleetSnapshot> };
  incidentReadback?: { snapshot(): Promise<IncidentReadback> };
  metaUnknown?: MetaUnknownReconciler;
  metaGraphPreflight?: MetaGraphPreflightReader;
  metaHandoffs?: MetaHandoffControl;
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
  server.get("/health/build", (_req, reply) => {
    reply.header("cache-control", "no-store");
    return {
      status: "ok",
      artifactSha256: deps.buildIdentity?.artifactSha256 ?? null,
      installedFastUriSha256: deps.buildIdentity?.installedFastUriSha256 ?? null,
      sourceRevision: deps.buildIdentity?.sourceRevision ?? null
    };
  });
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

  // Default off. No endpoint is registered without a dedicated key.
  if (deps.latePointWebhook !== undefined) {
    const secret = deps.latePointWebhook.secret;
    const publicKeyPem = deps.latePointWebhook.publicKeyPem;
    if ((secret === undefined) === (publicKeyPem === undefined)) {
      throw new Error("LatePoint webhook needs exactly one signing verifier");
    }
    if (secret !== undefined && Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("LatePoint webhook requires an independent 32-byte secret");
    }
    if (publicKeyPem !== undefined) assertLatePointPublicKey(publicKeyPem);
    server.register((scope, _opts, done) => {
      scope.removeContentTypeParser("application/json");
      scope.addContentTypeParser("application/json", {
        parseAs: "buffer", bodyLimit: 4096
      }, (_req, body, cb) => cb(null, body));
      scope.post<{ Body: Buffer }>("/ishikeit/webhooks/latepoint", async (req, reply) => {
        reply.header("cache-control", "no-store");
        if (!Buffer.isBuffer(req.body)) {
          return reply.code(415).send({ status: "unsupported_body" });
        }
        const timestamp = Array.isArray(req.headers["x-ishi-latepoint-timestamp"])
          ? undefined : req.headers["x-ishi-latepoint-timestamp"];
        const signature = publicKeyPem !== undefined
          ? req.headers["x-ishi-latepoint-signature-p256"]
          : req.headers["x-ishi-latepoint-signature-256"];
        const verified = (publicKeyPem !== undefined
          ? verifyLatePointAsymmetricWebhook(
              req.body, timestamp,
              Array.isArray(signature) ? undefined : signature,
              publicKeyPem
            )
          : verifyLatePointWebhook(
              req.body, timestamp,
              Array.isArray(signature) ? undefined : signature,
              secret!
            ));
        if (!verified) {
          return reply.code(401).send({ status: "rejected" });
        }
        let snapshot;
        try {
          snapshot = normalizeLatePointBookingChange(
            JSON.parse(req.body.toString("utf8")) as unknown
          );
        } catch {
          return reply.code(422).send({ status: "invalid_booking_change" });
        }
        const outcome = await deps.inbound.ingest(
          snapshot.event, snapshot.identity, sha256Hex(req.body)
        );
        return reply.code(200).send({
          status: outcome === "created" ? "accepted" : "duplicate"
        });
      });
      done();
    });
  }

  if (deps.metaGraphPreflight !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("Meta Graph proof preflight requires a bearer token");
  }
  if (deps.metaUnknown !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("Meta unknown-outcome reconciliation requires an operational bearer token");
  }
  if (deps.metrics !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("operational metrics require a bearer token");
  }
  if (deps.incidentReadback !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("incident readback requires an operational bearer token");
  }
  if (deps.workerFleet !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("worker fleet diagnostics require an operational bearer token");
  }
  if (deps.localWorkerDiagnostics !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("local worker diagnostics require an operational bearer token");
  }
  if (deps.tiktokOAuth !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("TikTok OAuth operations require an operational bearer token");
  }
  if (deps.tiktokMessagingAvailabilityProbe !== undefined
    && deps.opsMetricsToken === undefined) {
    throw new Error("TikTok Messaging availability probe requires an operational bearer token");
  }
  if (
    deps.tiktokBusinessMessagingRead !== undefined
    && deps.opsMetricsToken === undefined
  ) {
    throw new Error(
      "TikTok Business Messaging read operations require an operational bearer token"
    );
  }
  if (
    deps.tiktokBusinessMessagingWebhook !== undefined
    && deps.opsMetricsToken === undefined
  ) {
    throw new Error(
      "TikTok Business Messaging webhook operations require an operational bearer token"
    );
  }
  if (
    deps.tiktokCommentToMessage !== undefined
    && deps.opsMetricsToken === undefined
  ) {
    throw new Error(
      "TikTok Comment-to-Message operations require an operational bearer token"
    );
  }
  if (deps.tiktokMarketingOAuth !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("TikTok Marketing OAuth operations require an operational bearer token");
  }
  if (
    deps.tiktokMarketingAdvertisers !== undefined
    && deps.opsMetricsToken === undefined
  ) {
    throw new Error(
      "TikTok Marketing advertiser operations require an operational bearer token"
    );
  }

  if (deps.metaHandoffs !== undefined && deps.opsMetricsToken === undefined) {
    throw new Error("Meta human handoff release requires an operational bearer token");
  }

  if (deps.metaHandoffs !== undefined && deps.opsMetricsToken !== undefined) {
    const handoffs = deps.metaHandoffs;
    const token = deps.opsMetricsToken;
    const releaseSchema = z.object({
      channel: z.enum(["messenger", "instagram", "whatsapp"]),
      accountId: z.string().min(1).max(1024),
      identityId: z.string().min(1).max(2048)
    }).strict();
    server.post("/ops/meta/handoff/release", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      reply.header("cache-control", "private, no-store");
      const input = releaseSchema.safeParse(req.body);
      if (!input.success) {
        return reply.code(400).send({ status: "invalid_handoff_release" });
      }
      try {
        const released = await handoffs.release(
          input.data.channel, input.data.accountId, input.data.identityId
        );
        return { status: released ? "released" : "not_active" };
      } catch {
        return reply.code(503).send({ status: "handoff_unavailable" });
      }
    });
  }

  if (deps.metaGraphPreflight !== undefined && deps.opsMetricsToken !== undefined) {
    const preflight = deps.metaGraphPreflight;
    const token = deps.opsMetricsToken;
    server.get("/ops/meta/graph-proof-preflight", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      try {
        return { status: "ok", ...await preflight.probe() };
      } catch {
        return reply.code(503).send({ status: "preflight_unavailable" });
      }
    });
  }

  // Reconciliation is an operator-only, non-sending attestation ledger.
  // No route here can requeue, release, delete, or send an outbound message.
  if (deps.metaUnknown !== undefined && deps.opsMetricsToken !== undefined) {
    const reconciliation = deps.metaUnknown;
    const token = deps.opsMetricsToken;
    const reviewSchema = z.object({
      disposition: z.enum(["followup_required", "reviewed_do_not_resend"]),
      evidence: z.enum(["provider_record", "manual_thread_review", "customer_confirmation"]),
      operatorTag: z.string().min(3).max(48).regex(/^[A-Za-z0-9._-]+$/u)
    }).strict();
    const uuidSchema = z.string().uuid();

    server.get<{ Querystring: { limit?: string } }>("/ops/meta/unknown-outcomes", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      const rawLimit = req.query.limit ?? "25";
      if (!/^[0-9]{1,2}$/u.test(rawLimit)) {
        return reply.code(400).send({ status: "invalid_limit" });
      }
      const limit = Number(rawLimit);
      if (limit < 1 || limit > 50) {
        return reply.code(400).send({ status: "invalid_limit" });
      }
      try {
        return { status: "ok", ...await reconciliation.list(limit) };
      } catch {
        return reply.code(503).send({ status: "reconciliation_unavailable" });
      }
    });

    server.post<{ Params: { outboxId: string } }>(
      "/ops/meta/unknown-outcomes/:outboxId/review", async (req, reply) => {
        reply.header("cache-control", "private, no-store");
        if (!verifyBearerAuthorization(req.headers.authorization, token)) {
          return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401).send({ status: "unauthorized" });
        }
        const id = uuidSchema.safeParse(req.params.outboxId);
        const input = reviewSchema.safeParse(req.body);
        if (!id.success || !input.success) {
          return reply.code(400).send({ status: "invalid_review" });
        }
        try {
          const state = await reconciliation.review({ outboxId: id.data, ...input.data });
          return state === "not_found"
            ? reply.code(404).send({ status: "not_found" })
            : state === "conflict"
              ? reply.code(409).send({ status: "conflict" })
              : { status: state };
        } catch {
          return reply.code(503).send({ status: "reconciliation_unavailable" });
        }
      }
    );
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

    // Read-only alert summary; no customer identifiers, queue mutations,
    // notifications, credentials, or provider traffic.
    server.get<{ Querystring: { window?: string } }>("/ops/metrics/alerts", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, opsMetricsToken)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      const rawWindow = req.query.window ?? "60";
      if (!/^\d+$/u.test(rawWindow)) {
        return reply.code(400).send({ status: "invalid_window" });
      }
      const windowMinutes = Number(rawWindow);
      if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
        return reply.code(400).send({ status: "invalid_window" });
      }
      try {
        const snapshot = await metrics.snapshot(windowMinutes);
        return evaluateOperationalAlerts(snapshot, deps.runtimeState);
      } catch {
        return reply.code(503).send({ status: "metrics_unavailable" });
      }
    });
  }

  if (deps.localWorkerDiagnostics !== undefined && deps.opsMetricsToken !== undefined) {
    const diagnostics = deps.localWorkerDiagnostics;
    const token = deps.opsMetricsToken;
    // Per-instance observation, NOT a global/cluster-wide liveness guarantee.
    server.get("/ops/workers/local", (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      return diagnostics.snapshot();
    });
  }

  if (deps.incidentReadback !== undefined && deps.opsMetricsToken !== undefined) {
    const incidents = deps.incidentReadback;
    const token = deps.opsMetricsToken;
    server.get("/ops/incidents", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      try { return await incidents.snapshot(); }
      catch { return reply.code(503).send({ status: "incidents_unavailable" }); }
    });
  }

  if (deps.workerFleet !== undefined && deps.opsMetricsToken !== undefined) {
    const fleet = deps.workerFleet;
    const token = deps.opsMetricsToken;
    server.get("/ops/workers/fleet", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, token)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      try {
        return await fleet.snapshot();
      } catch {
        return reply.code(503).send({ status: "worker_fleet_unavailable" });
      }
    });
  }

  if (deps.tiktokMessagingAvailabilityProbe !== undefined
    && deps.opsMetricsToken !== undefined) {
    const probe = deps.tiktokMessagingAvailabilityProbe;
    const opsToken = deps.opsMetricsToken;
    server.get("/ops/tiktok/messaging/availability-probe", async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401).send({ status: "unauthorized" });
      }
      try {
        return await probe.probe();
      } catch {
        // Do not log provider responses, account identifiers or bearer tokens.
        return reply.code(503).send({ status: "probe_unavailable" });
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

  if (
    deps.tiktokBusinessMessagingWebhook !== undefined
    && deps.opsMetricsToken !== undefined
  ) {
    const tiktokBusinessMessagingWebhook = deps.tiktokBusinessMessagingWebhook;
    const opsToken = deps.opsMetricsToken;

    server.get("/ops/tiktok/messaging/webhook/status", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }

      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokBusinessMessagingWebhook.service.status();
      } catch (error) {
        deps.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Business Messaging webhook status failed"
        );
        return reply
          .code(503)
          .send({ status: "webhook_configuration_unavailable" });
      }
    });

    server.post("/ops/tiktok/messaging/webhook/reconcile", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }

      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokBusinessMessagingWebhook.service.reconcile();
      } catch (error) {
        deps.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Business Messaging webhook reconcile failed"
        );
        return reply
          .code(503)
          .send({ status: "webhook_reconcile_unavailable" });
      }
    });
  }

  if (
    deps.tiktokCommentToMessage !== undefined
    && deps.opsMetricsToken !== undefined
  ) {
    const tiktokCommentToMessage = deps.tiktokCommentToMessage;
    const opsToken = deps.opsMetricsToken;

    server.get(
      "/ops/tiktok/messaging/comment-to-message/status",
      async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply
            .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401)
            .send({ status: "unauthorized" });
        }

        reply.header("cache-control", "private, no-store");
        try {
          return await tiktokCommentToMessage.service.status();
        } catch (error) {
          if (error instanceof TikTokCommentToMessageNotAuthorizedError) {
            return reply.code(409).send({ status: "not_authorized" });
          }
          deps.logger.warn(
            { errorClass: error instanceof Error ? error.name : "unknown" },
            "TikTok Comment-to-Message status failed"
          );
          return reply
            .code(503)
            .send({ status: "comment_to_message_unavailable" });
        }
      }
    );

    server.post(
      "/ops/tiktok/messaging/comment-to-message/reconcile",
      async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply
            .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401)
            .send({ status: "unauthorized" });
        }

        reply.header("cache-control", "private, no-store");
        try {
          return await tiktokCommentToMessage.service.reconcile();
        } catch (error) {
          if (error instanceof TikTokCommentToMessageNotAuthorizedError) {
            return reply.code(409).send({ status: "not_authorized" });
          }
          deps.logger.warn(
            { errorClass: error instanceof Error ? error.name : "unknown" },
            "TikTok Comment-to-Message reconcile failed"
          );
          return reply
            .code(503)
            .send({ status: "comment_to_message_reconcile_unavailable" });
        }
      }
    );
  }

  if (
    deps.tiktokBusinessMessagingRead !== undefined
    && deps.opsMetricsToken !== undefined
  ) {
    const tiktokBusinessMessagingRead = deps.tiktokBusinessMessagingRead;
    const opsToken = deps.opsMetricsToken;

    server.get<{
      Querystring: {
        conversation_id?: string;
        conversation_type?: string;
      };
    }>("/ops/tiktok/messaging/capabilities", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }

      const conversationId = req.query.conversation_id;
      const conversationType = req.query.conversation_type;
      if (
        conversationId === undefined
        || conversationId.length === 0
        || (conversationType !== "SINGLE" && conversationType !== "STRANGER")
      ) {
        return reply.code(400).send({ status: "invalid_request" });
      }

      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokBusinessMessagingRead.service.checkImageSendCapability({
          conversationId,
          conversationType
        });
      } catch (error) {
        if (error instanceof TikTokBusinessMessagingNotAuthorizedError) {
          return reply.code(409).send({ status: "not_authorized" });
        }
        if (error instanceof TikTokBusinessMessagingValidationError) {
          return reply.code(400).send({ status: "invalid_request" });
        }
        deps.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Business Messaging capability read failed"
        );
        return reply.code(503).send({ status: "messaging_read_unavailable" });
      }
    });

    server.get<{
      Querystring: {
        conversation_type?: string;
        limit?: string;
        cursor?: string;
      };
    }>("/ops/tiktok/messaging/conversations", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }

      const conversationType = req.query.conversation_type;
      const rawLimit = req.query.limit ?? "100";
      const rawCursor = req.query.cursor;
      if (
        (conversationType !== "SINGLE" && conversationType !== "STRANGER")
        || !/^\d+$/u.test(rawLimit)
        || (rawCursor !== undefined && !/^\d+$/u.test(rawCursor))
      ) {
        return reply.code(400).send({ status: "invalid_request" });
      }

      const limit = Number(rawLimit);
      const cursor = rawCursor === undefined ? undefined : Number(rawCursor);
      if (
        !Number.isInteger(limit)
        || limit < 1
        || limit > 100
        || (
          cursor !== undefined
          && (!Number.isSafeInteger(cursor) || cursor < 0)
        )
      ) {
        return reply.code(400).send({ status: "invalid_request" });
      }

      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokBusinessMessagingRead.service.listConversations({
          conversationType,
          limit,
          ...(cursor === undefined ? {} : { cursor })
        });
      } catch (error) {
        if (error instanceof TikTokBusinessMessagingNotAuthorizedError) {
          return reply.code(409).send({ status: "not_authorized" });
        }
        if (error instanceof TikTokBusinessMessagingValidationError) {
          return reply.code(400).send({ status: "invalid_request" });
        }
        deps.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Business Messaging conversation read failed"
        );
        return reply.code(503).send({ status: "messaging_read_unavailable" });
      }
    });

    server.get<{
      Params: { conversationId: string };
    }>(
      "/ops/tiktok/messaging/conversations/:conversationId/messages",
      async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply
            .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401)
            .send({ status: "unauthorized" });
        }

        reply.header("cache-control", "private, no-store");
        try {
          return await tiktokBusinessMessagingRead.service.listMessages(
            req.params.conversationId
          );
        } catch (error) {
          if (error instanceof TikTokBusinessMessagingNotAuthorizedError) {
            return reply.code(409).send({ status: "not_authorized" });
          }
          if (error instanceof TikTokBusinessMessagingValidationError) {
            return reply.code(400).send({ status: "invalid_request" });
          }
          deps.logger.warn(
            { errorClass: error instanceof Error ? error.name : "unknown" },
            "TikTok Business Messaging message read failed"
          );
          return reply.code(503).send({ status: "messaging_read_unavailable" });
        }
      }
    );
  }

  if (
    deps.tiktokMarketingAdvertisers !== undefined
    && deps.opsMetricsToken !== undefined
  ) {
    const tiktokMarketingAdvertisers = deps.tiktokMarketingAdvertisers;
    const opsToken = deps.opsMetricsToken;

    server.get(
      "/ops/tiktok/marketing/advertisers",
      async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply
            .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401)
            .send({ status: "unauthorized" });
        }
        reply.header("cache-control", "private, no-store");
        try {
          return await tiktokMarketingAdvertisers.service.listAccounts();
        } catch (error) {
          if (error instanceof TikTokMarketingOAuthNotAuthorizedError) {
            return reply.code(409).send({ status: "not_authorized" });
          }
          deps.logger.warn(
            { errorClass: error instanceof Error ? error.name : "unknown" },
            "TikTok Marketing advertiser listing failed"
          );
          return reply.code(503).send({ status: "advertiser_list_unavailable" });
        }
      }
    );

    server.get(
      "/ops/tiktok/marketing/advertisers/verify",
      async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply
            .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401)
            .send({ status: "unauthorized" });
        }
        reply.header("cache-control", "private, no-store");
        try {
          return await tiktokMarketingAdvertisers.service.verifyAccountManagement();
        } catch (error) {
          if (error instanceof TikTokMarketingOAuthNotAuthorizedError) {
            return reply.code(409).send({ status: "not_authorized" });
          }
          deps.logger.warn(
            { errorClass: error instanceof Error ? error.name : "unknown" },
            "TikTok Marketing advertiser verification failed"
          );
          return reply
            .code(503)
            .send({ status: "advertiser_verification_unavailable" });
        }
      }
    );
  }

  if (deps.tiktokMarketingOAuth !== undefined && deps.opsMetricsToken !== undefined) {
    const tiktokMarketingOAuth = deps.tiktokMarketingOAuth;
    const opsToken = deps.opsMetricsToken;

    server.post("/ops/tiktok/marketing/oauth/start", async (req, reply) => {
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
          ...await tiktokMarketingOAuth.service.beginAuthorization()
        };
      } catch (error) {
        deps.logger.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Marketing OAuth authorization start failed"
        );
        return reply.code(503).send({ status: "oauth_unavailable" });
      }
    });

    server.get("/ops/tiktok/marketing/oauth/status", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }
      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokMarketingOAuth.service.status();
      } catch (error) {
        deps.logger.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Marketing OAuth status failed"
        );
        return reply.code(503).send({ status: "oauth_unavailable" });
      }
    });

    server.get("/ops/tiktok/marketing/oauth/verify", async (req, reply) => {
      if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
        return reply
          .header("www-authenticate", 'Bearer realm="ishikeit-ops"')
          .code(401)
          .send({ status: "unauthorized" });
      }
      reply.header("cache-control", "private, no-store");
      try {
        return await tiktokMarketingOAuth.service.verifyAccess();
      } catch (error) {
        if (error instanceof TikTokMarketingOAuthNotAuthorizedError) {
          return reply.code(409).send({ status: "not_authorized" });
        }
        deps.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "TikTok Marketing OAuth live verification failed"
        );
        return reply.code(503).send({ status: "verification_unavailable" });
      }
    });

    server.get<{
      Querystring: { state?: string; auth_code?: string; code?: string };
    }>("/ishikeit/oauth/tiktok/advertiser/callback/", async (req, reply) => {
      reply.header("cache-control", "no-store");
      const state = req.query.state;
      const authCode = req.query.auth_code;
      if (state === undefined || authCode === undefined) {
        return reply
          .code(400)
          .type("text/plain; charset=utf-8")
          .send("TikTok advertiser authorization could not be completed.");
      }

      try {
        const result = await tiktokMarketingOAuth.service.completeAuthorization(
          state,
          authCode
        );
        const count = result.advertiserIds.length;
        return reply
          .code(200)
          .type("text/plain; charset=utf-8")
          .send(
            `TikTok advertiser authorization completed for ${count} advertiser${count === 1 ? "" : "s"}. You may close this window.`
          );
      } catch (error) {
        const stateFingerprint = createHash("sha256")
          .update(state)
          .digest("hex")
          .slice(0, 12);
        deps.logger.warn(
          {
            errorClass: error instanceof Error ? error.name : "unknown",
            stateFingerprint
          },
          "TikTok Marketing OAuth callback failed"
        );
        return reply
          .code(400)
          .type("text/plain; charset=utf-8")
          .send(
            "TikTok advertiser authorization could not be completed. Start a new authorization request."
          );
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
        const diagnostic = instagramOAuthFailureDiagnostic(error);
        deps.logger.warn(
          `Instagram OAuth callback failed ${diagnostic} state_fp=${stateFingerprint} state_len=${state.length} code_len=${code.length}`
        );
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

      server.get<{ Querystring: { account_id?: string; validate_live?: string } }>
      ("/ops/instagram/oauth/status", async (req, reply) => {
        if (!verifyBearerAuthorization(req.headers.authorization, opsToken)) {
          return reply.header("www-authenticate", 'Bearer realm="ishikeit-ops"')
            .code(401).send({ status: "unauthorized" });
        }
        reply.header("cache-control", "private, no-store");
        if (req.query.validate_live !== undefined
          && req.query.validate_live !== "true"
          && req.query.validate_live !== "false") {
          return reply.code(400).send({ status: "invalid_validation_option" });
        }
        try {
          return await instagramOAuth.service.status(
            req.query.account_id,
            req.query.validate_live === "true"
          );
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

      // Authenticate raw bytes BEFORE parsing the untrusted envelope.
      // Facebook Page and WABA notifications require the main Meta App secret.
      // Instagram Login has separate product credentials, so the instagram
      // object may authenticate with either the main app or Instagram product
      // secret while the ongoing migration is verified.
      const mainSignatureValid = verifyMetaSignature(req.body, signature, deps.appSecret);
      const instagramSignatureValid = deps.instagramWebhookAppSecret !== undefined
        && verifyMetaSignature(req.body, signature, deps.instagramWebhookAppSecret);
      if (!mainSignatureValid && !instagramSignatureValid) {
        return reply.code(401).send({ status: "rejected" });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body.toString("utf8")) as unknown;
      } catch {
        return reply.code(mainSignatureValid ? 422 : 401)
          .send({ status: mainSignatureValid ? "invalid_payload" : "rejected" });
      }
      // A valid Instagram product signature NEVER authorizes a Page, WABA
      // or unrecognized Meta object. Keep existing main-app behavior.
      const objectType = typeof parsed === "object" && parsed !== null
        && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).object : undefined;
      if (!mainSignatureValid && objectType !== "instagram") {
        return reply.code(401).send({ status: "rejected" });
      }
      let events;
      try {
        events = normalizeMetaEnvelope(parsed);
      } catch {
        return reply.code(422).send({ status: "invalid_payload" });
      }
      if (objectType === "instagram") {
        // Identity-only diagnostic: never log raw body, sender, recipient,
        // credentials, signature or message contents.
        const signer = mainSignatureValid && instagramSignatureValid
          ? "both"
          : instagramSignatureValid ? "instagram_product" : "meta_app";
        // Hostinger's production log reader exposes only the log message,
        // not Pino's structured properties. Include only the bounded signer
        // category in the message so an authenticated delivery is auditable.
        deps.logger.info("Instagram webhook signature verified: signer=" + signer);
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
          const update = JSON.parse(req.body.toString("utf8")) as unknown;
          // A Telegram Business account is not the bot itself. Validate the
          // active owner and reply rights with Telegram's getBusinessConnection
          // before storing or processing any customer content.
          if (typeof update === "object" && update !== null && !Array.isArray(update)) {
            const businessMessage = (update as Record<string, unknown>).business_message;
            if (typeof businessMessage === "object" && businessMessage !== null
              && !Array.isArray(businessMessage)) {
              const message = businessMessage as Record<string, unknown>;
              const connectionId = message.business_connection_id;
              if (typeof connectionId !== "string" || telegram.verifyBusinessConnection === undefined) {
                return reply.code(200).send({ status: "business_connection_not_configured" });
              }
              let owner: { ownerId: string };
              try {
                owner = await telegram.verifyBusinessConnection(connectionId);
              } catch (error) {
                // Invalid or wrong-account connections are not retried. On a
                // transient Telegram outage return 503 so Telegram retries.
                const retryable = typeof error === "object" && error !== null
                  && "retryable" in error && error.retryable === true;
                return reply.code(retryable ? 503 : 200)
                  .send({ status: retryable ? "business_connection_unavailable" : "business_connection_ignored" });
              }
              const from = message.from;
              const chat = message.chat;
              const sender = typeof from === "object" && from !== null
                && !Array.isArray(from) ? from as Record<string, unknown> : undefined;
              const conversation = typeof chat === "object" && chat !== null
                && !Array.isArray(chat) ? chat as Record<string, unknown> : undefined;
              // Prevent owner echo, bot-to-bot loops, group forwarding and
              // cross-chat routing. Customer identity must match private chat.
              if (sender?.is_bot !== false || typeof sender.id !== "number"
                || !Number.isSafeInteger(sender.id)
                || sender.id.toString() === owner.ownerId
                || conversation?.type !== "private"
                || conversation.id !== sender.id
                || message.sender_business_bot !== undefined) {
                return reply.code(200).send({ status: "business_message_ignored" });
              }
            }
          }
          events = normalizeTelegramUpdate(update, telegram.botId);
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
