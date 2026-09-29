import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (signatureHeader === undefined) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader);
  if (match === null) return false;

  const supplied = Buffer.from(match[1]!, "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyMetaChallenge(
  mode: string | undefined,
  suppliedToken: string | undefined,
  challenge: string | undefined,
  expectedToken: string
): string | undefined {
  if (mode !== "subscribe" || suppliedToken === undefined || challenge === undefined) return undefined;
  const a = Buffer.from(suppliedToken);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return challenge;
}
