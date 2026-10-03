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
import { CredentialCipher } from "../auth/credential-cipher.js";
import { PostgresOAuthCredentialStore } from "../auth/oauth-store.js";
import { TikTokOAuthClient, TikTokOAuthService } from "../auth/tiktok-oauth.js";
import { TikTokAccessTokenManager, tiktokCredentialCanRefresh } from "../auth/tiktok-token-manager.js";
import { INSTAGRAM_WEBHOOK_FIELDS, InstagramOAuthClient, InstagramOAuthService } from "../auth/instagram-oauth.js";
import { InstagramAccessTokenManager, InstagramAccessTokenRouter } from "../auth/instagram-token-manager.js";
import { PostgresInstagramDataLifecycle } from "../privacy/instagram-data-lifecycle.js";

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
const tiktokOAuthConfigured = (
  env.TIKTOK_BUSINESS_APP_ID !== undefined
  && env.TIKTOK_BUSINESS_APP_SECRET !== undefined
  && env.TIKTOK_BUSINESS_AUTHORIZATION_URL !== undefined
  && env.TIKTOK_BUSINESS_REDIRECT_URI !== undefined
  && env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 !== undefined
);
const instagramOAuthConfigured = (
  env.META_INSTAGRAM_OAUTH_APP_ID !== undefined
  && env.META_INSTAGRAM_OAUTH_APP_SECRET !== undefined
  && env.META_INSTAGRAM_OAUTH_REDIRECT_URI !== undefined
  && env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 !== undefined
);
const oauthStore = !(tiktokOAuthConfigured || instagramOAuthConfigured)
  ? undefined
  : new PostgresOAuthCredentialStore(
      db,
      CredentialCipher.fromBase64(env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64!)
    );
const tiktokOAuthClient = !tiktokOAuthConfigured
  ? undefined
  : new TikTokOAuthClient({
      appId: env.TIKTOK_BUSINESS_APP_ID!,
      appSecret: env.TIKTOK_BUSINESS_APP_SECRET!,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OAUTH_REQUEST_TIMEOUT_MS
    });
const tiktokOAuthService = (
  oauthStore === undefined
  || tiktokOAuthClient === undefined
)
  ? undefined
  : new TikTokOAuthService({
      authorizationUrl: env.TIKTOK_BUSINESS_AUTHORIZATION_URL!,
      redirectUri: env.TIKTOK_BUSINESS_REDIRECT_URI!,
      store: oauthStore,
      client: tiktokOAuthClient,
      stateTtlSeconds: env.TIKTOK_OAUTH_STATE_TTL_SECONDS
    });
const instagramOAuthClient = !instagramOAuthConfigured
  ? undefined
  : new InstagramOAuthClient({
      appId: env.META_INSTAGRAM_OAUTH_APP_ID!,
      appSecret: env.META_INSTAGRAM_OAUTH_APP_SECRET!,
      graphApiVersion: env.META_GRAPH_API_VERSION,
      requestTimeoutMs: env.META_INSTAGRAM_OAUTH_REQUEST_TIMEOUT_MS
    });
const instagramOAuthService = (
  oauthStore === undefined
  || instagramOAuthClient === undefined
)
  ? undefined
  : new InstagramOAuthService({
      appId: env.META_INSTAGRAM_OAUTH_APP_ID!,
      redirectUri: env.META_INSTAGRAM_OAUTH_REDIRECT_URI!,
      store: oauthStore,
      client: instagramOAuthClient,
      stateTtlSeconds: env.META_INSTAGRAM_OAUTH_STATE_TTL_SECONDS
    });
const instagramDataLifecycle = (
  oauthStore === undefined
  || instagramOAuthService === undefined
)
  ? undefined
  : new PostgresInstagramDataLifecycle(db, oauthStore);
const instagramAccessTokenManager = (
  oauthStore === undefined
  || instagramOAuthClient === undefined
)
  ? undefined
  : new InstagramAccessTokenManager({
      store: oauthStore,
      client: instagramOAuthClient,
      refreshSkewSeconds: env.META_INSTAGRAM_TOKEN_REFRESH_SKEW_SECONDS
    });

const instagramAccessTokenRouter = instagramOAuthClient === undefined
  ? undefined
  : new InstagramAccessTokenRouter({
      oauthProvider: instagramAccessTokenManager,
      managedAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN,
      client: instagramOAuthClient
    });
const instagramAccessTokenProvider = instagramAccessTokenRouter
  ?? instagramAccessTokenManager;

const tiktokAccessTokenManager = (
  oauthStore === undefined
  || tiktokOAuthClient === undefined
  || env.TIKTOK_BUSINESS_ID === undefined
)
  ? undefined
  : new TikTokAccessTokenManager({
      businessId: env.TIKTOK_BUSINESS_ID,
      store: oauthStore,
      client: tiktokOAuthClient,
      refreshSkewSeconds: env.TIKTOK_TOKEN_REFRESH_SKEW_SECONDS
    });
const tiktok = (
  env.TIKTOK_BUSINESS_APP_ID === undefined
  || env.TIKTOK_BUSINESS_APP_SECRET === undefined
  || env.TIKTOK_BUSINESS_ID === undefined
)
  ? undefined
  : {
      appId: env.TIKTOK_BUSINESS_APP_ID,
      clientSecret: env.TIKTOK_BUSINESS_APP_SECRET,
      businessId: env.TIKTOK_BUSINESS_ID,
      maxSignatureAgeSeconds: env.TIKTOK_WEBHOOK_MAX_AGE_SECONDS
    };

async function tiktokAuthorizationReady(): Promise<boolean> {
  if (env.TIKTOK_BUSINESS_ID === undefined) return true;
  if (oauthStore === undefined) return false;

  try {
    const credential = await oauthStore.get("tiktok", env.TIKTOK_BUSINESS_ID);
    return tiktokCredentialCanRefresh(credential);
  } catch {
    return false;
  }
}

async function reconcileInstagramOAuthAccounts(): Promise<void> {
  if (oauthStore === undefined || instagramOAuthClient === undefined) return;
  const credentials = await oauthStore.list("instagram");

  for (const credential of credentials) {
    try {
      const accessToken = instagramAccessTokenManager === undefined
        ? credential.accessToken
        : await instagramAccessTokenManager.getAccessToken(credential.accountId)
          ?? credential.accessToken;
      const professionalAccountId = await instagramOAuthClient
        .resolveProfessionalAccountId(accessToken);
      await oauthStore.putAccountAlias(
        "instagram",
        professionalAccountId,
        credential.accountId,
        "instagram_professional_account"
      );
      await instagramOAuthClient.ensureWebhookSubscription(
        accessToken,
        INSTAGRAM_WEBHOOK_FIELDS
      );
      logger.info(
        { professionalAccountId },
        "Instagram OAuth account routing and webhook subscription reconciled"
      );
    } catch (error) {
      logger.warn(
        { err: error, credentialAccountId: credential.accountId },
        "Instagram OAuth account routing or webhook subscription reconciliation failed"
      );
    }
  }
}

async function reconcileInstagramManagedAccount(): Promise<void> {
  if (
    instagramAccessTokenRouter === undefined
    || instagramOAuthClient === undefined
    || env.META_INSTAGRAM_ACCESS_TOKEN === undefined
  ) {
    return;
  }

  try {
    const professionalAccountId = await instagramAccessTokenRouter.managedAccountId();
    if (professionalAccountId === undefined) return;
    await instagramOAuthClient.ensureWebhookSubscription(
      env.META_INSTAGRAM_ACCESS_TOKEN,
      INSTAGRAM_WEBHOOK_FIELDS
    );
    logger.info(
      { professionalAccountId },
      "Instagram managed-account token and webhook subscription reconciled"
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "Instagram managed-account token or webhook subscription reconciliation failed"
    );
  }
}

const server = buildServer({
  logger,
  ready: async () =>
    await db.ready()
    && (oauthStore === undefined || await oauthStore.ready())
    && (instagramDataLifecycle === undefined || await instagramDataLifecycle.ready())
    && await tiktokAuthorizationReady(),
  inbound: new PostgresInboundStore(db),
  appSecret: env.META_APP_SECRET,
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  ...(telegram === undefined ? {} : { telegram }),
  ...(tiktok === undefined ? {} : { tiktok }),
  ...(tiktokOAuthService === undefined
    ? {}
    : {
        tiktokOAuth: {
          service: tiktokOAuthService,
          ...(env.TIKTOK_BUSINESS_ID === undefined
            ? {}
            : { configuredBusinessId: env.TIKTOK_BUSINESS_ID })
        }
      }),
  ...(instagramOAuthService === undefined
    ? {}
    : {
        instagramOAuth: {
          service: instagramOAuthService,
          ...(instagramDataLifecycle === undefined
            ? {}
            : {
                compliance: {
                  appSecret: env.META_INSTAGRAM_OAUTH_APP_SECRET!,
                  dataLifecycle: instagramDataLifecycle,
                  statusBaseUrl: new URL(env.META_INSTAGRAM_OAUTH_REDIRECT_URI!).origin
                }
              })
        }
      }),
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
    ...(instagramAccessTokenProvider === undefined ? {} : { instagramAccessTokenProvider }),
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
    && tiktokAccessTokenManager !== undefined
  ) {
    dispatcher.register(new TikTokBusinessMessagingAdapter(new TikTokBusinessSender({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessTokenProvider: tiktokAccessTokenManager,
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
    && tiktokAccessTokenManager !== undefined
  ) {
    mediaResolvers.register(new TikTokMediaResolver({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessTokenProvider: tiktokAccessTokenManager,
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
    if (oauthStore !== undefined && !await oauthStore.ready()) {
      throw new Error("OAuth credential schema is not ready for configured OAuth providers");
    }
    if (instagramDataLifecycle !== undefined && !await instagramDataLifecycle.ready()) {
      throw new Error("Instagram data lifecycle schema is not ready");
    }
    await reconcileInstagramOAuthAccounts();
    await reconcileInstagramManagedAccount();
    if (!await tiktokAuthorizationReady()) {
      throw new Error("TikTok Business Account activation requires a usable durable OAuth credential");
    }
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
