import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";

const bookingSnapshot = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("www.ishinaillab.com"),
  bookingId: z.string().regex(/^[1-9][0-9]{0,17}$/),
  change: z.enum(["created", "updated", "deleted"]),
  status: z.enum(["approved", "pending", "cancelled", "no_show", "completed", "deleted"]),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  occurredAt: z.string().datetime({ offset: true })
}).strict().superRefine((value, ctx) => {
  if ((value.change === "deleted") !== (value.status === "deleted")) {
    ctx.addIssue({
      code: "custom",
      message: "deletion change and status must agree"
    });
  }
  if (value.change !== "deleted" && value.startsAt === null) {
    ctx.addIssue({
      code: "custom",
      message: "active booking changes require a UTC appointment start"
    });
  }
  if (value.change === "deleted" && value.startsAt !== null) {
    ctx.addIssue({
      code: "custom",
      message: "deletion tombstones must not contain an appointment start"
    });
  }
});

/** No customer name, phone, email, booking notes or payment information crosses this webhook. */
export type LatePointBookingChange = z.infer<typeof bookingSnapshot>;

export function verifyLatePointWebhook(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  now: Date = new Date()
): boolean {
  if (Buffer.byteLength(secret, "utf8") < 32
    || timestamp === undefined || !/^[1-9][0-9]{9}$/.test(timestamp)
    || signature === undefined || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)
    || !Number.isFinite(now.getTime())
    || Math.abs(Math.floor(now.getTime() / 1000) - seconds) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp, "utf8")
    .update(".")
    .update(rawBody)
    .digest();
  const provided = Buffer.from(signature.slice(7), "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Validate the pinned verifier at boot. Never rely on an unvalidated key at request time. */
export function assertLatePointPublicKey(publicKeyPem: string): void {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ec"
    || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("LatePoint public verifier must use ECDSA P-256");
  }
}

/**
 * Asymmetric SHA-256/ECDSA P-256 verification. The PHP private key stays
 * outside WordPress public_html and never reaches Hostinger's masked Node env.
 * Domain separation prevents reuse of signatures from unrelated protocols.
 */
export function verifyLatePointAsymmetricWebhook(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  publicKeyPem: string,
  now: Date = new Date()
): boolean {
  if (timestamp === undefined || !/^[1-9][0-9]{9}$/.test(timestamp)
    || signature === undefined || !/^[A-Za-z0-9_-]{80,128}$/.test(signature)) {
    return false;
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(now.getTime())
    || Math.abs(Math.floor(now.getTime() / 1000) - seconds) > 300) return false;
  try {
    const signatureBytes = Buffer.from(signature, "base64url");
    if (signatureBytes.toString("base64url") !== signature) return false;
    const message = Buffer.concat([
      Buffer.from("ishi-latepoint-booking-v2\n" + timestamp + "\n", "utf8"),
      rawBody
    ]);
    return verify("sha256", message, publicKeyPem, signatureBytes);
  } catch {
    return false;
  }
}

export function normalizeLatePointBookingChange(
  body: unknown,
  receivedAt: string = new Date().toISOString()
): { event: CanonicalEvent; identity: IngressIdentity } {
  const input = bookingSnapshot.parse(body);
  if (Date.parse(input.occurredAt) > Date.parse(receivedAt) + 300_000) {
    throw new Error("LatePoint booking change timestamp is in the future");
  }
  const stable = createHash("sha256").update(JSON.stringify([
    "latepoint-booking-change-v1",
    input.bookingId,
    input.change,
    input.status,
    input.startsAt,
    input.occurredAt
  ])).digest("hex");
  const partitionKey = createHash("sha256")
    .update(JSON.stringify(["latepoint-booking-partition-v1", input.bookingId]))
    .digest("hex");
  const event: CanonicalEvent = {
    specversion: "1.0",
    schemaVersion: 2,
    id: "booking:" + stable,
    source: "urn:ishikeit:source:latepoint:bookings:www.ishinaillab.com",
    type: "com.ishikeit.booking.booking.changed",
    provider: "latepoint",
    channel: "bookings",
    capability: "booking",
    accountId: input.source,
    eventType: "booking.changed",
    providerEventId: stable,
    occurredAt: input.occurredAt,
    receivedAt,
    content: [],
    data: {
      bookingId: input.bookingId,
      change: input.change,
      status: input.status,
      startsAt: input.startsAt
    }
  };
  return {
    event,
    identity: { deduplicationKey: stable, partitionKey }
  };
}
