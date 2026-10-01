import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedCredentialValue {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export class CredentialCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("OAuth credential encryption key must be 32 bytes");
  }

  encrypt(value: string, aad: string): EncryptedCredentialValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final()
    ]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }

  decrypt(value: EncryptedCredentialValue, aad: string): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, value.iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(value.tag);
    return Buffer.concat([
      decipher.update(value.ciphertext),
      decipher.final()
    ]).toString("utf8");
  }

  static fromBase64(value: string): CredentialCipher {
    const key = Buffer.from(value, "base64");
    if (key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) {
      throw new Error("OAuth credential encryption key must be valid base64");
    }
    return new CredentialCipher(key);
  }
}
