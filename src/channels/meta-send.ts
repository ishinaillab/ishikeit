import type { MetaOutboundPayload, MetaSendResult } from "../domain/outbound.js";

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
    fbtrace_id?: string;
  };
}

export interface MetaMessageSender {
  send(payload: MetaOutboundPayload): Promise<MetaSendResult>;
}

export interface MetaSenderOptions {
  graphApiVersion: string;
  messengerAccessToken: string;
  instagramAccessToken: string;
  whatsappAccessToken: string;
  instagramGraphHost: "graph.instagram.com" | "graph.facebook.com";
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class MetaSendFailure extends Error {
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly status?: number;
  readonly graphCode?: number;
  readonly graphSubcode?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      ambiguous?: boolean;
      status?: number;
      graphCode?: number;
      graphSubcode?: number;
      retryAfterMs?: number;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MetaSendFailure";
    this.retryable = options.retryable;
    this.ambiguous = options.ambiguous ?? false;
    if (options.status !== undefined) this.status = options.status;
    if (options.graphCode !== undefined) this.graphCode = options.graphCode;
    if (options.graphSubcode !== undefined) this.graphSubcode = options.graphSubcode;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json() as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function whatsappMessageId(result: Record<string, unknown>): string | undefined {
  const messages: unknown = result.messages;
  if (!Array.isArray(messages)) return undefined;
  const first: unknown = messages[0];
  if (typeof first !== "object" || first === null) return undefined;
  const id = (first as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function validateText(payload: MetaOutboundPayload): void {
  const bytes = Buffer.byteLength(payload.message.text, "utf8");
  if (payload.channel === "instagram" && bytes > 1000) {
    throw new MetaSendFailure("Instagram text messages must be 1000 UTF-8 bytes or less", { retryable: false });
  }
  if (payload.channel === "messenger" && payload.message.text.length >= 2000) {
    throw new MetaSendFailure("Messenger text messages must be less than 2000 characters", { retryable: false });
  }
  if (payload.channel === "whatsapp" && payload.message.text.length > 4096) {
    throw new MetaSendFailure("WhatsApp text messages must be 4096 characters or less", { retryable: false });
  }
}

export class MetaSender implements MetaMessageSender {
  readonly #graphApiVersion: string;
  readonly #messengerAccessToken: string;
  readonly #instagramAccessToken: string;
  readonly #whatsappAccessToken: string;
  readonly #instagramGraphHost: "graph.instagram.com" | "graph.facebook.com";
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: MetaSenderOptions) {
    this.#graphApiVersion = options.graphApiVersion;
    this.#messengerAccessToken = options.messengerAccessToken;
    this.#instagramAccessToken = options.instagramAccessToken;
    this.#whatsappAccessToken = options.whatsappAccessToken;
    this.#instagramGraphHost = options.instagramGraphHost;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async send(payload: MetaOutboundPayload): Promise<MetaSendResult> {
    validateText(payload);

    const token = payload.channel === "messenger"
      ? this.#messengerAccessToken
      : payload.channel === "instagram"
        ? this.#instagramAccessToken
        : this.#whatsappAccessToken;
    const host = payload.channel === "instagram"
      ? this.#instagramGraphHost
      : "graph.facebook.com";
    const url = `https://${host}/${this.#graphApiVersion}/${encodeURIComponent(payload.accountId)}/messages`;

    const body = payload.channel === "messenger"
      ? {
          recipient: { id: payload.recipientId },
          messaging_type: "RESPONSE",
          message: { text: payload.message.text }
        }
      : payload.channel === "instagram"
        ? {
            recipient: { id: payload.recipientId },
            message: { text: payload.message.text }
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: payload.recipientId,
            type: "text",
            text: {
              preview_url: false,
              body: payload.message.text
            }
          };

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new MetaSendFailure("Meta request failed before a response was received", {
        retryable: true,
        ambiguous: true,
        cause: error
      });
    }

    const result = await readJson(response);
    if (!response.ok) {
      const graphError = typeof result.error === "object" && result.error !== null
        ? result.error as GraphErrorBody["error"]
        : undefined;
      const isTransient = graphError?.is_transient === true || response.status === 429 || response.status >= 500;
      const retryAfter = retryAfterMs(response.headers.get("retry-after"));
      throw new MetaSendFailure(graphError?.message ?? `Meta request failed with HTTP ${response.status}`, {
        retryable: isTransient,
        ambiguous: false,
        status: response.status,
        ...(graphError?.code === undefined ? {} : { graphCode: graphError.code }),
        ...(graphError?.error_subcode === undefined ? {} : { graphSubcode: graphError.error_subcode }),
        ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter })
      });
    }

    const providerMessageId = typeof result.message_id === "string"
      ? result.message_id
      : typeof result.id === "string"
        ? result.id
        : whatsappMessageId(result);

    return providerMessageId === undefined ? {} : { providerMessageId };
  }
}
