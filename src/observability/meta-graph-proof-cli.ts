import { loadEnvironment } from "../config/env.js";
import { MetaGraphTokenPreflight } from "../security/meta-graph-preflight.js";

/**
 * Manually invoked, read-only operator probe.
 * Never prints tokens, app secrets, Page IDs, provider errors, or Graph URLs.
 * It neither changes Meta application settings nor sends customer messages.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  if (env.NODE_ENV !== "production"
    || env.META_APP_SECRET === undefined) {
    throw new Error("Meta Graph operator preflight unavailable");
  }
  const probe = new MetaGraphTokenPreflight({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    graphVersion: env.META_GRAPH_API_VERSION,
    messengerToken: env.META_MESSENGER_ACCESS_TOKEN,
    whatsappToken: env.META_WHATSAPP_ACCESS_TOKEN,
    requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
  });
  const result = await probe.probe();
  console.info(JSON.stringify(result));
  // Do not interpret a failed preflight as permission to enable proof.
  process.exitCode = Object.values(result.channels).every(
    (state) => state === "proof_compatible" || state === "not_configured"
  ) ? 0 : 2;
}
void main().catch(() => {
  console.error("Meta Graph operator preflight unavailable");
  process.exitCode = 1;
});
