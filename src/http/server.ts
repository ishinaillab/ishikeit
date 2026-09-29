import Fastify from "fastify";
import type { Logger } from "pino";
import type { InboundStore } from "../persistence/inbound.js";
import { sha256Hex } from "../persistence/inbound.js";
import { ingressIdentity, normalizeMetaEnvelope } from "../channels/meta-normalizer.js";
import { verifyMetaChallenge, verifyMetaSignature } from "../security/meta.js";

export interface ServerDeps {
  logger: Logger;
  ready: () => Promise<boolean>;
  inbound: InboundStore;
  appSecret: string;
  verifyToken: string;
  webhookBodyLimit?: number;
}

export function buildServer(deps: ServerDeps) {
  const server = Fastify({ loggerInstance: deps.logger, bodyLimit: deps.webhookBodyLimit ?? 1_048_576 });

  server.get("/health/live", async () => ({status:"ok"}));
  server.get("/health/ready", async (_req, reply) => (await deps.ready()) ? {status:"ready"} : reply.code(503).send({status:"not_ready"}));

  server.register((scope, _opts, done) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs:"buffer", bodyLimit:deps.webhookBodyLimit ?? 1_048_576 }, (_req, body, cb) => cb(null, body));

    scope.get<{Querystring:{"hub.mode"?:string;"hub.verify_token"?:string;"hub.challenge"?:string}}>("/ishikeit/webhooks/meta", async (req, reply) => {
      const challenge = verifyMetaChallenge(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"], deps.verifyToken);
      return challenge === undefined ? reply.code(403).send() : reply.code(200).type("text/plain; charset=utf-8").send(challenge);
    });

    scope.post<{Body:Buffer}>("/ishikeit/webhooks/meta", async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send({status:"unsupported_body"});
      const signature = Array.isArray(req.headers["x-hub-signature-256"]) ? req.headers["x-hub-signature-256"][0] : req.headers["x-hub-signature-256"];
      if (!verifyMetaSignature(req.body, signature, deps.appSecret)) return reply.code(401).send({status:"rejected"});

      let events;
      try {
        events = normalizeMetaEnvelope(JSON.parse(req.body.toString("utf8")) as unknown);
      } catch {
        return reply.code(422).send({status:"invalid_payload"});
      }

      const rawHash = sha256Hex(req.body);
      let created = 0;
      for (const event of events) {
        if (await deps.inbound.ingest(event, ingressIdentity(event), rawHash) === "created") created++;
      }
      return reply.code(200).send({status:created>0?"accepted":"duplicate"});
    });
    done();
  });

  return server;
}
