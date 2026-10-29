import { MetaSender } from "../channels/meta-send.js";
import { loadEnvironment } from "../config/env.js";
import { ActionDispatcher } from "../dispatch/dispatcher.js";
import { MetaMessagingAdapter } from "../adapters/meta/messaging.js";
import { WhatsAppTemplateAdapter } from "../adapters/meta/whatsapp-template.js";
import { TelegramMessagingAdapter } from "../adapters/telegram/messaging.js";
import { TikTokBusinessMessagingAdapter } from "../adapters/tiktok/messaging.js";
import { TikTokCommentToMessageAdapter } from "../adapters/tiktok/comment-to-message.js";
import { WordPressBrainClient } from "../brain/wordpress.js";
import { buildServer } from "../http/server.js";
import { LATEPOINT_WORDPRESS_PUBLIC_KEY_PEM } from "../appointments/latepoint-public-key.js";
import { MetaMediaResolver } from "../media/meta.js";
import { TelegramMediaResolver } from "../media/telegram.js";
import { TikTokMediaResolver } from "../media/tiktok.js";
import { GeminiVideoInterpreter } from "../media/gemini-video.js";
import { MediaInterpreterRegistry } from "../media/interpreter.js";
import { MediaResolverRegistry } from "../media/resolver.js";
import { createLogger } from "../observability/logger.js";
import { PostgresOperationalMetrics } from "../observability/operational-metrics.js";
import { runtimeBuildIdentity } from "../observability/build-identity.js";
import {
  instagramManagedAccountMatchesInbound,
  messengerManagedPageMatchesInbound,
  messengerRecentSignedPageId
} from "../observability/meta-account-coverage.js";
import {
  MessengerPageSubscriptionClient,
  MessengerPageSubscriptionError
} from "../auth/messenger-page-subscription.js";
import { PostgresInboundEventRepository, PostgresInboundStore } from "../persistence/inbound.js";
import { PostgresMetaHandoffStore } from "../persistence/meta-handoff.js";
import { PostgresWhatsAppConsentStore } from "../persistence/whatsapp-consent.js";
import { PostgresOutboxStore } from "../persistence/outbox.js";
import { PostgresMetaUnknownReconciler } from "../persistence/meta-unknown-reconciliation.js";
import { MetaGraphTokenPreflight } from "../security/meta-graph-preflight.js";
import { PostgresLatePointReminderPlanStore } from "../persistence/latepoint-reminder-plans.js";
import { LatePointReminderClock } from "../workers/latepoint-reminder-clock.js";
import { PostgresDatabase } from "../persistence/postgres.js";
import { MessageReceivedHandler } from "../processing/message-handler.js";
import { MetaRoutingOwnershipHandler } from "../processing/meta-routing-ownership-handler.js";
import { TikTokHighIntentCommentHandler } from "../processing/tiktok-comment-to-message-handler.js";
import { EventHandlerRegistry } from "../processing/registry.js";
import { InboundProcessorWorker } from "../workers/inbound-processor-worker.js";
import { OutboxWorker } from "../workers/outbox-worker.js";
import { TelegramSender } from "../channels/telegram-send.js";
import { TikTokBusinessSender } from "../channels/tiktok-send.js";
import { telegramBotIdFromToken } from "../security/telegram.js";
import { CredentialCipher } from "../auth/credential-cipher.js";
import { PostgresOAuthCredentialStore } from "../auth/oauth-store.js";
import { TikTokOAuthClient, TikTokOAuthService } from "../auth/tiktok-oauth.js";
import {
  TikTokMarketingOAuthClient,
  TikTokMarketingOAuthService
} from "../auth/tiktok-marketing-oauth.js";
import {
  TikTokMarketingAdvertiserClient,
  TikTokMarketingAdvertiserService
} from "../marketing/tiktok-advertiser.js";
import { TikTokAccessTokenManager, tiktokCredentialCanRefresh } from "../auth/tiktok-token-manager.js";
import { TikTokBusinessMessagingReadClient } from "../messaging/tiktok-business-read.js";
import { TikTokMessagingAvailabilityProbe } from "../messaging/tiktok-availability-probe.js";
import {
  TikTokBusinessCommentToMessageClient,
  TikTokBusinessCommentToMessageService
} from "../messaging/tiktok-comment-to-message.js";
import {
  TikTokBusinessWebhookClient,
  TikTokBusinessWebhookService
} from "../messaging/tiktok-webhook-config.js";
import { INSTAGRAM_WEBHOOK_FIELDS, InstagramOAuthClient, InstagramOAuthService, InstagramOAuthFlowError, InstagramOAuthRequestError, instagramOAuthFailureDiagnostic, type InstagramOAuthFlowStage } from "../auth/instagram-oauth.js";
import { InstagramAccessTokenManager, InstagramAccessTokenRouter } from "../auth/instagram-token-manager.js";
import { PostgresInstagramDataLifecycle } from "../privacy/instagram-data-lifecycle.js";

const env = loadEnvironment();
const logger = createLogger(env);

if (env.DATABASE_URL === undefined || env.META_APP_SECRET === undefined || env.META_WEBHOOK_VERIFY_TOKEN === undefined) {
  throw new Error("DATABASE_URL, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN are required to start the HTTP service");
}

const db = new PostgresDatabase(env.DATABASE_URL);
const metaHandoffs = new PostgresMetaHandoffStore(db);
const whatsappConsents = env.META_WHATSAPP_CONSENT_HASH_KEY_B64 === undefined
  ? undefined
  : new PostgresWhatsAppConsentStore(db, env.META_WHATSAPP_CONSENT_HASH_KEY_B64);
const queue = new PostgresOutboxStore(db);
const latePointReminderPlans = new PostgresLatePointReminderPlanStore(db);
const latePointReminderClock = new LatePointReminderClock(latePointReminderPlans, logger);
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
const tiktokBusinessWebhookConfigured = (
  env.TIKTOK_BUSINESS_APP_ID !== undefined
  && env.TIKTOK_BUSINESS_APP_SECRET !== undefined
  && env.TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL !== undefined
);
const tiktokMarketingOAuthConfigured = (
  env.TIKTOK_BUSINESS_APP_ID !== undefined
  && env.TIKTOK_BUSINESS_APP_SECRET !== undefined
  && env.TIKTOK_MARKETING_AUTHORIZATION_URL !== undefined
  && env.TIKTOK_MARKETING_REDIRECT_URI !== undefined
  && env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 !== undefined
);
const instagramOAuthConfigured = (
  env.META_INSTAGRAM_OAUTH_APP_ID !== undefined
  && env.META_INSTAGRAM_OAUTH_APP_SECRET !== undefined
  && env.META_INSTAGRAM_OAUTH_REDIRECT_URI !== undefined
  && env.OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64 !== undefined
);
const oauthStore = !(
  tiktokOAuthConfigured
  || tiktokMarketingOAuthConfigured
  || instagramOAuthConfigured
)
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
const tiktokMarketingOAuthClient = !tiktokMarketingOAuthConfigured
  ? undefined
  : new TikTokMarketingOAuthClient({
      appId: env.TIKTOK_BUSINESS_APP_ID!,
      appSecret: env.TIKTOK_BUSINESS_APP_SECRET!,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_MARKETING_OAUTH_REQUEST_TIMEOUT_MS
    });
const tiktokMarketingOAuthService = (
  oauthStore === undefined
  || tiktokMarketingOAuthClient === undefined
)
  ? undefined
  : new TikTokMarketingOAuthService({
      authorizationUrl: env.TIKTOK_MARKETING_AUTHORIZATION_URL!,
      redirectUri: env.TIKTOK_MARKETING_REDIRECT_URI!,
      store: oauthStore,
      client: tiktokMarketingOAuthClient,
      stateTtlSeconds: env.TIKTOK_MARKETING_OAUTH_STATE_TTL_SECONDS
    });
const tiktokMarketingAdvertiserClient = !tiktokMarketingOAuthConfigured
  ? undefined
  : new TikTokMarketingAdvertiserClient({
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_MARKETING_OAUTH_REQUEST_TIMEOUT_MS
    });
const tiktokMarketingAdvertiserService = (
  oauthStore === undefined
  || tiktokMarketingAdvertiserClient === undefined
)
  ? undefined
  : new TikTokMarketingAdvertiserService({
      store: oauthStore,
      client: tiktokMarketingAdvertiserClient
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
const tiktokBusinessWebhookClient = !tiktokBusinessWebhookConfigured
  ? undefined
  : new TikTokBusinessWebhookClient({
      appId: env.TIKTOK_BUSINESS_APP_ID!,
      appSecret: env.TIKTOK_BUSINESS_APP_SECRET!,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OAUTH_REQUEST_TIMEOUT_MS
    });
const tiktokBusinessWebhookService = tiktokBusinessWebhookClient === undefined
  ? undefined
  : new TikTokBusinessWebhookService({
      expectedCallbackUrl: env.TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL!,
      client: tiktokBusinessWebhookClient
    });

const tiktokBusinessMessagingRead = (
  tiktokAccessTokenManager === undefined
  || env.TIKTOK_BUSINESS_ID === undefined
)
  ? undefined
  : new TikTokBusinessMessagingReadClient({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessTokenProvider: tiktokAccessTokenManager,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS
    });

const tiktokCommentToMessageClient = (
  env.TIKTOK_COMMENT_TO_MESSAGE_ENABLED === undefined
  || tiktokAccessTokenManager === undefined
  || env.TIKTOK_BUSINESS_ID === undefined
)
  ? undefined
  : new TikTokBusinessCommentToMessageClient({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessTokenProvider: tiktokAccessTokenManager,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS
    });
const tiktokCommentToMessageService = (
  tiktokCommentToMessageClient === undefined
  || env.TIKTOK_COMMENT_TO_MESSAGE_ENABLED === undefined
)
  ? undefined
  : new TikTokBusinessCommentToMessageService({
      expectedEnabled: env.TIKTOK_COMMENT_TO_MESSAGE_ENABLED,
      client: tiktokCommentToMessageClient
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
    let stage: InstagramOAuthFlowStage = "credential_lookup";
    try {
      // Never use a stale snapshot when the account has been revoked or its
      // credential disappeared between listing and token resolution.
      const accessToken = instagramAccessTokenManager === undefined
        ? credential.accessToken
        : await instagramAccessTokenManager.getAccessToken(credential.accountId);
      if (accessToken === undefined) {
        throw new InstagramOAuthRequestError(
          "Instagram credential is no longer available",
          { retryable: false, reason: "credential_not_authorized" }
        );
      }
      stage = "account_resolution";
      const professionalAccountId = await instagramOAuthClient
        .resolveProfessionalAccountId(accessToken);
      stage = "credential_persistence";
      await oauthStore.putAccountAlias(
        "instagram",
        professionalAccountId,
        credential.accountId,
        "instagram_professional_account"
      );
      stage = "webhook_subscription";
      await instagramOAuthClient.ensureWebhookSubscription(
        accessToken,
        INSTAGRAM_WEBHOOK_FIELDS
      );
      logger.info("Instagram OAuth account routing and webhook subscription reconciled");
    } catch (error) {
      // Hostinger exposes log messages but not structured details. Emit only
      // allowlisted machine diagnostics, never token-bearing URLs, API error
      // bodies or account identifiers.
      const diagnostic = instagramOAuthFailureDiagnostic(
        new InstagramOAuthFlowError(stage, error)
      );
      logger.warn("Instagram OAuth account routing or webhook subscription reconciliation failed: " + diagnostic);
    }
  }
}

async function reconcileInstagramManagedAccount(): Promise<void> {
  // A managed token may belong to the business's Professional account even
  // when OAuth credentials exist for a different (tester) account. Never
  // trust its configured presence without resolving its exact owner first.
  if (
    instagramAccessTokenRouter === undefined
    || instagramOAuthClient === undefined
    || env.META_INSTAGRAM_ACCESS_TOKEN === undefined
  ) {
    return;
  }

  let stage: InstagramOAuthFlowStage = "account_resolution";
  try {
    const professionalAccountId = await instagramAccessTokenRouter.managedAccountId();
    if (professionalAccountId === undefined) return;
    stage = "webhook_subscription";
    await instagramOAuthClient.ensureWebhookSubscription(
      env.META_INSTAGRAM_ACCESS_TOKEN,
      INSTAGRAM_WEBHOOK_FIELDS
    );
    let inboundMatch = "unavailable";
    try {
      inboundMatch = String(await instagramManagedAccountMatchesInbound(
        db, professionalAccountId
      ));
    } catch {
      logger.warn("Instagram managed-account webhook subscription succeeded but inbound match check was unavailable");
    }
    logger.info(
      "Instagram verified managed-account token and webhook subscription reconciled; "
      + "historical_signed_inbound_account_match=" + inboundMatch
    );
  } catch (error) {
    const diagnostic = instagramOAuthFailureDiagnostic(
      new InstagramOAuthFlowError(stage, error)
    );
    logger.warn("Instagram managed-account routing or webhook subscription failed: " + diagnostic);
  }
}

async function reconcileMessengerManagedPage(): Promise<void> {
  if (env.META_MESSENGER_ACCESS_TOKEN === undefined) return;
  try {
    const client = new MessengerPageSubscriptionClient({
      appId: env.META_APP_ID,
      graphApiVersion: env.META_GRAPH_API_VERSION,
      ...(env.META_GRAPH_PROOF_ENABLED ? { graphProofAppSecret: env.META_APP_SECRET } : {}),
      requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
    });
    const recentPageId = await messengerRecentSignedPageId(db);
    if (recentPageId === undefined) {
      logger.warn("Messenger Page webhook field reconciliation skipped: no unique recent signed Page identity");
      return;
    }
    const result = await client.reconcile(
      env.META_MESSENGER_ACCESS_TOKEN,
      recentPageId,
      (pageId) => messengerManagedPageMatchesInbound(db, pageId)
    );
    logger.info(
      "Messenger verified Page webhook subscription reconciled; changed=" + String(result.changed)
    );
  } catch (error) {
    const diagnostic = error instanceof MessengerPageSubscriptionError
      ? error.stage
        + (error.status === undefined ? "" : " http_status=" + error.status)
        + (error.graphCode === undefined ? "" : " provider_code=graph:" + error.graphCode)
        + (error.graphSubcode === undefined ? "" : " subcode=" + error.graphSubcode)
      : "unexpected_failure";
    logger.warn("Messenger Page webhook field reconciliation failed: " + diagnostic);
  }
}

const server = buildServer({
  logger,
  buildIdentity: runtimeBuildIdentity(),
  ready: async () =>
    await db.ready()
    && (oauthStore === undefined || await oauthStore.ready())
    && (instagramDataLifecycle === undefined || await instagramDataLifecycle.ready())
    && await tiktokAuthorizationReady(),
  inbound: new PostgresInboundStore(db, whatsappConsents, latePointReminderPlans),
  metaHandoffs,
  appSecret: env.META_APP_SECRET,
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  // Production verifier is pinned to the public-only WordPress signing key.
  // No Hostinger env replacement or HMAC downgrade is necessary.
  latePointWebhook: { publicKeyPem: LATEPOINT_WORDPRESS_PUBLIC_KEY_PEM },
  ...(telegram === undefined ? {} : { telegram }),
  ...(tiktok === undefined ? {} : { tiktok }),
  ...(tiktokBusinessWebhookService === undefined
    ? {}
    : {
        tiktokBusinessMessagingWebhook: {
          service: tiktokBusinessWebhookService
        }
      }),
  ...(tiktokBusinessMessagingRead === undefined
    ? {}
    : {
        tiktokBusinessMessagingRead: {
          service: tiktokBusinessMessagingRead
        }
      }),
  ...(oauthStore === undefined || !tiktokOAuthConfigured
    ? {}
    : { tiktokMessagingAvailabilityProbe: new TikTokMessagingAvailabilityProbe({
        store: oauthStore,
        refreshStore: oauthStore,
        oauthClient: tiktokOAuthClient!,
        apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
        requestTimeoutMs: env.TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS
      }) }),
  ...(tiktokCommentToMessageService === undefined
    ? {}
    : {
        tiktokCommentToMessage: {
          service: tiktokCommentToMessageService
        }
      }),
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
  ...(tiktokMarketingOAuthService === undefined
    ? {}
    : {
        tiktokMarketingOAuth: {
          service: tiktokMarketingOAuthService
        }
      }),
  ...(tiktokMarketingAdvertiserService === undefined
    ? {}
    : {
        tiktokMarketingAdvertisers: {
          service: tiktokMarketingAdvertiserService
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
        metaUnknown: new PostgresMetaUnknownReconciler(db),
        metaGraphPreflight: new MetaGraphTokenPreflight({
          appId: env.META_APP_ID,
          appSecret: env.META_APP_SECRET,
          graphVersion: env.META_GRAPH_API_VERSION,
          messengerToken: env.META_MESSENGER_ACCESS_TOKEN,
          whatsappToken: env.META_WHATSAPP_ACCESS_TOKEN
        }),
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
  const metaSender = new MetaSender({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    ...(env.META_GRAPH_PROOF_ENABLED ? { graphProofAppSecret: env.META_APP_SECRET } : {}),
    messengerAccessToken: env.META_MESSENGER_ACCESS_TOKEN,
    instagramAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN,
    ...(instagramAccessTokenProvider === undefined ? {} : { instagramAccessTokenProvider }),
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    instagramGraphHost: env.META_INSTAGRAM_GRAPH_HOST,
    requestTimeoutMs: env.META_OUTBOUND_REQUEST_TIMEOUT_MS
  });
  dispatcher.register(new MetaMessagingAdapter(metaSender, metaHandoffs));
  if (env.META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED
    && env.META_WHATSAPP_ACCESS_TOKEN !== undefined
    && env.META_WHATSAPP_TEMPLATE_PHONE_NUMBER_ID !== undefined
    && whatsappConsents !== undefined) {
    dispatcher.register(new WhatsAppTemplateAdapter(metaSender, {
      phoneNumberId: env.META_WHATSAPP_TEMPLATE_PHONE_NUMBER_ID,
      approvedTemplateKeys: env.META_WHATSAPP_APPROVED_TEMPLATE_KEYS_EFFECTIVE
    }, whatsappConsents));
  }
  if (env.TELEGRAM_BOT_TOKEN !== undefined) {
    dispatcher.register(new TelegramMessagingAdapter(new TelegramSender({
      botToken: env.TELEGRAM_BOT_TOKEN,
      requestTimeoutMs: env.TELEGRAM_OUTBOUND_REQUEST_TIMEOUT_MS
    })));
  }
  if (
    env.TIKTOK_BUSINESS_ID !== undefined
    && tiktokAccessTokenManager !== undefined
    && tiktokBusinessMessagingRead !== undefined
  ) {
    const tiktokBusinessSender = new TikTokBusinessSender({
      businessId: env.TIKTOK_BUSINESS_ID,
      accessTokenProvider: tiktokAccessTokenManager,
      imageCapabilityResolver: tiktokBusinessMessagingRead,
      apiVersion: env.TIKTOK_BUSINESS_API_VERSION,
      requestTimeoutMs: env.TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS
    });
    dispatcher.register(new TikTokBusinessMessagingAdapter(tiktokBusinessSender));
    if (env.TIKTOK_COMMENT_TO_MESSAGE_ENABLED === true) {
      dispatcher.register(new TikTokCommentToMessageAdapter(tiktokBusinessSender));
    }
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
    ...(env.META_GRAPH_PROOF_ENABLED ? { graphProofAppSecret: env.META_APP_SECRET } : {}),
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
  if (env.META_APP_ID !== undefined) {
    handlers.register(new MetaRoutingOwnershipHandler(metaHandoffs, env.META_APP_ID));
  }
  handlers.register(new MessageReceivedHandler(brain, metaHandoffs, whatsappConsents));
  if (env.TIKTOK_COMMENT_TO_MESSAGE_ENABLED === true) {
    handlers.register(new TikTokHighIntentCommentHandler(brain));
  }

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
  await latePointReminderClock.stop();
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
    await reconcileMessengerManagedPage();
    if (!await tiktokAuthorizationReady()) {
      throw new Error("TikTok Business Account activation requires a usable durable OAuth credential");
    }
    await server.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT_EFFECTIVE });
    // This clock suppresses deadlines only; no outbound template sender is involved.
    latePointReminderClock.start();
    logger.info("non-sending LatePoint deadline reconciliation enabled");
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
    await latePointReminderClock.stop();
  if (processorWorker !== undefined) await processorWorker.stop();
    if (outboundWorker !== undefined) await outboundWorker.stop();
    await db.close();
    process.exitCode = 1;
  }
}

void main();
