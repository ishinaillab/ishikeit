import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyBearerAuthorization(
  authorization: string | string[] | undefined,
  expectedToken: string
): boolean {
  if (typeof authorization !== "string") return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const supplied = authorization.slice(prefix.length);
  if (supplied.length === 0) return false;
  return timingSafeEqual(digest(supplied), digest(expectedToken));
}
