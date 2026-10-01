import { describe, expect, it } from "vitest";
import { CredentialCipher } from "../src/auth/credential-cipher.js";

describe("CredentialCipher", () => {
  it("encrypts and decrypts with AES-256-GCM and bound AAD", () => {
    const cipher = CredentialCipher.fromBase64(Buffer.alloc(32, 7).toString("base64"));
    const encrypted = cipher.encrypt("secret-token", "provider\0account\0access");

    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.tag).toHaveLength(16);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("secret-token");
    expect(cipher.decrypt(encrypted, "provider\0account\0access")).toBe("secret-token");
    expect(() => cipher.decrypt(encrypted, "provider\0other\0access")).toThrow();
  });

  it("requires a valid 32-byte base64 key", () => {
    expect(() => CredentialCipher.fromBase64("not-base64")).toThrow();
    expect(() => CredentialCipher.fromBase64(Buffer.alloc(31).toString("base64"))).toThrow();
  });
});
