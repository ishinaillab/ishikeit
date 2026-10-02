import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignedRequest } from "../src/security/meta-signed-request.js";

function sign(payload: Record<string, unknown>, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return signature + "." + encodedPayload;
}

describe("Meta signed requests", () => {
  it("verifies HMAC-SHA256 and extracts the app-scoped user ID", () => {
    const signed = sign({
      algorithm: "HMAC-SHA256",
      issued_at: 1790928000,
      user_id: "17841430000000000"
    }, "instagram-secret");
    expect(verifyMetaSignedRequest(signed, "instagram-secret")).toEqual({
      algorithm: "HMAC-SHA256",
      issuedAt: 1790928000,
      userId: "17841430000000000"
    });
  });

  it("rejects tampering, the wrong secret, and unsupported algorithms", () => {
    const valid = sign({
      algorithm: "HMAC-SHA256",
      user_id: "17841430000000000"
    }, "instagram-secret");

    expect(verifyMetaSignedRequest(valid, "wrong-secret")).toBeUndefined();
    expect(verifyMetaSignedRequest(valid + "x", "instagram-secret")).toBeUndefined();

    const unsupported = sign({
      algorithm: "HMAC-SHA1",
      user_id: "17841430000000000"
    }, "instagram-secret");
    expect(verifyMetaSignedRequest(unsupported, "instagram-secret")).toBeUndefined();
  });
});
