import { MetaSender } from "../channels/meta-send.js";
import { loadEnvironment } from "../config/env.js";
import { ActionDispatcher } from "../dispatch/dispatcher.js";
import { MetaMessagingAdapter } from "../adapters/meta/messaging.js";
import { WordPressBrainClient } from "../brain/wordpress.js";
import { buildServer } from "../http/server.js";
import { MetaMediaResolver } from "../media/meta.js";
import { MediaResolverRegistry } from "../media/resolver.js";
import { createLogger } from "../observability/logger.js";
import { PostgresInboundEventRepository, PostgresInboundStore } from "../persistence/inbound.js";
import { PostgresOutboxStore } from "../persistence/outbox.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { MessageReceivedHandler } from "../processing/message-handler.js";
import { EventHandlerRegistry } from "../processing/registry.js";
import { InboundProcessorWorker } from "../workers/inbound-processor-worker.js";
import { OutboxWorker } from "../workers/outbox-worker.js";

const env = loadEnvironment();
const logger = createLogger(env);

if (env.DATABASE_URL === undefined || env.META_APP_SECRET === undefined || env.META_WEBHOOK_VERIFY_TOKEN === undefined) {
  throw new Error("DATABASE_URL, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN are required to start the HTTP service");
}

const db = new PostgresDatabase(env.DATABASE_URL);
const queue = new PostgresOutboxStore(db);
const server = buildServer({
  logger,
  ready: () => db.ready(),
  inbound: new PostgresInboundStore(db),
  appSecret: env.META_APP_SECRET,
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN
});

let outboundWorker: OutboxWorker | undefined;
if (env.META_OUTBOUND_ENABLED) {
  if (
    env.META_MESSENGER_ACCESS_TOKEN === undefined ||
    env.META_INSTAGRAM_ACCESS_TOKEN === undefined ||
    env.META_WHATSAPP_ACCESS_TOKEN === undefined
  ) {
    throw new Error("Meta outbound access tokens are required when outbound delivery is enabled");
  }

  const dispatcher = new ActionDispatcher();
  dispatcher.register(new MetaMessagingAdapter(new MetaSender({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    messengerAccessToken: env.META_MESSENGER_ACCESS_TOKEN,
    instagramAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    instagramGraphHost: env.META_INSTAGRAM_GRAPH_HOST,
    requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
  })));

  outboundWorker = new OutboxWorker({ store: queue, dispatcher, logger });
}

let processorWorker: InboundProcessorWorker | undefined;
if (env.PROCESSOR_ENABLED) {
  if (
    env.WORDPRESS_AI_BRIDGE_URL === undefined ||
    env.ISHI_AI_BRIDGE_TOKEN === undefined ||
    env.META_WHATSAPP_ACCESS_TOKEN === undefined
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

  const brain = new WordPressBrainClient({
    baseUrl: env.WORDPRESS_AI_BRIDGE_URL,
    token: env.ISHI_AI_BRIDGE_TOKEN,
    mediaResolvers,
    requestTimeoutMs: env.AI_BRIDGE_TIMEOUT_MS,
    fileTtlSeconds: env.AI_FILE_TTL_SECONDS
  });

  const handlers = new EventHandlerRegistry();
  handlers.register(new MessageReceivedHandler(brain));

  processorWorker = new InboundProcessorWorker({
    queue,
    events: new PostgresInboundEventRepository(db),
    handlers,
    logger
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
