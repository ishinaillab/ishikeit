/**
 * Configuration-only TikTok Business Messaging activation preflight.
 * Returns no secret values, account identifiers, or unsupported provider claims.
 */
export const tikTokActivationKeys = [
  "TIKTOK_BUSINESS_APP_ID",
  "TIKTOK_BUSINESS_APP_SECRET",
  "TIKTOK_BUSINESS_AUTHORIZATION_URL",
  "TIKTOK_BUSINESS_REDIRECT_URI",
  "TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL",
  "TIKTOK_BUSINESS_ID",
  "OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64",
  "OPS_METRICS_TOKEN"
] as const;

type TikTokActivationKey = typeof tikTokActivationKeys[number];
type TikTokActivationInput = Partial<Record<TikTokActivationKey, unknown>>;

export interface TikTokActivationPreflight {
  schema: 1;
  status: "configuration_incomplete" | "provider_verification_required";
  configuration: {
    appCredentials: boolean;
    oauthFlow: boolean;
    webhookManagement: boolean;
    accountTarget: boolean;
  };
  missingKeys: readonly TikTokActivationKey[];
  providerProductAccess: "unverified";
  accountOAuthAuthorization: "unverified";
  webhookProviderReadback: "unverified";
}

/** Configuration presence is not evidence of TikTok provider permission. */
export function inspectTikTokActivationConfiguration(
  input: TikTokActivationInput
): TikTokActivationPreflight {
  const present = (key: TikTokActivationKey): boolean =>
    typeof input[key] === "string" && input[key].trim().length > 0;
  const all = (...keys: TikTokActivationKey[]): boolean => keys.every(present);
  const appCredentials = all("TIKTOK_BUSINESS_APP_ID", "TIKTOK_BUSINESS_APP_SECRET");
  const oauthFlow = appCredentials && all(
    "TIKTOK_BUSINESS_AUTHORIZATION_URL",
    "TIKTOK_BUSINESS_REDIRECT_URI",
    "OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64",
    "OPS_METRICS_TOKEN"
  );
  const webhookManagement = appCredentials && all(
    "TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL", "OPS_METRICS_TOKEN"
  );
  const accountTarget = oauthFlow && present("TIKTOK_BUSINESS_ID");
  const missingKeys = tikTokActivationKeys.filter((key) => !present(key));
  return {
    schema: 1,
    status: missingKeys.length === 0
      ? "provider_verification_required"
      : "configuration_incomplete",
    configuration: {
      appCredentials,
      oauthFlow,
      webhookManagement,
      accountTarget
    },
    missingKeys,
    providerProductAccess: "unverified",
    accountOAuthAuthorization: "unverified",
    webhookProviderReadback: "unverified"
  };
}
