import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";

export type TikTokCommentToMessageStage =
  | "access_token"
  | "status_get"
  | "status_update";

export interface TikTokCommentToMessageState {
  businessId: string;
  enabled: boolean;
}

export interface TikTokCommentToMessageStatus extends TikTokCommentToMessageState {
  expectedEnabled: boolean;
  matchesExpected: boolean;
}

export interface TikTokCommentToMessageReconcileResult
extends TikTokCommentToMessageStatus {
  changed: boolean;
}

export interface TikTokBusinessCommentToMessageClientLike {
  getStatus(): Promise<TikTokCommentToMessageState>;
  setEnabled(enabled: boolean): Promise<TikTokCommentToMessageState>;
}

export interface TikTokBusinessCommentToMessageController {
  status(): Promise<TikTokCommentToMessageStatus>;
  reconcile(): Promise<TikTokCommentToMessageReconcileResult>;
}

interface TikTokBusinessCommentToMessageClientOptions {
  businessId: string;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TikTokCommentToMessageNotAuthorizedError extends Error {
  constructor() {
    super("TikTok Comment-to-Message authorization is unavailable");
    this.name = "TikTokCommentToMessageNotAuthorizedError";
  }
}

export class TikTokCommentToMessageRequestError extends Error {
  readonly retryable: boolean;
  readonly stage: TikTokCommentToMessageStage;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokCommentToMessageStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokCommentToMessageRequestError";
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

function providerCode(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

function retryableProviderFailure(status: number, code: string | undefined): boolean {
  return status === 429
    || status >= 500
    || code === "40100"
    || code === "51065";
}

export class TikTokBusinessCommentToMessageClient
implements TikTokBusinessCommentToMessageClientLike {
  readonly #businessId: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokBusinessCommentToMessageClientOptions) {
    this.#businessId = options.businessId;
    if (
      (options.accessToken === undefined)
      === (options.accessTokenProvider === undefined)
    ) {
      throw new Error(
        "TikTok Comment-to-Message client requires exactly one access-token source"
      );
    }
    this.#accessTokenProvider = options.accessTokenProvider
      ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getStatus(): Promise<TikTokCommentToMessageState> {
    const url = this.#url("business/message/direct_reply/get/");
    url.searchParams.set("business_id", this.#businessId);
    url.searchParams.set("direct_reply_type", "COMMENT_TO_MESSAGE");

    const data = await this.#request(url, {
      method: "GET",
      headers: { accept: "application/json" }
    }, "status_get");

    const returnedBusinessId = typeof data.business_id === "string"
      ? data.business_id
      : this.#businessId;
    if (returnedBusinessId !== this.#businessId) {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message status returned a different Business Account",
        { retryable: false, stage: "status_get" }
      );
    }

    if (
      data.direct_reply_type !== undefined
      && data.direct_reply_type !== "COMMENT_TO_MESSAGE"
    ) {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message status returned an unexpected direct-reply type",
        { retryable: false, stage: "status_get" }
      );
    }

    if (data.operation_status !== "ENABLE" && data.operation_status !== "DISABLE") {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message status did not contain a valid operation status",
        { retryable: true, stage: "status_get" }
      );
    }

    return {
      businessId: this.#businessId,
      enabled: data.operation_status === "ENABLE"
    };
  }

  async setEnabled(enabled: boolean): Promise<TikTokCommentToMessageState> {
    const url = this.#url("business/message/direct_reply/update/");
    await this.#request(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        business_id: this.#businessId,
        direct_reply_type: "COMMENT_TO_MESSAGE",
        operation_status: enabled ? "ENABLE" : "DISABLE"
      })
    }, "status_update");

    return this.getStatus();
  }

  #url(path: string): URL {
    return new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/${path}`
    );
  }

  async #request(
    url: URL,
    init: RequestInit,
    stage: Exclude<TikTokCommentToMessageStage, "access_token">
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.#accessToken();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          "Access-Token": accessToken
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message request failed before a response was received",
        { retryable: true, stage, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw) ?? {};
    const code = providerCode(body.code);
    if (!response.ok || (code !== undefined && code !== "0")) {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message request was rejected",
        {
          retryable: retryableProviderFailure(response.status, code),
          stage,
          status: response.status,
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    return record(body.data) ?? {};
  }

  async #accessToken(): Promise<string> {
    try {
      return await this.#accessTokenProvider.getAccessToken();
    } catch (error) {
      if (error instanceof AccessTokenError && !error.retryable) {
        throw new TikTokCommentToMessageNotAuthorizedError();
      }
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message access token is unavailable",
        {
          retryable: true,
          stage: "access_token",
          cause: error
        }
      );
    }
  }
}

export class TikTokBusinessCommentToMessageService
implements TikTokBusinessCommentToMessageController {
  readonly #expectedEnabled: boolean;
  readonly #client: TikTokBusinessCommentToMessageClientLike;

  constructor(options: {
    expectedEnabled: boolean;
    client: TikTokBusinessCommentToMessageClientLike;
  }) {
    this.#expectedEnabled = options.expectedEnabled;
    this.#client = options.client;
  }

  async status(): Promise<TikTokCommentToMessageStatus> {
    return this.#toStatus(await this.#client.getStatus());
  }

  async reconcile(): Promise<TikTokCommentToMessageReconcileResult> {
    const before = await this.status();
    if (before.matchesExpected) {
      return { ...before, changed: false };
    }

    const after = this.#toStatus(
      await this.#client.setEnabled(this.#expectedEnabled)
    );
    if (!after.matchesExpected) {
      throw new TikTokCommentToMessageRequestError(
        "TikTok Comment-to-Message provider state did not converge after update",
        { retryable: true, stage: "status_update" }
      );
    }
    return { ...after, changed: true };
  }

  #toStatus(state: TikTokCommentToMessageState): TikTokCommentToMessageStatus {
    return {
      ...state,
      expectedEnabled: this.#expectedEnabled,
      matchesExpected: state.enabled === this.#expectedEnabled
    };
  }
}
