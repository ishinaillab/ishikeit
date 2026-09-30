import type { ContentPart } from "../domain/content.js";
import type { MetaOutboundPayload, MetaSendResult } from "../domain/outbound.js";
import { DispatchFailure } from "../dispatch/failure.js";

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

export class MetaSendFailure extends DispatchFailure {
  readonly graphCode?: number;
  readonly graphSubcode?: number;

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
    super(message, {
      retryable: options.retryable,
      ...(options.ambiguous === undefined ? {} : { ambiguous: options.ambiguous }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.graphCode === undefined
        ? {}
        : { providerCode: `graph:${options.graphCode}${options.graphSubcode === undefined ? "" : ":" + options.graphSubcode}` }),
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    });
    this.name = "MetaSendFailure";
    if (options.graphCode !== undefined) this.graphCode = options.graphCode;
    if (options.graphSubcode !== undefined) this.graphSubcode = options.graphSubcode;
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
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

function validatePart(payload: MetaOutboundPayload): void {
  const part = payload.message;
  if (part.kind === "structured") {
    throw new MetaSendFailure("Structured content is not supported by the Meta messaging adapter", { retryable: false });
  }
  if (part.kind !== "text") return;

  const bytes = Buffer.byteLength(part.text, "utf8");
  if (payload.channel === "instagram" && bytes > 1000) {
    throw new MetaSendFailure("Instagram text messages must be 1000 UTF-8 bytes or less", { retryable: false });
  }
  if (payload.channel === "messenger" && part.text.length >= 2000) {
    throw new MetaSendFailure("Messenger text messages must be less than 2000 characters", { retryable: false });
  }
  if (payload.channel === "whatsapp" && part.text.length > 4096) {
    throw new MetaSendFailure("WhatsApp text messages must be 4096 characters or less", { retryable: false });
  }
}

function metaAttachmentType(part: Exclude<ContentPart, { kind: "text" | "structured" }>): string {
  return part.kind === "document" ? "file" : part.kind;
}

function sourcePayload(part: Exclude<ContentPart, { kind: "text" | "structured" }>): Record<string, unknown> {
  if (part.source.kind === "url") return { url: part.source.value };
  if (part.source.kind === "provider") return { attachment_id: part.source.value };
  throw new MetaSendFailure("Unsupported Meta media reference kind: " + part.source.kind, { retryable: false });
}

function whatsappMedia(
  part: Exclude<ContentPart, { kind: "text" | "structured" }>
): { type: string; value: Record<string, unknown> } {
  const type = part.kind === "document" ? "document" : part.kind;
  const value: Record<string, unknown> = part.source.kind === "url"
    ? { link: part.source.value }
    : part.source.kind === "provider"
      ? { id: part.source.value }
      : {};
  if (Object.keys(value).length === 0) {
    throw new MetaSendFailure("Unsupported WhatsApp media reference kind: " + part.source.kind, { retryable: false });
  }
  if (part.caption !== undefined && (type === "image" || type === "video" || type === "document")) {
    value.caption = part.caption;
  }
  if (part.filename !== undefined && type === "document") value.filename = part.filename;
  return { type, value };
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
    validatePart(payload);

    const token = payload.channel === "messenger"
      ? this.#messengerAccessToken
      : payload.channel === "instagram"
        ? this.#instagramAccessToken
        : this.#whatsappAccessToken;
    const host = payload.channel === "instagram" ? this.#instagramGraphHost : "graph.facebook.com";
    const url = `https://${host}/${this.#graphApiVersion}/${encodeURIComponent(payload.accountId)}/messages`;

    let body: Record<string, unknown>;
    if (payload.channel === "whatsapp") {
      const base: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: payload.recipientId
      };
      if (payload.replyTo !== undefined) base.context = { message_id: payload.replyTo };
      if (payload.message.kind === "text") {
        body = { ...base, type: "text", text: { preview_url: false, body: payload.message.text } };
      } else if (payload.message.kind !== "structured") {
        const media = whatsappMedia(payload.message);
        body = { ...base, type: media.type, [media.type]: media.value };
      } else {
        throw new MetaSendFailure("Unsupported WhatsApp content", { retryable: false });
      }
    } else {
      const message = payload.message.kind === "text"
        ? { text: payload.message.text }
        : payload.message.kind !== "structured"
          ? {
              attachment: {
                type: metaAttachmentType(payload.message),
                payload: sourcePayload(payload.message)
              }
            }
          : undefined;
      if (message === undefined) throw new MetaSendFailure("Unsupported Meta content", { retryable: false });

      body = {
        recipient: { id: payload.recipientId },
        ...(payload.channel === "messenger" ? { messaging_type: "RESPONSE" } : {}),
        message,
        ...(payload.replyTo === undefined ? {} : { reply_to: { mid: payload.replyTo } })
      };
    }

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
