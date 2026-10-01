import { DispatchFailure } from "../dispatch/failure.js";
import type { ContentPart } from "../domain/content.js";
import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";

interface TikTokBusinessSenderOptions {
  businessId: string;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TikTokSendResult {
  providerMessageId?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function providerCode(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

export class TikTokBusinessSender {
  readonly businessId: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokBusinessSenderOptions) {
    this.businessId = options.businessId;
    if ((options.accessToken === undefined) === (options.accessTokenProvider === undefined)) {
      throw new Error("TikTok sender requires exactly one access-token source");
    }
    this.#accessTokenProvider = options.accessTokenProvider
      ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async send(
    conversationId: string,
    part: ContentPart,
    replyTo?: string
  ): Promise<TikTokSendResult> {
    if (part.kind !== "text") {
      throw new DispatchFailure(
        "TikTok generic messaging currently supports text replies only",
        { retryable: false }
      );
    }
    if (part.text.length > 6000) {
      throw new DispatchFailure("TikTok text exceeds the Business Messaging limit", {
        retryable: false
      });
    }

    const payload: Record<string, unknown> = {
      business_id: this.businessId,
      recipient_type: "CONVERSATION",
      recipient: conversationId,
      message_type: "TEXT",
      text: { body: part.text }
    };
    if (replyTo !== undefined) {
      payload.referenced_message_info = { referenced_message_id: replyTo };
    }

    return this.#request(payload);
  }

  async #request(payload: Record<string, unknown>): Promise<TikTokSendResult> {
    let accessToken: string;
    try {
      accessToken = await this.#accessTokenProvider.getAccessToken();
    } catch (error) {
      throw new DispatchFailure("TikTok OAuth access token is unavailable", {
        retryable: error instanceof AccessTokenError ? error.retryable : true,
        ambiguous: false,
        cause: error
      });
    }

    let response: Response;
    try {
      response = await this.#fetch(
        `https://business-api.tiktok.com/open_api/${this.#apiVersion}/business/message/send/`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "Access-Token": accessToken
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        }
      );
    } catch (error) {
      throw new DispatchFailure(
        "TikTok request failed before a response was received",
        { retryable: true, ambiguous: true, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw);
    const code = body?.code;
    const codeString = providerCode(code);
    const success = response.ok && (code === 0 || code === "0");
    if (success) {
      const data = record(body?.data);
      const message = record(data?.message);
      const messageId = message?.message_id;
      return typeof messageId === "string" || typeof messageId === "number"
        ? { providerMessageId: String(messageId) }
        : {};
    }

    const effectiveStatus = response.status >= 400 ? response.status : undefined;
    const retryable = response.status === 429
      || response.status >= 500
      || codeString === "40100"
      || codeString === "51065";

    throw new DispatchFailure("TikTok Business Messaging API rejected the outbound message", {
      retryable,
      ambiguous: false,
      ...(effectiveStatus === undefined ? {} : { status: effectiveStatus }),
      ...(codeString === undefined ? {} : { providerCode: codeString })
    });
  }
}
