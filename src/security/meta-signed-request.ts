import { createHmac, timingSafeEqual } from "node:crypto";

export interface MetaSignedRequestPayload {
  algorithm: string;
  userId: string;
  issuedAt?: number;
  expiresAt?: number;
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return undefined;
  }
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
export function verifyMetaSignedRequest(
  signedRequest: string,
  appSecret: string
): MetaSignedRequestPayload | undefined {
  const parts = signedRequest.split(".");
  if (parts.length !== 2) return undefined;
  const encodedSignature = parts[0];
  const encodedPayload = parts[1];
  if (encodedSignature === undefined || encodedPayload === undefined) return undefined;

  const supplied = decodeBase64Url(encodedSignature);
  const payloadBytes = decodeBase64Url(encodedPayload);
  if (supplied === undefined || payloadBytes === undefined) return undefined;

  const expected = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return undefined;
  }
  let body: unknown;
  try {
    body = JSON.parse(payloadBytes.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) return undefined;

  const record = body as Record<string, unknown>;
  const algorithm = typeof record.algorithm === "string" ? record.algorithm : "";
  const userId = typeof record.user_id === "string" ? record.user_id : "";
  if (algorithm.toUpperCase() !== "HMAC-SHA256" || userId.length === 0) {
    return undefined;
  }

  const issuedAt = integerValue(record.issued_at);
  const expiresAt = integerValue(record.expires);
  return {
    algorithm: "HMAC-SHA256",
    userId,
    ...(issuedAt === undefined ? {} : { issuedAt }),
    ...(expiresAt === undefined ? {} : { expiresAt })
  };
}
