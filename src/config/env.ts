import { z } from "zod";

const booleanFromEnv = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true")
]);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HTTP_HOST: z.string().default("127.0.0.1"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  LOG_LEVEL: z.enum(["fatal","error","warn","info","debug","trace"]).default("info"),
  DATABASE_URL: z.string().min(1).optional(),
  OPS_METRICS_TOKEN: z.string().min(32).optional(),
  OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64: z.string().min(40).max(64).optional(),

  PROCESSOR_ENABLED: booleanFromEnv.default(false),
  PROCESSOR_CUTOVER_AT: z.string().datetime({ offset: true }).optional(),
  PROCESSOR_CANARY_PARTITION_KEYS: z.string().default(""),
  WORDPRESS_AI_BRIDGE_URL: z.string().url().optional(),
  ISHI_AI_BRIDGE_TOKEN: z.string().min(32).optional(),
  AI_BRIDGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90000),
  AI_FILE_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).max(104857600).default(26214400),
  MEDIA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  VIDEO_INTERPRETER_PROVIDER: z.enum(["none", "gemini"]).default("none"),
  GEMINI_API_KEY: z.string().min(16).optional(),
  GEMINI_VIDEO_MODEL: z.string().min(1).max(128).default("gemini-3.8-flash"),
  VIDEO_INTERPRETER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(60000),
  VIDEO_INTERPRETER_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(180000),
  VIDEO_INTERPRETER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(10000).default(2000),

  META_APP_ID: z.string().min(1).default("1042452472116584"),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  ACTION_DISPATCH_ENABLED: booleanFromEnv.default(false),
  META_OUTBOUND_ENABLED: booleanFromEnv.default(false),
  META_MESSENGER_ACCESS_TOKEN: z.string().min(1).optional(),
  META_INSTAGRAM_ACCESS_TOKEN: z.string().min(1).optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  META_INSTAGRAM_GRAPH_HOST: z.enum(["graph.instagram.com", "graph.facebook.com"]).default("graph.instagram.com"),
  META_OUTBOUND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  META_INSTAGRAM_OAUTH_APP_ID: z.string().regex(/^\d+$/).optional(),
  META_INSTAGRAM_OAUTH_APP_SECRET: z.string().min(16).max(512).optional(),
  META_INSTAGRAM_OAUTH_REDIRECT_URI: z.string().url().optional(),
  META_INSTAGRAM_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  META_INSTAGRAM_TOKEN_REFRESH_SKEW_SECONDS: z.coerce.number().int().min(86400).max(2592000).default(604800),
  META_INSTAGRAM_OAUTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

  TELEGRAM_BOT_TOKEN: z.string().min(20).regex(/^[0-9]+:[A-Za-z0-9_-]+$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  TELEGRAM_OUTBOUND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

  TIKTOK_BUSINESS_APP_ID: z.string().min(1).max(256).optional(),
  TIKTOK_BUSINESS_APP_SECRET: z.string().min(16).max(512).optional(),
  TIKTOK_BUSINESS_AUTHORIZATION_URL: z.string().url().optional(),
  TIKTOK_BUSINESS_REDIRECT_URI: z.string().url().optional(),
  TIKTOK_BUSINESS_ID: z.string().min(1).max(256).optional(),
  TIKTOK_BUSINESS_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v1.3"),
  TIKTOK_WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  TIKTOK_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  TIKTOK_TOKEN_REFRESH_SKEW_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  TIKTOK_OAUTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
}).superRefine((value, ctx) => {
  if ((value.TELEGRAM_BOT_TOKEN === undefined) !== (value.TELEGRAM_WEBHOOK_SECRET === undefined)) {
    ctx.addIssue({
      code: "custom",
      path: [value.TELEGRAM_BOT_TOKEN === undefined ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_WEBHOOK_SECRET"],
      message: "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured together"
    });
  }

  const tiktokOAuthProviderKeys = [
    "TIKTOK_BUSINESS_APP_ID",
    "TIKTOK_BUSINESS_APP_SECRET",
    "TIKTOK_BUSINESS_AUTHORIZATION_URL",
    "TIKTOK_BUSINESS_REDIRECT_URI"
  ] as const;
  const configuredTikTokOAuthKeys = tiktokOAuthProviderKeys.filter(
    (key) => value[key] !== undefined
  );
  const tiktokOAuthConfigured =
    configuredTikTokOAuthKeys.length === tiktokOAuthProviderKeys.length;

  if (
    configuredTikTokOAuthKeys.length !== 0
    && !tiktokOAuthConfigured
  ) {
    for (const key of tiktokOAuthProviderKeys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "TikTok OAuth application settings must be configured together"
        });
      }
    }
  }

  if (tiktokOAuthConfigured && value.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64"],
      message: "TikTok OAuth requires OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64"
    });
  }

  if (tiktokOAuthConfigured && value.OPS_METRICS_TOKEN === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["OPS_METRICS_TOKEN"],
      message: "TikTok OAuth operations require OPS_METRICS_TOKEN"
    });
  }

  if (value.TIKTOK_BUSINESS_ID !== undefined && !tiktokOAuthConfigured) {
    ctx.addIssue({
      code: "custom",
      path: ["TIKTOK_BUSINESS_ID"],
      message: "TikTok Business Account activation requires the complete OAuth application configuration"
    });
  }

  const instagramOAuthProviderKeys = [
    "META_INSTAGRAM_OAUTH_APP_ID",
    "META_INSTAGRAM_OAUTH_APP_SECRET",
    "META_INSTAGRAM_OAUTH_REDIRECT_URI"
  ] as const;
  const configuredInstagramOAuthKeys = instagramOAuthProviderKeys.filter(
    (key) => value[key] !== undefined
  );
  const instagramOAuthConfigured =
    configuredInstagramOAuthKeys.length === instagramOAuthProviderKeys.length;

  if (
    configuredInstagramOAuthKeys.length !== 0
    && !instagramOAuthConfigured
  ) {
    for (const key of instagramOAuthProviderKeys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Instagram OAuth application settings must be configured together"
        });
      }
    }
  }

  if (instagramOAuthConfigured && value.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64"],
      message: "Instagram OAuth requires OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64"
    });
  }

  if (value.NODE_ENV === "production") {
    for (const key of ["TIKTOK_BUSINESS_AUTHORIZATION_URL", "TIKTOK_BUSINESS_REDIRECT_URI"] as const) {
      const raw = value[key];
      if (raw !== undefined) {
        const url = new URL(raw);
        if (url.protocol !== "https:") {
          ctx.addIssue({ code: "custom", path: [key], message: "TikTok production OAuth URLs must use HTTPS" });
        }
        if (key === "TIKTOK_BUSINESS_REDIRECT_URI" && !url.pathname.endsWith("/")) {
          ctx.addIssue({ code: "custom", path: [key], message: "TikTok redirect URI path must end with a slash" });
        }
      }
    }
  }

  if (value.VIDEO_INTERPRETER_PROVIDER === "gemini" && value.GEMINI_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["GEMINI_API_KEY"],
      message: "GEMINI_API_KEY is required when VIDEO_INTERPRETER_PROVIDER=gemini"
    });
  }

  if (value.PROCESSOR_ENABLED) {
    for (const key of ["WORDPRESS_AI_BRIDGE_URL", "ISHI_AI_BRIDGE_TOKEN"] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when PROCESSOR_ENABLED=true` });
      }
    }
    if (value.NODE_ENV === "production") {
      if (value.PROCESSOR_CUTOVER_AT === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["PROCESSOR_CUTOVER_AT"],
          message: "PROCESSOR_CUTOVER_AT is required when PROCESSOR_ENABLED=true in production"
        });
      }
      if (value.WORDPRESS_AI_BRIDGE_URL !== undefined) {
        const url = new URL(value.WORDPRESS_AI_BRIDGE_URL);
        if (url.protocol !== "https:") {
          ctx.addIssue({ code: "custom", path: ["WORDPRESS_AI_BRIDGE_URL"], message: "Production AI bridge URL must use HTTPS" });
        }
      }
    }
  }
});

export type Environment = z.infer<typeof schema> & {
  HTTP_PORT_EFFECTIVE: number;
  ACTION_DISPATCH_ENABLED_EFFECTIVE: boolean;
  PROCESSOR_CANARY_PARTITION_KEYS_EFFECTIVE: readonly string[];
};

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = schema.parse(input);
  const canaryPartitionKeys = parsed.PROCESSOR_CANARY_PARTITION_KEYS
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  for (const partitionKey of canaryPartitionKeys) {
    if (!/^[0-9a-f]{64}$/.test(partitionKey)) {
      throw new Error("PROCESSOR_CANARY_PARTITION_KEYS must contain comma-separated SHA-256 hex partition keys");
    }
  }

  if (new Set(canaryPartitionKeys).size !== canaryPartitionKeys.length) {
    throw new Error("PROCESSOR_CANARY_PARTITION_KEYS must not contain duplicates");
  }

  if (parsed.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 !== undefined) {
    const key = Buffer.from(parsed.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64, "base64");
    if (
      key.length !== 32
      || key.toString("base64").replace(/=+$/u, "")
        !== parsed.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64.replace(/=+$/u, "")
    ) {
      throw new Error("OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 must encode exactly 32 bytes");
    }
  }

  if (parsed.TIKTOK_BUSINESS_AUTHORIZATION_URL !== undefined) {
    const url = new URL(parsed.TIKTOK_BUSINESS_AUTHORIZATION_URL);
    if (!(url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"))) {
      throw new Error("TIKTOK_BUSINESS_AUTHORIZATION_URL must use an official TikTok host");
    }
  }

  if (parsed.TIKTOK_BUSINESS_REDIRECT_URI !== undefined) {
    const url = new URL(parsed.TIKTOK_BUSINESS_REDIRECT_URI);
    if (url.search !== "" || url.hash !== "") {
      throw new Error("TIKTOK_BUSINESS_REDIRECT_URI must not include a query string or fragment");
    }
  }

  if (parsed.META_INSTAGRAM_OAUTH_REDIRECT_URI !== undefined) {
    const url = new URL(parsed.META_INSTAGRAM_OAUTH_REDIRECT_URI);
    if (url.search !== "" || url.hash !== "") {
      throw new Error("META_INSTAGRAM_OAUTH_REDIRECT_URI must not include a query string or fragment");
    }
    if (parsed.NODE_ENV === "production") {
      if (url.protocol !== "https:") {
        throw new Error("Instagram production OAuth redirect URI must use HTTPS");
      }
      if (!url.pathname.endsWith("/")) {
        throw new Error("Instagram OAuth redirect URI path must end with a slash");
      }
    }
  }

  if (parsed.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL","META_APP_SECRET","META_WEBHOOK_VERIFY_TOKEN"] as const) {
      if (parsed[key] === undefined) throw new Error(key + " is required in production");
    }
  }
  return {
    ...parsed,
    HTTP_PORT_EFFECTIVE: parsed.HTTP_PORT ?? parsed.PORT ?? 3000,
    ACTION_DISPATCH_ENABLED_EFFECTIVE: parsed.ACTION_DISPATCH_ENABLED || parsed.META_OUTBOUND_ENABLED,
    PROCESSOR_CANARY_PARTITION_KEYS_EFFECTIVE: canaryPartitionKeys
  };
}
