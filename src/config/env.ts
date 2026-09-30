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
  META_OUTBOUND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
}).superRefine((value, ctx) => {
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
