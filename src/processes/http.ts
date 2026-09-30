import { MetaSender } from "../channels/meta-send.js";
import { loadEnvironment } from "../config/env.js";
import { buildServer } from "../http/server.js";
import { createLogger } from "../observability/logger.js";
import { PostgresInboundStore } from "../persistence/inbound.js";
import { PostgresOutboxStore } from "../persistence/outbox.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { OutboxWorker } from "../workers/outbox-worker.js";

const env = loadEnvironment();
const logger = createLogger(env);

if (env.DATABASE_URL === undefined || env.META_APP_SECRET === undefined || env.META_WEBHOOK_VERIFY_TOKEN === undefined) {
  throw new Error("DATABASE_URL, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN are required to start the HTTP service");
}

const db = new PostgresDatabase(env.DATABASE_URL);
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

  outboundWorker = new OutboxWorker({
    store: new PostgresOutboxStore(db),
    sender: new MetaSender({
      graphApiVersion: env.META_GRAPH_API_VERSION,
      messengerAccessToken: env.META_MESSENGER_ACCESS_TOKEN,
      instagramAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN,
      whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
      instagramGraphHost: env.META_INSTAGRAM_GRAPH_HOST,
      requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
    }),
    logger
  });
}

let shuttingDown = false;
async function shutdown(signal:string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({signal},"shutdown requested");
  if (outboundWorker !== undefined) await outboundWorker.stop();
  await server.close();
  await db.close();
}
process.once("SIGINT",()=>{void shutdown("SIGINT");});
process.once("SIGTERM",()=>{void shutdown("SIGTERM");});

async function main(): Promise<void> {
  try {
    await server.listen({host:env.HTTP_HOST,port:env.HTTP_PORT_EFFECTIVE});
    if (outboundWorker !== undefined) {
      outboundWorker.start();
      logger.info("Meta outbound worker enabled");
    } else {
      logger.info("Meta outbound worker disabled");
    }
  } catch (error) {
    logger.fatal({err:error},"HTTP process failed");
    if (outboundWorker !== undefined) await outboundWorker.stop();
    await db.close();
    process.exitCode = 1;
  }
}

void main();
