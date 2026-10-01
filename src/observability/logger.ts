import pino from "pino";
import type { Environment } from "../config/env.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

export function sanitizeRequestForLog(request: unknown): Record<string, unknown> {
  const value = record(request);
  if (value === undefined) return {};

  const method = typeof value.method === "string" ? value.method : undefined;
  const id = typeof value.id === "string" || typeof value.id === "number"
    ? value.id
    : undefined;
  const rawUrl = typeof value.url === "string" ? value.url : undefined;
  const url = rawUrl === undefined ? undefined : rawUrl.split("?", 1)[0];

  return {
    ...(id === undefined ? {} : { id }),
    ...(method === undefined ? {} : { method }),
    ...(url === undefined ? {} : { url })
  };
}

export function createLogger(env: Environment) {
  return pino({
    level: env.LOG_LEVEL,
    serializers: {
      req: sanitizeRequestForLog
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers[\"x-hub-signature-256\"]",
        "req.headers[\"x-telegram-bot-api-secret-token\"]",
        "req.headers[\"tiktok-signature\"]",
        "DATABASE_URL",
        "META_APP_SECRET",
        "META_WEBHOOK_VERIFY_TOKEN",
        "META_MESSENGER_ACCESS_TOKEN",
        "META_INSTAGRAM_ACCESS_TOKEN",
        "META_WHATSAPP_ACCESS_TOKEN",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
        "TIKTOK_BUSINESS_APP_SECRET",
        "OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64",
        "ISHI_AI_BRIDGE_TOKEN",
        "OPS_METRICS_TOKEN",
        "accessToken",
        "refreshToken",
        "token",
        "*.accessToken",
        "*.refreshToken",
        "*.token"
      ],
      censor: "[REDACTED]"
    }
  });
}
