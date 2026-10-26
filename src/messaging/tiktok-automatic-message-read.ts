import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";

/**
 * Account-level TikTok Business Messaging automatic-message reads.
 * This intentionally does not register an HTTP route, mutate TikTok state,
 * or use Ads Manager's different creative/auto_message APIs.
 */
export type TikTokAutoMessageType =
  | "WELCOME_MESSAGE"
  | "SUGGESTED_QUESTION"
  | "CHAT_PROMPT"
  | "FOLLOW_WELCOME";

export interface TikTokAutoMessageSummary {
  id: string;
  type: TikTokAutoMessageType;
  auditStatus?: "REVIEWING" | "APPROVED" | "REJECTED";
}

export interface TikTokAutoMessageSnapshot {
  businessId: string;
  type: TikTokAutoMessageType;
  enabled: boolean;
  messages: readonly TikTokAutoMessageSummary[];
}

/** Select only after checking the account-level provider API contract. */
export type TikTokAutoMessageReadTransport = "GET_QUERY" | "POST_JSON";

export type TikTokAutoMessageStage = "access_token" | "get";

export class TikTokAutoMessageReadError extends Error {
  readonly retryable: boolean;
  readonly stage: TikTokAutoMessageStage;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokAutoMessageStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokAutoMessageReadError";
    this.retryable = options.retryable;
    this.stage = options.stage;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

interface TikTokAutoMessageReaderOptions {
  businessId: string;
  /** Required; there is deliberately no guessed default. */
  transport: TikTokAutoMessageReadTransport;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const allowedTypes: readonly TikTokAutoMessageType[] = [
  "WELCOME_MESSAGE", "SUGGESTED_QUESTION", "CHAT_PROMPT", "FOLLOW_WELCOME"
];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function codeString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

export class TikTokAutoMessageReader {
  readonly #businessId: string;
  readonly #transport: TikTokAutoMessageReadTransport;
  readonly #token: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokAutoMessageReaderOptions) {
    if (
      options.businessId.length === 0 || options.businessId.length > 256
    ) throw new Error("TikTok automatic messages require a valid business ID");
    if ((options.accessToken === undefined) === (options.accessTokenProvider === undefined)) {
      throw new Error("TikTok automatic messages require exactly one token source");
    }
    if (options.transport !== "GET_QUERY" && options.transport !== "POST_JSON") {
      throw new Error("TikTok automatic-message retrieval transport must be explicitly verified");
    }
    this.#businessId = options.businessId;
    this.#transport = options.transport;
    this.#token = options.accessTokenProvider ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async get(type: TikTokAutoMessageType): Promise<TikTokAutoMessageSnapshot> {
    if (!allowedTypes.includes(type)) {
      throw new Error("Unsupported TikTok automatic-message type");
    }
    let token: string;
    try {
      token = await this.#token.getAccessToken();
      if (token.trim().length === 0) throw new Error("empty token");
    } catch (error) {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message authorization unavailable",
        {
          retryable: error instanceof AccessTokenError ? error.retryable : false,
          stage: "access_token",
          cause: error
        }
      );
    }

    const url = new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/business/message/auto_message/get/`
    );
    if (this.#transport === "GET_QUERY") {
      url.searchParams.set("business_id", this.#businessId);
      url.searchParams.set("auto_message_type", type);
    }

    // This is the provider's read endpoint in both cases; POST_JSON is
    // supported as an explicit retrieval transport, never an update action.
    const request: RequestInit = this.#transport === "GET_QUERY"
      ? { method: "GET", headers: { "Access-Token": token, accept: "application/json" } }
      : {
          method: "POST",
          headers: {
            "Access-Token": token,
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({ business_id: this.#businessId, auto_message_type: type })
        };

    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...request,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message read failed before response",
        { retryable: true, stage: "get", cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => undefined);
    const envelope = record(raw);
    const providerCode = codeString(envelope?.code);
    if (!response.ok || providerCode !== "0") {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message read failed",
        {
          retryable: response.status === 429 || response.status >= 500
            || providerCode === "40100" || providerCode === "51065",
          stage: "get",
          status: response.status,
          ...(providerCode === undefined ? {} : { providerCode })
        }
      );
    }

    const data = record(envelope?.data);
    if (data === undefined) {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message read returned invalid data",
        { retryable: true, stage: "get" }
      );
    }
    if (data.business_id !== undefined && data.business_id !== this.#businessId) {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message response account mismatch",
        { retryable: false, stage: "get" }
      );
    }
    if (data.operation_status !== "ENABLE" && data.operation_status !== "DISABLE") {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message response missing valid operation status",
        { retryable: true, stage: "get" }
      );
    }
    if (!Array.isArray(data.auto_messages)) {
      throw new TikTokAutoMessageReadError(
        "TikTok automatic-message response missing list",
        { retryable: true, stage: "get" }
      );
    }

    const messages: TikTokAutoMessageSummary[] = [];
    for (const item of data.auto_messages as unknown[]) {
      const details = record(item);
      const id = details?.auto_message_id;
      const observedType = details?.auto_message_type;
      const audit = details?.audit_status;
      if (
        typeof id !== "string" || id.length === 0
        || observedType !== type
      ) {
        throw new TikTokAutoMessageReadError(
          "TikTok automatic-message response contains unexpected identity",
          { retryable: true, stage: "get" }
        );
      }
      if (audit !== undefined && audit !== "REVIEWING"
        && audit !== "APPROVED" && audit !== "REJECTED") {
        throw new TikTokAutoMessageReadError(
          "TikTok automatic-message response contains unknown review status",
          { retryable: true, stage: "get" }
        );
      }
      messages.push({
        id,
        type,
        ...(audit === undefined ? {} : { auditStatus: audit })
      });
    }

    return {
      businessId: this.#businessId,
      type,
      enabled: data.operation_status === "ENABLE",
      messages
    };
  }
  /**
   * Read all four account-level Business Messaging automatic-message types
   * as one all-or-nothing snapshot. Requests are sequential to limit bursts.
   * No configured message text or provider-native data is returned.
   */
  async getAll(): Promise<Readonly<Record<TikTokAutoMessageType, TikTokAutoMessageSnapshot>>> {
    const welcome = await this.get("WELCOME_MESSAGE");
    const suggested = await this.get("SUGGESTED_QUESTION");
    const chat = await this.get("CHAT_PROMPT");
    const follow = await this.get("FOLLOW_WELCOME");
    return {
      WELCOME_MESSAGE: welcome,
      SUGGESTED_QUESTION: suggested,
      CHAT_PROMPT: chat,
      FOLLOW_WELCOME: follow
    };
  }
}
