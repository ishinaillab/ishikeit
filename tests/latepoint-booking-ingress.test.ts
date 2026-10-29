import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { InboundStore } from "../src/persistence/inbound.js";
import { normalizeLatePointBookingChange } from "../src/appointments/latepoint-booking-ingress.js";

const secret = "latepoint-test-secret-value-at-least-32-characters";
const now = new Date();
const timestamp = String(Math.floor(now.getTime() / 1000));
const occurredAt = now.toISOString();
const defaultChange = {
  schemaVersion: 1,
  source: "www.ishinaillab.com",
  bookingId: "123",
  change: "updated",
  status: "approved",
  startsAt: new Date(now.getTime() + 2 * 86400_000).toISOString(),
  occurredAt
};

function signed(payload: string, time = timestamp, key = secret) {
  return {
    "content-type": "application/json",
    "x-ishi-latepoint-timestamp": time,
    "x-ishi-latepoint-signature-256": "sha256=" + createHmac("sha256", key)
      .update(time + "." + payload).digest("hex")
  };
}

function harness(enabled = true, publicKeyPem?: string) {
  const seen = new Set<string>();
  const ingest = vi.fn<InboundStore["ingest"]>().mockImplementation((_event, identity) => {
    if (seen.has(identity.deduplicationKey)) return Promise.resolve("duplicate");
    seen.add(identity.deduplicationKey);
    return Promise.resolve("created");
  });
  const server = buildServer({
    logger: pino({ level: "silent" }),
    ready: () => Promise.resolve(true),
    inbound: { ingest },
    appSecret: "meta-test-secret",
    verifyToken: "fake-verification-token",
    ...(enabled ? { latePointWebhook: publicKeyPem === undefined ? { secret } : { publicKeyPem } } : {})
  });
  return { ingest, server, seen };
}

describe("LatePoint signed booking lifecycle webhook (no WhatsApp dispatch)", () => {
  it("remains unregistered when the independent signing key is absent", async () => {
    const { server, ingest } = harness(false);
    try {
      const r = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        payload: JSON.stringify(defaultChange),
        headers: signed(JSON.stringify(defaultChange))
      });
      expect(r.statusCode).toBe(404);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("rejects missing/invalid signatures, stale timestamps and forged key", async () => {
    const { server, ingest } = harness();
    const payload = JSON.stringify(defaultChange);
    const cases = [
      {},
      { "x-ishi-latepoint-timestamp": timestamp },
      signed(payload, timestamp, "another-valid-but-forged-secret-value-123"),
      signed(payload, String(Math.floor(Date.now() / 1000) - 600)),
      signed(payload, timestamp.replace(/.$/u, "x"))
    ];
    try {
      for (const overrides of cases) {
        const r = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/latepoint",
          payload, headers: { "content-type": "application/json", ...overrides }
        });
        expect(r.statusCode).toBe(401);
      }
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("durably ingests PII-free created/changed/cancelled/deleted event and deduplicates retries", async () => {
    const { server, ingest, seen } = harness();
    try {
      const variants = [
        defaultChange,
        { ...defaultChange, change: "created" },
        { ...defaultChange, change: "updated", status: "cancelled" },
        { ...defaultChange, change: "deleted", status: "deleted", startsAt: null }
      ];
      for (const change of variants) {
        const payload = JSON.stringify(change);
        const first = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/latepoint",
          headers: signed(payload), payload
        });
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ status: "accepted" });
        const retry = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/latepoint",
          headers: signed(payload), payload
        });
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual({ status: "duplicate" });
      }
      expect(ingest).toHaveBeenCalledTimes(8);
      expect(seen.size).toBe(4);
      for (const [event, identity] of ingest.mock.calls) {
        expect(event.provider).toBe("latepoint");
        expect(event.channel).toBe("bookings");
        expect(event.capability).toBe("booking");
        expect(event.content).toEqual([]);
        expect(event.identityId).toBeUndefined();
        expect(JSON.stringify(event)).not.toMatch(/customerName|phone|email|notes/);
        expect(identity.partitionKey).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally { await server.close(); }
  });

  it("rejects extra customer fields, malformed statuses/times, unknown source, and invalid payloads", async () => {
    const { server, ingest } = harness();
    const changes = [
      { ...defaultChange, phone: "639123456789" },
      { ...defaultChange, status: "rescheduled" },
      { ...defaultChange, startsAt: "2026-10-29 11:00:00" },
      { ...defaultChange, source: "security-staging.ishinaillab.com" },
      { ...defaultChange, occurredAt: new Date(Date.now() + 3600_000).toISOString() },
      { ...defaultChange, change: "deleted", status: "deleted" },
      { ...defaultChange, change: "updated", startsAt: null }
    ];
    try {
      for (const change of changes) {
        const payload = JSON.stringify(change);
        const r = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/latepoint",
          headers: signed(payload), payload
        });
        expect(r.statusCode).toBe(422);
      }
      const invalidJson = '{"schemaVersion":';
      const malformed = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: signed(invalidJson), payload: invalidJson
      });
      expect(malformed.statusCode).toBe(422);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("rejects oversize signed payload without ingesting it", async () => {
    const { server, ingest } = harness();
    const payload = JSON.stringify({ ...defaultChange, padding: "x".repeat(5000) });
    try {
      const r = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: signed(payload), payload
      });
      expect(r.statusCode).toBe(413);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("preserves booking identity across revisions but changes the event id on a valid update", () => {
    const one = normalizeLatePointBookingChange(defaultChange);
    const two = normalizeLatePointBookingChange({
      ...defaultChange,
      status: "cancelled",
      occurredAt: new Date(now.getTime() + 1000).toISOString()
    });
    expect(one.identity.partitionKey).toBe(two.identity.partitionKey);
    expect(one.identity.deduplicationKey).not.toBe(two.identity.deduplicationKey);
    expect(one.event.providerEventId).not.toBe(two.event.providerEventId);
  });

  it("rejects duplicate signing header arrays or weak keys at server construction", async () => {
    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest: () => Promise.resolve("created") },
      appSecret: "meta-secret",
      verifyToken: "meta-verification-token",
      latePointWebhook: { secret: "weak" }
    })).toThrow(/32-byte/);
    const { server, ingest } = harness();
    const payload = JSON.stringify(defaultChange);
    try {
      const r = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: {
          "content-type": "application/json",
          "x-ishi-latepoint-timestamp": timestamp,
          "x-ishi-latepoint-signature-256": "invalid"
        },
        payload
      });
      expect(r.statusCode).toBe(401);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});

const keyPair = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

function signedP256(body: string, time: string = timestamp, key: string = keyPair.privateKey) {
  const message = Buffer.concat([
    Buffer.from("ishi-latepoint-booking-v2\n" + time + "\n", "utf8"),
    Buffer.from(body)
  ]);
  return {
    "content-type": "application/json",
    "x-ishi-latepoint-timestamp": time,
    "x-ishi-latepoint-signature-p256": sign("sha256", message, key).toString("base64url")
  };
}

describe("LatePoint P-256 asymmetric production signature verifier", () => {
  it("verifies an actual ECDSA signature and durable replay dedup without a shared secret", async () => {
    const { server, ingest } = harness(true, keyPair.publicKey);
    const raw = JSON.stringify(defaultChange);
    try {
      const a = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: signedP256(raw), payload: raw
      });
      expect(a.statusCode).toBe(200);
      expect(a.json()).toEqual({ status: "accepted" });
      const b = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: signedP256(raw), payload: raw
      });
      expect(b.statusCode).toBe(200);
      expect(b.json()).toEqual({ status: "duplicate" });
      expect(ingest).toHaveBeenCalledTimes(2);
    } finally { await server.close(); }
  });

  it("rejects modified body, old timestamp, forged signer, malformed sig and HMAC fallback", async () => {
    const { server, ingest } = harness(true, keyPair.publicKey);
    const raw = JSON.stringify(defaultChange);
    const another = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    try {
      const probes = [
        { headers: signedP256(raw), payload: JSON.stringify({ ...defaultChange, status: "cancelled" }) },
        { headers: signedP256(raw, String(Number(timestamp) - 600)), payload: raw },
        { headers: signedP256(raw, timestamp, another.privateKey), payload: raw },
        { headers: { ...signedP256(raw), "x-ishi-latepoint-signature-p256": "not-base64!" }, payload: raw },
        { headers: signed(raw), payload: raw },
        { headers: { "content-type": "application/json" }, payload: raw }
      ];
      for (const p of probes) {
        const r = await server.inject({ method: "POST", url: "/ishikeit/webhooks/latepoint", ...p });
        expect(r.statusCode).toBe(401);
      }
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("rejects wrong curve and invalid public keys at boot", () => {
    const wrongCurve = generateKeyPairSync("ec", {
      namedCurve: "secp384r1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    for (const publicKeyPem of [wrongCurve.publicKey, "invalid", ""]) {
      expect(() => harness(true, publicKeyPem)).toThrow();
    }
  });

  it("authenticates before JSON validation and never ingests a signed malformed payload", async () => {
    const { server, ingest } = harness(true, keyPair.publicKey);
    const invalid = JSON.stringify({ ...defaultChange, email: "test@example.invalid" });
    try {
      const r = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/latepoint",
        headers: signedP256(invalid), payload: invalid
      });
      expect(r.statusCode).toBe(422);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
