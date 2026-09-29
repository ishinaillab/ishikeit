import { loadEnvironment } from "../config/env.js";
import { createLogger } from "../observability/logger.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { PostgresInboundStore } from "../persistence/inbound.js";
import { buildServer } from "../http/server.js";

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

let shuttingDown = false;
async function shutdown(signal:string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({signal},"shutdown requested");
  await server.close();
  await db.close();
}
process.once("SIGINT",()=>{void shutdown("SIGINT");});
process.once("SIGTERM",()=>{void shutdown("SIGTERM");});

async function main(): Promise<void> {
  try {
    await server.listen({host:env.HTTP_HOST,port:env.HTTP_PORT_EFFECTIVE});
  } catch (error) {
    logger.fatal({err:error},"HTTP process failed");
    await db.close();
    process.exitCode = 1;
  }
}

void main();
