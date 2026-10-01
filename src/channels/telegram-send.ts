import { DispatchFailure } from "../dispatch/failure.js";
import type { ContentPart } from "../domain/content.js";
import { telegramBotIdFromToken } from "../security/telegram.js";

interface TelegramSenderOptions {
  botToken: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TelegramSendResult {
  providerMessageId?: string;
}

function retryAfterMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function mediaUrl(part: Extract<ContentPart, { source: unknown }>): string {
  if (part.source.kind !== "url") {
    throw new DispatchFailure("Telegram outbound media requires an HTTPS URL", { retryable: false });
  }
  let url: URL;
  try {
    url = new URL(part.source.value);
  } catch {
    throw new DispatchFailure("Telegram outbound media URL is invalid", { retryable: false });
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new DispatchFailure("Telegram outbound media requires an HTTPS URL", { retryable: false });
  }
  return url.toString();
}

export class TelegramSender {
  readonly botId: string;
  readonly #botToken: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TelegramSenderOptions) {
    this.#botToken = options.botToken;
    this.botId = telegramBotIdFromToken(options.botToken);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async send(chatId: string, part: ContentPart): Promise<TelegramSendResult> {
    let method: string;
    let payload: Record<string, unknown>;

    if (part.kind === "text") {
      if (part.text.length > 4096) {
        throw new DispatchFailure("Telegram text exceeds the Bot API limit", { retryable: false });
      }
      method = "sendMessage";
      payload = { chat_id: chatId, text: part.text };
    } else if (part.kind === "image") {
      method = "sendPhoto";
      payload = { chat_id: chatId, photo: mediaUrl(part), ...this.#caption(part.caption) };
    } else if (part.kind === "video") {
      method = "sendVideo";
      payload = { chat_id: chatId, video: mediaUrl(part), ...this.#caption(part.caption) };
    } else if (part.kind === "audio") {
      method = "sendAudio";
      payload = { chat_id: chatId, audio: mediaUrl(part), ...this.#caption(part.caption) };
    } else if (part.kind === "document") {
      method = "sendDocument";
      payload = { chat_id: chatId, document: mediaUrl(part), ...this.#caption(part.caption) };
    } else {
      throw new DispatchFailure("Telegram structured outbound content is not supported", { retryable: false });
    }

    return this.#request(method, payload);
  }

  #caption(caption: string | undefined): Record<string, string> {
    if (caption === undefined || caption.length === 0) return {};
    if (caption.length > 1024) {
      throw new DispatchFailure("Telegram media caption exceeds the Bot API limit", { retryable: false });
    }
    return { caption };
  }

  async #request(method: string, payload: Record<string, unknown>): Promise<TelegramSendResult> {
    let response: Response;
    try {
      response = await this.#fetch(
        "https://api.telegram.org/bot" + this.#botToken + "/" + method,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        }
      );
    } catch (error) {
      throw new DispatchFailure("Telegram request failed before a response was received", {
        retryable: true,
        ambiguous: true,
        cause: error
      });
    }

    const data: unknown = await response.json().catch(() => ({}));
    const body = asRecord(data);
    const result = asRecord(body?.result);
    if (response.ok && body?.ok === true && result !== undefined) {
      const messageId = result.message_id;
      return typeof messageId === "number" || typeof messageId === "string"
        ? { providerMessageId: String(messageId) }
        : {};
    }

    const providerCode = typeof body?.error_code === "number"
      ? String(body.error_code)
      : undefined;
    const parameters = asRecord(body?.parameters);
    const retryAfter = retryAfterMs(parameters?.retry_after);
    const effectiveStatus = response.status >= 400
      ? response.status
      : typeof body?.error_code === "number" ? body.error_code : response.status;
    const retryable = effectiveStatus === 429 || effectiveStatus >= 500;

    throw new DispatchFailure("Telegram Bot API rejected the outbound message", {
      retryable,
      ambiguous: false,
      status: effectiveStatus,
      ...(providerCode === undefined ? {} : { providerCode }),
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter })
    });
  }
}
