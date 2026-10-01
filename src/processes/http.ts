import { MetaSender } from "../channels/meta-send.js";
import { loadEnvironment } from "../config/env.js";
import { ActionDispatcher } from "../dispatch/dispatcher.js";
import { MetaMessagingAdapter } from "../adapters/meta/messaging.js";
import { TelegramMessagingAdapter } from "../adapters/telegram/messaging.js";
import { TikTokBusinessMessagingAdapter } from "../adapters/tiktok/messaging.js";
import { WordPressBrainClient } from "../brain/wordpress.js";
import { buildServer } from "../http/server.js";
import { MetaMediaResolver } from "../media/meta.js";
import { TelegramMediaResolver } from "../media/telegram.js";
import { TikTokMediaResolver } from "../media/tiktok.js";
import { GeminiVideoInterpreter } from "../media/gemini-video.js";
import { MediaInterpreterRegistry } from "../media/interpreter.js";
import { MediaResolverRegistry } from "../media/resolver.js";
import { createLogger } from "../observability/logger.js";
import { PostgresOperationalMetrics } from "../observability/operational-metrics.js";
import { PostgresInboundEventRepository, PostgresInboundStore } from "../persistence/inbound.js";
import { PostgresOutboxStore } from "../persistence/outbox.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { MessageReceivedHandler } from "../processing/message-handler.js";
import { EventHandlerRegistry } from "../processing/registry.js";
import { InboundProcessorWorker } from "../workers/inbound-processor-worker.js";
import { OutboxWorker } from "../workers/outbox-worker.js";
import { TelegramSender } from "../channels/telegram-send.js";
import { TikTokBusinessSender } from "../channels/tiktok-send.js";
import { telegramBotIdFromToken } from "../security/telegram.js";

const env = loadEnvironment();
const logger = createLogger(env);

if (env.DATABASE_URL === undefined || env.META_APP_SECRET === undefined || env.META_WEBHOOK_VERIFY_TOKEN === undefined) {
  throw new Error("DATABASE_URL, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN are required to start the HTTP service");
}

const db = new PostgresDatabase(env.DATABASE_URL);
const queue = new PostgresOutboxStore(db);
const telegram = env.TELEGRAM_BOT_TOKEN === undefined || env.TELEGRAM_WEBHOOK_SECRET === undefined
  ? undefined
  : {
      botId: telegramBotIdFromToken(env.TELEGRAM_BOT_TOKEN),
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET
    };
const tiktok = (
  env.TIKTOK_BUSINESS_APP_ID === undefined
  || env.TIKTOK_BUSINESS_APP_SECRET === undefined
  || env.TIKTOK_BUSINESS_ID === undefined
  || env.TIKTOK_BUSINESS_ACCESS_TOKEN === undefined
)
  ? undefined
  : {
      appId: env.TIKTOK_BUSINESS_APP_ID,
      clientSecret: env.TIKTOK_BUSINESS_APP_SECRET,
      businessId: env.TIKTOK_BUSINESS_ID,
      maxSignatureAgeSeconds: env.TIKTOK_WEBHOOK_MAX_AGE_SECONDS
    };
const server = buildServer({
  logger,
  ready: () => db.ready(),
  inbound: new PostgresInboundStore(db),
  appSecret: env.META_APP_SECRET,
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  ...(telegram === undefined ? {} : { telegram }),
  ...(tiktok === undefined ? {} : { tiktok }),
  ...(env.OPS_METRICS_TOKEN === undefined
    ? {}
    : {
        metrics: new PostgresOperationalMetrics(db),
        opsMetricsToken: env.OPS_METRICS_TOKEN
      }),
  runtimeState: {
    processorEnabled: env.PROCESSOR_ENABLED,
    actionDispatchEnabled: env.ACTION_DISPATCH_ENABLED_EFFECTIVE,
    processorCutoverAt: env.PROCESSOR_CUTOVER_AT ?? null,
    processorCanaryPartitionCount: env.PROCESSOR_CANARY_PARTITION_KEYS_EFFECTIVE.length,
    videoInterpreterProvider: env.VIDEO_INTERPRETER_PROVIDER
  }
});

let outboundWorker: OutboxWorker | undefined;
if (env.ACTION_DISPATCH_ENABLED_EFFECTIVE) {
  const dispatcher = new ActionDispatcher();
  dispatcher.register(new MetaMessagingAdapter(new MetaSender({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    messengerAccessToken: env.META_MESSENGER_ACCESS_TOKEN,
    instagramAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    instagramGraphHost: env.META_INSTAGRAM_GRAPH_HOST,
    requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
  })));
  if (env.TELEGRAM_BOT_TOKEN !== undefined) {
    dispatcher.register(new TelegramMessagingAdapter(new TelegramSender({
      botToken: env.TELEGRAM_BOT_TOKEN,
      requestTimeoutMs: env.TELEGRAM_OUTBOUND_REQUEST_TIMEOUT_MS
    })));
  }
  if (
    env.TIKTOK_BUSINESS_ID !== undefined
    && env.TIKTOK_BUSINESS_ACCESS_TOKEN !== undefined
  ) {
    dispatcher.register(new TikTokBusinessMessagingAdapter(new TikTokBusinessSender({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessToken: env.TIKTOK_BUSINESS_ACCESS_TOKEN,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS
    })));
  }

  outboundWorker = new OutboxWorker({ store: queue, dispatcher, logger });
}

let processorWorker: InboundProcessorWorker | undefined;
if (env.PROCESSOR_ENABLED) {
  if (
    env.WORDPRESS_AI_BRIDGE_URL === undefined ||
    env.ISHI_AI_BRIDGE_TOKEN === undefined
  ) {
    throw new Error("AI bridge configuration is required when inbound processing is enabled");
  }

  const mediaResolvers = new MediaResolverRegistry();
  mediaResolvers.register(new MetaMediaResolver({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    maxBytes: env.MEDIA_MAX_BYTES,
    requestTimeoutMs: env.MEDIA_REQUEST_TIMEOUT_MS
  }));
  if (env.TELEGRAM_BOT_TOKEN !== undefined) {
    mediaResolvers.register(new TelegramMediaResolver({
      botToken: env.TELEGRAM_BOT_TOKEN,
      maxBytes: env.MEDIA_MAX_BYTES,
      requestTimeoutMs: env.MEDIA_REQUEST_TIMEOUT_MS
    }));
  }
  if (
    env.TIKTOK_BUSINESS_ID !== undefined
    && env.TIKTOK_BUSINESS_ACCESS_TOKEN !== undefined
  ) {
    mediaResolvers.register(new TikTokMediaResolver({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessToken: env.TIKTOK_BUSINESS_ACCESS_TOKEN,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      maxBytes: env.MEDIA_MAX_BYTES,
      requestTimeoutMs: env.MEDIA_REQUEST_TIMEOUT_MS
    }));
  }

  const mediaInterpreters = new MediaInterpreterRegistry();
  if (env.VIDEO_INTERPRETER_PROVIDER === "gemini") {
    if (env.GEMINI_API_KEY === undefined) {
      throw new Error("Gemini video interpretation requires GEMINI_API_KEY");
    }
    mediaInterpreters.register(new GeminiVideoInterpreter({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_VIDEO_MODEL,
      requestTimeoutMs: env.VIDEO_INTERPRETER_REQUEST_TIMEOUT_MS,
      totalTimeoutMs: env.VIDEO_INTERPRETER_TOTAL_TIMEOUT_MS,
      pollIntervalMs: env.VIDEO_INTERPRETER_POLL_INTERVAL_MS
    }));
  }

  const brain = new WordPressBrainClient({
    baseUrl: env.WORDPRESS_AI_BRIDGE_URL,
    token: env.ISHI_AI_BRIDGE_TOKEN,
    mediaResolvers,
    mediaInterpreters,
    requestTimeoutMs: env.AI_BRIDGE_TIMEOUT_MS,
    fileTtlSeconds: env.AI_FILE_TTL_SECONDS
  });

  const handlers = new EventHandlerRegistry();
  handlers.register(new MessageReceivedHandler(brain));

  processorWorker = new InboundProcessorWorker({
    queue,
    events: new PostgresInboundEventRepository(db),
    handlers,
    logger,
    ...(env.PROCESSOR_CUTOVER_AT === undefined
      ? {}
      : { processorCutoverAt: new Date(env.PROCESSOR_CUTOVER_AT) }),
    canaryPartitionKeys: env.PROCESSOR_CANARY_PARTITION_KEYS_EFFECTIVE
  });
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown requested");
  if (processorWorker !== undefined) await processorWorker.stop();
  if (outboundWorker !== undefined) await outboundWorker.stop();
  await server.close();
  await db.close();
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

async function main(): Promise<void> {
  try {
    await db.assertReady();
    await server.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT_EFFECTIVE });
    if (processorWorker !== undefined) {
      processorWorker.start();
      logger.info("inbound AI processor enabled");
    } else {
      logger.info("inbound AI processor disabled");
    }
    if (outboundWorker !== undefined) {
      outboundWorker.start();
      logger.info("provider action dispatcher enabled");
    } else {
      logger.info("provider action dispatcher disabled");
    }
  } catch (error) {
    logger.fatal({ err: error }, "HTTP process failed");
    if (processorWorker !== undefined) await processorWorker.stop();
    if (outboundWorker !== undefined) await outboundWorker.stop();
    await db.close();
    process.exitCode = 1;
  }
}

void main();
