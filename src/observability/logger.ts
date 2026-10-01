import pino from "pino";
import type { Environment } from "../config/env.js";

export function createLogger(env: Environment) {
  return pino({
    level: env.LOG_LEVEL,
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
        "TIKTOK_BUSINESS_ACCESS_TOKEN",
        "ISHI_AI_BRIDGE_TOKEN",
        "OPS_METRICS_TOKEN",
        "accessToken",
        "token",
        "*.accessToken",
        "*.token"
      ],
      censor: "[REDACTED]"
    }
  });
}
