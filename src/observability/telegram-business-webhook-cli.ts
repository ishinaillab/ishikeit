import { loadEnvironment } from "../config/env.js";

const BUSINESS_UPDATES = [
  "business_connection", "business_message",
  "edited_business_message", "deleted_business_messages"
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/**
 * Private operator CLI. Read-only by default; use --reconcile to opt in
 * to a non-dropping addition of Telegram Business webhook update types.
 * It never prints tokens, webhooks, connection identifiers, or chats.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (env.NODE_ENV !== "production" || token === undefined || secret === undefined) {
    throw new Error("Telegram Business webhook prerequisites unavailable");
  }
  const reconcile = process.argv.includes("--reconcile");
  const base = "https://api.telegram.org/bot" + token + "/";
  async function call(method: string, body?: Record<string, unknown>) {
    const response = await fetch(base + method, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? "0") > 16384) {
      throw new Error("Telegram webhook provider request rejected");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Telegram webhook response unavailable");
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const value = await reader.read();
        if (value.done) break;
        if (!value.value) continue;
        count += value.value.byteLength;
        if (count > 16384) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Telegram webhook provider response oversized");
        }
        chunks.push(value.value);
      }
    } finally { reader.releaseLock(); }
    const data = record(JSON.parse(Buffer.concat(chunks, count).toString("utf8")) as unknown);
    if (data?.ok !== true) throw new Error("Telegram webhook provider result unavailable");
    return data.result;
  }
  const bot = record(await call("getMe"));
  const businessBotReady = bot?.can_connect_to_business === true;
  const data = record(await call("getWebhookInfo"));
  const url = typeof data?.url === "string" ? data.url : "";
  const expected = "https://apps.ishinaillab.com/ishikeit/webhooks/telegram";
  if (url !== expected || data?.has_custom_certificate === true) {
    throw new Error("Telegram webhook target/certificate requires manual review");
  }
  const raw = data?.allowed_updates;
  const configured = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string") : undefined;
  const missing = configured === undefined || configured.length === 0
    ? []
    : BUSINESS_UPDATES.filter((value) => !configured.includes(value));
  if (reconcile && missing.length > 0) {
    await call("setWebhook", {
      url: expected,
      secret_token: secret,
      allowed_updates: [...new Set([...configured!, ...missing])],
      drop_pending_updates: false,
      ...(typeof data?.max_connections === "number"
        ? { max_connections: data.max_connections } : {})
    });
  }
  const confirmed = record(await call("getWebhookInfo"));
  const updates = Array.isArray(confirmed?.allowed_updates)
    ? confirmed.allowed_updates.filter((x): x is string => typeof x === "string") : [];
  const businessUpdatesEnabled = updates.length === 0 ||
    BUSINESS_UPDATES.every((key) => updates.includes(key));
  console.info(JSON.stringify({
    businessBotReady,
    webhookConfigured: confirmed?.url === expected,
    businessUpdatesEnabled,
    changed: reconcile && missing.length > 0,
    pendingUpdateCount: typeof confirmed?.pending_update_count === "number"
      ? confirmed.pending_update_count : null
  }));
  if (!businessUpdatesEnabled || confirmed?.url !== expected) process.exitCode = 2;
}

void main().catch(() => {
  console.error("Telegram Business webhook inspection/reconciliation unavailable");
  process.exitCode = 1;
});
