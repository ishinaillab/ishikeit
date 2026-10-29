import { createHmac } from "node:crypto";

/**
 * Meta's appsecret_proof for HTTPS server-to-server Facebook Graph requests.
 * Pass the app secret for the app that issued the access token. Instagram Login
 * uses a separate product app; do not apply this helper to its tokens.
 *
 * The resulting proof is an HMAC, not the app secret, but must not be logged.
 */
export function metaGraphProof(accessToken: string, appSecret: string): string {
  if (accessToken.trim().length === 0 || appSecret.length === 0) {
    throw new Error("Meta Graph proof requires a nonempty access token and app secret");
  }
  return createHmac("sha256", appSecret).update(accessToken, "utf8").digest("hex");
}

/**
 * Refuse non-Facebook Graph URLs, credentials in the URL, and redirects.
 * Callers must continue using redirect: "error" for signed Graph requests.
 */
export function withMetaGraphProof(
  url: URL,
  accessToken: string,
  appSecret: string
): URL {
  if (url.protocol !== "https:"
    || url.hostname !== "graph.facebook.com"
    || url.port !== ""
    || url.username !== ""
    || url.password !== "") {
    throw new Error("Meta Graph proof is only allowed on HTTPS graph.facebook.com");
  }

  const copy = new URL(url.toString());
  copy.searchParams.set("appsecret_proof", metaGraphProof(accessToken, appSecret));
  return copy;
}
