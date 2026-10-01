import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTikTokSignature } from "../src/security/tiktok.js";

function header(raw: Buffer, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(String(timestamp) + "."), raw]))
    .digest("hex");
  return `t=${timestamp},s=${signature}`;
}

describe("TikTok webhook signature", () => {
  it("verifies the exact raw body and timestamp", () => {
    const raw = Buffer.from('{"event":"im_receive_msg"}');
    const secret = "tiktok-client-secret-value";
    expect(verifyTikTokSignature(raw, header(raw, secret, 1000), secret, {
      nowSeconds: 1000
    })).toBe(true);
  });

  it("rejects tampered bodies and stale signatures", () => {
    const raw = Buffer.from('{"event":"im_receive_msg"}');
    const secret = "tiktok-client-secret-value";
    const signed = header(raw, secret, 1000);
    expect(verifyTikTokSignature(Buffer.from("{}"), signed, secret, {
      nowSeconds: 1000
    })).toBe(false);
    expect(verifyTikTokSignature(raw, signed, secret, {
      nowSeconds: 1401,
      maxAgeSeconds: 300
    })).toBe(false);
  });

  it("rejects malformed signature headers", () => {
    expect(verifyTikTokSignature(Buffer.from("{}"), "t=x,s=nope", "secret", {
      nowSeconds: 1000
    })).toBe(false);
  });
});
