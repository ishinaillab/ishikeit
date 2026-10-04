import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";

export type TikTokBusinessConversationType = "SINGLE" | "STRANGER";

export type TikTokBusinessMessagingReadStage =
  | "access_token"
  | "capabilities"
  | "conversation_list"
  | "message_list";

export interface TikTokBusinessConversationSummary {
  conversationId: string;
  updatedAtMs?: number;
}

export interface TikTokBusinessConversationList {
  conversations: readonly TikTokBusinessConversationSummary[];
  hasMore: boolean;
  cursor?: number;
}

export interface TikTokBusinessMessageSummary {
  messageId: string;
  conversationId: string;
  timestampMs?: number;
  messageType: string;
  source?: string;
  fromRole?: string;
  toRole?: string;
  autoMessageType?: string;
  text?: string;
  referencedMessageId?: string;
}

export interface TikTokBusinessMessageList {
  conversationId: string;
  messages: readonly TikTokBusinessMessageSummary[];
}

export interface TikTokBusinessImageCapability {
  conversationId: string;
  conversationType: TikTokBusinessConversationType;
  imageSend: boolean;
}

export interface TikTokBusinessMessagingReadController {
  resolveConversationType(
    conversationId: string
  ): Promise<TikTokBusinessConversationType>;
  checkImageSendCapability(input: {
    conversationId: string;
    conversationType: TikTokBusinessConversationType;
  }): Promise<TikTokBusinessImageCapability>;
  listConversations(input: {
    conversationType: TikTokBusinessConversationType;
    limit: number;
    cursor?: number;
  }): Promise<TikTokBusinessConversationList>;
  listMessages(conversationId: string): Promise<TikTokBusinessMessageList>;
}

interface TikTokBusinessMessagingReadClientOptions {
  businessId: string;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TikTokBusinessMessagingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokBusinessMessagingValidationError";
  }
}

export class TikTokBusinessMessagingNotAuthorizedError extends Error {
  constructor() {
    super("TikTok Business Messaging authorization is unavailable");
    this.name = "TikTokBusinessMessagingNotAuthorizedError";
  }
}

export class TikTokBusinessMessagingReadError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly stage: TikTokBusinessMessagingReadStage;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokBusinessMessagingReadStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokBusinessMessagingReadError";
    this.retryable = options.retryable;
    this.stage = options.stage;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function providerCode(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

function isRetryable(status: number, code: string | undefined): boolean {
  return status === 429
    || status >= 500
    || code === "40100"
    || code === "51065";
}

function validateConversationId(value: string): void {
  if (value.length < 1 || value.length > 2048) {
    throw new TikTokBusinessMessagingValidationError(
      "TikTok conversation ID must contain 1 to 2048 characters"
    );
  }
}

function validateConversationType(
  value: string
): asserts value is TikTokBusinessConversationType {
  if (value !== "SINGLE" && value !== "STRANGER") {
    throw new TikTokBusinessMessagingValidationError(
      "TikTok conversation type must be SINGLE or STRANGER"
    );
  }
}

export class TikTokBusinessMessagingReadClient
implements TikTokBusinessMessagingReadController {
  readonly #businessId: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokBusinessMessagingReadClientOptions) {
    this.#businessId = options.businessId;
    if (
      (options.accessToken === undefined)
      === (options.accessTokenProvider === undefined)
    ) {
      throw new Error(
        "TikTok Business Messaging reader requires exactly one access-token source"
      );
    }
    this.#accessTokenProvider = options.accessTokenProvider
      ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async resolveConversationType(
    conversationId: string
  ): Promise<TikTokBusinessConversationType> {
    validateConversationId(conversationId);

    const states: Array<{
      conversationType: TikTokBusinessConversationType;
      cursor?: number;
      done: boolean;
      seenCursors: Set<number>;
    }> = [
      {
        conversationType: "SINGLE",
        done: false,
        seenCursors: new Set<number>()
      },
      {
        conversationType: "STRANGER",
        done: false,
        seenCursors: new Set<number>()
      }
    ];

    for (let round = 0; round < 100; round++) {
      const active = states.filter((state) => !state.done);
      if (active.length === 0) break;

      const pages = await Promise.all(active.map(async (state) => ({
        state,
        page: await this.listConversations({
          conversationType: state.conversationType,
          limit: 100,
          ...(state.cursor === undefined ? {} : { cursor: state.cursor })
        })
      })));

      const matches = pages
        .filter(({ page }) => page.conversations.some(
          (conversation) => conversation.conversationId === conversationId
        ))
        .map(({ state }) => state.conversationType);

      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) {
        throw new TikTokBusinessMessagingReadError(
          "TikTok returned the conversation in multiple conversation-type lists",
          { retryable: true, stage: "conversation_list" }
        );
      }

      for (const { state, page } of pages) {
        if (!page.hasMore) {
          state.done = true;
          continue;
        }

        if (
          page.cursor === undefined
          || state.seenCursors.has(page.cursor)
        ) {
          throw new TikTokBusinessMessagingReadError(
            "TikTok conversation pagination did not advance",
            { retryable: true, stage: "conversation_list" }
          );
        }

        state.seenCursors.add(page.cursor);
        state.cursor = page.cursor;
      }
    }

    throw new TikTokBusinessMessagingReadError(
      "TikTok conversation type could not be resolved",
      { retryable: true, stage: "conversation_list" }
    );
  }

  async checkImageSendCapability(input: {
    conversationId: string;
    conversationType: TikTokBusinessConversationType;
  }): Promise<TikTokBusinessImageCapability> {
    validateConversationId(input.conversationId);
    validateConversationType(input.conversationType);

    const url = this.#url("business/message/capabilities/get/");
    url.searchParams.set("business_id", this.#businessId);
    url.searchParams.set("capability_types", JSON.stringify(["IMAGE_SEND"]));
    url.searchParams.set("conversation_id", input.conversationId);
    url.searchParams.set("conversation_type", input.conversationType);

    const data = await this.#get(url, "capabilities");
    const infos = Array.isArray(data.capability_infos)
      ? data.capability_infos
      : [];
    const imageSend = infos.some((rawInfo) => {
      const info = record(rawInfo);
      return info?.capability_type === "IMAGE_SEND"
        && info.capability_result === true;
    });

    return {
      conversationId: input.conversationId,
      conversationType: input.conversationType,
      imageSend
    };
  }

  async listConversations(input: {
    conversationType: TikTokBusinessConversationType;
    limit: number;
    cursor?: number;
  }): Promise<TikTokBusinessConversationList> {
    validateConversationType(input.conversationType);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new TikTokBusinessMessagingValidationError(
        "TikTok conversation list limit must be between 1 and 100"
      );
    }
    if (
      input.cursor !== undefined
      && (!Number.isSafeInteger(input.cursor) || input.cursor < 0)
    ) {
      throw new TikTokBusinessMessagingValidationError(
        "TikTok conversation cursor must be a non-negative safe integer"
      );
    }

    const url = this.#url("business/message/conversation/list/");
    url.searchParams.set("business_id", this.#businessId);
    url.searchParams.set("conversation_type", input.conversationType);
    url.searchParams.set("limit", String(input.limit));
    if (input.cursor !== undefined) {
      url.searchParams.set("cursor", String(input.cursor));
    }

    const data = await this.#get(url, "conversation_list");
    const rawConversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];
    const conversations: TikTokBusinessConversationSummary[] = [];
    for (const rawConversation of rawConversations) {
      const conversation = record(rawConversation);
      const conversationId = nonEmptyString(conversation?.conversation_id);
      if (conversationId === undefined) continue;
      const updatedAtMs = safeInteger(conversation?.up_time);
      conversations.push({
        conversationId,
        ...(updatedAtMs === undefined ? {} : { updatedAtMs })
      });
    }

    const cursor = safeInteger(data.cursor);
    return {
      conversations,
      hasMore: data.has_more === true,
      ...(cursor === undefined ? {} : { cursor })
    };
  }

  async listMessages(conversationId: string): Promise<TikTokBusinessMessageList> {
    validateConversationId(conversationId);

    const url = this.#url("business/message/content/list/");
    url.searchParams.set("business_id", this.#businessId);
    url.searchParams.set("conversation_id", conversationId);

    const data = await this.#get(url, "message_list");
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];
    const messages: TikTokBusinessMessageSummary[] = [];

    for (const rawMessage of rawMessages) {
      const message = record(rawMessage);
      const messageId = nonEmptyString(message?.message_id);
      const providerConversationId = nonEmptyString(message?.conversation_id);
      const messageType = nonEmptyString(message?.message_type);
      if (
        messageId === undefined
        || providerConversationId === undefined
        || messageType === undefined
      ) {
        continue;
      }

      const timestampMs = safeInteger(message?.timestamp);
      const source = nonEmptyString(record(message?.message_tag)?.source);
      const fromRole = nonEmptyString(record(message?.from_user)?.role);
      const toRole = nonEmptyString(record(message?.to_user)?.role);
      const autoMessageType = nonEmptyString(message?.auto_message_type);
      const text = nonEmptyString(record(message?.text)?.body);
      const referencedMessageId = nonEmptyString(
        record(message?.referenced_message_info)?.referenced_message_id
      );

      messages.push({
        messageId,
        conversationId: providerConversationId,
        messageType,
        ...(timestampMs === undefined ? {} : { timestampMs }),
        ...(source === undefined ? {} : { source }),
        ...(fromRole === undefined ? {} : { fromRole }),
        ...(toRole === undefined ? {} : { toRole }),
        ...(autoMessageType === undefined ? {} : { autoMessageType }),
        ...(text === undefined ? {} : { text }),
        ...(referencedMessageId === undefined ? {} : { referencedMessageId })
      });
    }

    return { conversationId, messages };
  }

  #url(path: string): URL {
    return new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/${path}`
    );
  }

  async #get(
    url: URL,
    stage: Exclude<TikTokBusinessMessagingReadStage, "access_token">
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.#accessToken();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "Access-Token": accessToken
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new TikTokBusinessMessagingReadError(
        "TikTok Business Messaging read request failed before a response was received",
        { retryable: true, stage, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw) ?? {};
    const code = providerCode(body.code);
    if (!response.ok || (code !== undefined && code !== "0")) {
      throw new TikTokBusinessMessagingReadError(
        "TikTok Business Messaging read request was rejected",
        {
          retryable: isRetryable(response.status, code),
          stage,
          status: response.status,
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    const data = record(body.data);
    if (data === undefined) {
      throw new TikTokBusinessMessagingReadError(
        "TikTok Business Messaging read response did not contain data",
        { retryable: true, stage, status: response.status }
      );
    }
    return data;
  }

  async #accessToken(): Promise<string> {
    try {
      return await this.#accessTokenProvider.getAccessToken();
    } catch (error) {
      if (error instanceof AccessTokenError && !error.retryable) {
        throw new TikTokBusinessMessagingNotAuthorizedError();
      }
      throw new TikTokBusinessMessagingReadError(
        "TikTok Business Messaging access token is unavailable",
        {
          retryable: true,
          stage: "access_token",
          cause: error
        }
      );
    }
  }
}
