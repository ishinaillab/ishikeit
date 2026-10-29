import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { metaGraphProof, withMetaGraphProof } from "../src/channels/meta-graph-proof.js";

describe("Meta Graph appsecret_proof", () => {
  it("computes the Meta HMAC-SHA256 token proof without including the raw token", () => {
    const token = "test-token";
    const appSecret = "matching-app-secret";
    const expected = createHmac("sha256", appSecret).update(token).digest("hex");
    expect(metaGraphProof(token, appSecret)).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
    expect(expected).not.toContain(token);
  });

  it("preserves existing Graph query parameters and never mutates the caller URL", () => {
    const original = new URL("https://graph.facebook.com/v26.0/123?fields=id&limit=100");
    const signed = withMetaGraphProof(original, "token", "matching-app-secret");
    expect(original.searchParams.has("appsecret_proof")).toBe(false);
    expect(signed.searchParams.get("fields")).toBe("id");
    expect(signed.searchParams.get("limit")).toBe("100");
    expect(signed.searchParams.get("appsecret_proof")).toBe(metaGraphProof("token", "matching-app-secret"));
    expect(signed.toString()).not.toContain("token");
    expect(signed.toString()).not.toContain("matching-app-secret");
  });

  it.each([
    "http://graph.facebook.com/v26.0/123",
    "https://graph.instagram.com/v26.0/123",
    "https://lookaside.fbsbx.com/whatsapp_business/attachments/file",
    "https://graph.facebook.com.evil.example/v26.0/123",
    "https://user:pass@graph.facebook.com/v26.0/123",
    "https://graph.facebook.com:8443/v26.0/123"
  ])("rejects proof on non-HTTPS-Facebook-Graph endpoints: %s", (url) => {
    expect(() => withMetaGraphProof(new URL(url), "token", "secret")).toThrow();
  });

  it("rejects missing token or app secret", () => {
    expect(() => metaGraphProof("", "secret")).toThrow();
    expect(() => metaGraphProof("token", "")).toThrow();
  });
});
