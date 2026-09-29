import pino from "pino";
import type { Environment } from "../config/env.js";

export function createLogger(env: Environment) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.x-hub-signature-256",
        "DATABASE_URL",
        "META_APP_SECRET",
        "META_WEBHOOK_VERIFY_TOKEN"
      ],
      censor: "[REDACTED]"
    }
  });
}
