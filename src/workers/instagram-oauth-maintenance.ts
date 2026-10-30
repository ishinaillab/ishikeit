import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import type { AccountAccessTokenProvider } from "../auth/instagram-token-manager.js";

/**
 * Runs a non-sending maintenance pass for independently verified Instagram
 * Professional accounts. An invalid, unused tester grant is never refreshed
 * merely because it exists in the OAuth store.
 */
export class InstagramOAuthMaintenance {
  constructor(private readonly options: {
    store: Pick<OAuthCredentialStore, "list" | "aliasesForCredential">;
    accessTokens: AccountAccessTokenProvider;
    hasHistoricalSignedInbound: (professionalAccountId: string) => Promise<boolean>;
    refreshSkewSeconds: number;
    now?: () => Date;
  }) {}

  async runOnce(): Promise<{ checked: number; due: number; succeeded: number; failed: number }> {
    const summary = { checked: 0, due: 0, succeeded: 0, failed: 0 };
    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    const refreshWindowMs = this.options.refreshSkewSeconds * 1000;
    const credentials = await this.options.store.list("instagram");

    for (const credential of credentials) {
      summary.checked += 1;

      if (!credential.scopes.includes("instagram_business_basic")
        || !credential.scopes.includes("instagram_business_manage_messages")
        || credential.accessExpiresAt === undefined
        || credential.accessExpiresAt.getTime() <= nowMs
        || credential.accessExpiresAt.getTime() > nowMs + refreshWindowMs) {
        continue;
      }

      // Only refresh an account with exactly one independently observed and
      // signed Professional account mapping; refuse guessing on ambiguity.
      let aliases: readonly string[];
      try {
        aliases = await this.options.store.aliasesForCredential("instagram", credential.accountId);
      } catch {
        summary.failed += 1;
        continue;
      }
      if (aliases.length !== 1 || !/^\d{10,24}$/u.test(aliases[0]!)) continue;

      let observed: boolean;
      try {
        observed = await this.options.hasHistoricalSignedInbound(aliases[0]!);
      } catch {
        summary.failed += 1;
        continue;
      }
      if (!observed) continue;

      summary.due += 1;
      try {
        // The token manager rechecks expiry under a PostgreSQL advisory lock,
        // verifies Meta's refreshed account identity and persists encrypted.
        const token = await this.options.accessTokens.getAccessToken(aliases[0]!);
        if (token === undefined) {
          summary.failed += 1;
        } else {
          summary.succeeded += 1;
        }
      } catch {
        // No retry storm: next bounded periodic pass or routine outbound can
        // independently refresh. Never expose provider responses or tokens.
        summary.failed += 1;
      }
    }

    return summary;
  }
}
