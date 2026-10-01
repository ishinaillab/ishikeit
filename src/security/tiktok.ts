import { createHmac, timingSafeEqual } from "node:crypto";

export interface TikTokSignatureVerificationOptions {
  nowSeconds?: number;
  maxAgeSeconds?: number;
}

function parseSignatureHeader(value: string | undefined): { timestamp: string; signature: string } | undefined {
  if (value === undefined) return undefined;
  const fields = new Map<string, string>();
  for (const component of value.split(",")) {
    const index = component.indexOf("=");
    if (index <= 0) continue;
    fields.set(component.slice(0, index).trim().toLowerCase(), component.slice(index + 1).trim());
  }
  const timestamp = fields.get("t");
  const signature = fields.get("s");
  if (timestamp === undefined || signature === undefined) return undefined;
  if (!/^[0-9]+$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return undefined;
  return { timestamp, signature: signature.toLowerCase() };
}

export function verifyTikTokSignature(
  rawBody: Buffer,
  header: string | undefined,
  clientSecret: string,
  options: TikTokSignatureVerificationOptions = {}
): boolean {
  const parsed = parseSignatureHeader(header);
  if (parsed === undefined) return false;

  const timestamp = Number(parsed.timestamp);
  if (!Number.isSafeInteger(timestamp)) return false;

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  if (Math.abs(nowSeconds - timestamp) > maxAgeSeconds) return false;

  const signedPayload = Buffer.concat([
    Buffer.from(parsed.timestamp + ".", "utf8"),
    rawBody
  ]);
  const expectedHex = createHmac("sha256", clientSecret).update(signedPayload).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(parsed.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
