import { loadEnvironment } from "../config/env.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { CredentialCipher } from "../auth/credential-cipher.js";
import { PostgresOAuthCredentialStore } from "../auth/oauth-store.js";
import { InstagramOAuthClient } from "../auth/instagram-oauth.js";
import { proveOneTimeInstagramRefresh } from "../observability/instagram-once-proof.js";

/**
 * Private, explicitly triggered one-time proof. Do not import into the HTTP
 * server or any recurring worker; run as a Hostinger Node.js cron script only.
 *
 * Never log credentials, provider errors, database URLs, or their raw causes.
 * Return only a bounded outcome, and always close the database pool.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  if (env.NODE_ENV !== "production"
    || env.DATABASE_URL === undefined
    || env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 === undefined
    || env.META_INSTAGRAM_OAUTH_APP_ID === undefined
    || env.META_INSTAGRAM_OAUTH_APP_SECRET === undefined) {
    throw new Error("Private Instagram renewal proof prerequisites unavailable");
  }

  const db = new PostgresDatabase(env.DATABASE_URL);
  try {
    const store = new PostgresOAuthCredentialStore(
      db,
      CredentialCipher.fromBase64(env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64)
    );
    const client = new InstagramOAuthClient({
      appId: env.META_INSTAGRAM_OAUTH_APP_ID,
      appSecret: env.META_INSTAGRAM_OAUTH_APP_SECRET,
      requestTimeoutMs: env.META_INSTAGRAM_OAUTH_REQUEST_TIMEOUT_MS
    });
    const outcome = await proveOneTimeInstagramRefresh({db,store,client});
    console.info("Instagram one-time renewal proof: " + outcome);
    if (outcome !== "succeeded" && outcome !== "already_attempted") {
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

void main().catch(() => {
  console.error("Instagram one-time renewal proof unavailable");
  process.exitCode = 1;
});
