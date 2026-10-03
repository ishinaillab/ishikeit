export type TikTokBusinessWebhookStage =
  | "webhook_get"
  | "webhook_update";

export interface TikTokBusinessWebhookState {
  configured: boolean;
  callbackUrl?: string;
}

export interface TikTokBusinessWebhookClientLike {
  getDirectMessageWebhook(): Promise<TikTokBusinessWebhookState>;
  setDirectMessageWebhook(callbackUrl: string): Promise<TikTokBusinessWebhookState>;
}

interface TikTokBusinessWebhookClientOptions {
  appId: string;
  appSecret: string;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TikTokBusinessWebhookRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly stage: TikTokBusinessWebhookStage;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokBusinessWebhookStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokBusinessWebhookRequestError";
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

export class TikTokBusinessWebhookClient
implements TikTokBusinessWebhookClientLike {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokBusinessWebhookClientOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getDirectMessageWebhook(): Promise<TikTokBusinessWebhookState> {
    const url = this.#url("business/webhook/list/");
    url.searchParams.set("app_id", this.#appId);
    url.searchParams.set("secret", this.#appSecret);
    url.searchParams.set("event_type", "DIRECT_MESSAGE");

    const data = await this.#request(url, { method: "GET" }, "webhook_get");
    const callbackUrl = nonEmptyString(data.callback_url);
    return callbackUrl === undefined
      ? { configured: false }
      : { configured: true, callbackUrl };
  }

  async setDirectMessageWebhook(
    callbackUrl: string
  ): Promise<TikTokBusinessWebhookState> {
    const url = this.#url("business/webhook/update/");
    const data = await this.#request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          app_id: this.#appId,
          secret: this.#appSecret,
          event_type: "DIRECT_MESSAGE",
          callback_url: callbackUrl
        })
      },
      "webhook_update"
    );

    const providerCallbackUrl = nonEmptyString(data.callback_url);
    return providerCallbackUrl === undefined
      ? { configured: true, callbackUrl }
      : { configured: true, callbackUrl: providerCallbackUrl };
  }

  #url(path: string): URL {
    return new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/${path}`
    );
  }

  async #request(
    url: URL,
    init: RequestInit,
    stage: TikTokBusinessWebhookStage
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new TikTokBusinessWebhookRequestError(
        "TikTok Business Messaging webhook request failed before a response was received",
        { retryable: true, stage, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw) ?? {};
    const code = providerCode(body.code);
    if (!response.ok || (code !== undefined && code !== "0")) {
      throw new TikTokBusinessWebhookRequestError(
        "TikTok Business Messaging webhook request was rejected",
        {
          retryable: isRetryable(response.status, code),
          stage,
          status: response.status,
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    return record(body.data) ?? {};
  }
}

export interface TikTokBusinessWebhookStatus extends TikTokBusinessWebhookState {
  matchesExpected: boolean;
  expectedCallbackUrl: string;
}

export interface TikTokBusinessWebhookReconcileResult
extends TikTokBusinessWebhookStatus {
  changed: boolean;
}

export interface TikTokBusinessWebhookController {
  status(): Promise<TikTokBusinessWebhookStatus>;
  reconcile(): Promise<TikTokBusinessWebhookReconcileResult>;
}

export class TikTokBusinessWebhookService
implements TikTokBusinessWebhookController {
  readonly #expectedCallbackUrl: string;
  readonly #client: TikTokBusinessWebhookClientLike;

  constructor(options: {
    expectedCallbackUrl: string;
    client: TikTokBusinessWebhookClientLike;
  }) {
    this.#expectedCallbackUrl = options.expectedCallbackUrl;
    this.#client = options.client;
  }

  async status(): Promise<TikTokBusinessWebhookStatus> {
    return this.#toStatus(await this.#client.getDirectMessageWebhook());
  }

  async reconcile(): Promise<TikTokBusinessWebhookReconcileResult> {
    const before = await this.status();
    if (before.matchesExpected) {
      return { changed: false, ...before };
    }

    await this.#client.setDirectMessageWebhook(this.#expectedCallbackUrl);
    const after = await this.status();
    return { changed: true, ...after };
  }

  #toStatus(state: TikTokBusinessWebhookState): TikTokBusinessWebhookStatus {
    return {
      ...state,
      matchesExpected:
        state.configured
        && state.callbackUrl === this.#expectedCallbackUrl,
      expectedCallbackUrl: this.#expectedCallbackUrl
    };
  }
}
