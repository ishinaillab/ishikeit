import { DispatchFailure } from "../dispatch/failure.js";
import type { ContentPart } from "../domain/content.js";
import { telegramBotIdFromToken } from "../security/telegram.js";
import { TelegramBusinessVerifier } from "../auth/telegram-business.js";
import { customerReplyWindowEligibility } from "../policy/provider-contract.js";

interface TelegramSenderOptions {
  botToken: string;
  businessUsername?: string;
  businessOwnerId?: string;
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

/** Bound potentially untrusted Telegram API responses, even without Content-Length. */
async function readTelegramResponse(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new DispatchFailure("Telegram API response unavailable", { retryable: true, ambiguous: true });
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value === undefined) continue;
      total += part.value.byteLength;
      if (total > 65_536) {
        await reader.cancel().catch(() => undefined);
        throw new DispatchFailure("Telegram API response oversized", { retryable: true, ambiguous: true });
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof DispatchFailure) throw error;
    throw new DispatchFailure("Telegram API response interrupted", { retryable: true, ambiguous: true });
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
    return asRecord(value) ?? {};
  } catch {
    throw new DispatchFailure("Telegram API response invalid", { retryable: true, ambiguous: true });
  }
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
  readonly #business: TelegramBusinessVerifier | undefined;

  constructor(options: TelegramSenderOptions) {
    this.#botToken = options.botToken;
    this.botId = telegramBotIdFromToken(options.botToken);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#business = options.businessUsername === undefined ? undefined
      : new TelegramBusinessVerifier({
          botToken: options.botToken,
          expectedUsername: options.businessUsername,
          ...(options.businessOwnerId === undefined ? {} : { expectedOwnerId: options.businessOwnerId }),
          timeoutMs: this.#requestTimeoutMs,
          fetchImpl: this.#fetch
        });
  }

  async verifyBusiness(connectionId: string): Promise<{ connectionId: string; ownerId: string }> {
    if (this.#business === undefined) {
      throw new DispatchFailure("Telegram Business account not configured", { retryable: false });
    }
    return this.#business.verify(connectionId);
  }

  async send(
    chatId: string,
    part: ContentPart,
    businessConnectionId?: string,
    customerMessageAt?: string
  ): Promise<TelegramSendResult> {
    if (businessConnectionId !== undefined) {
      const business = await this.verifyBusiness(businessConnectionId);
      if (chatId === business.ownerId || !/^-?[0-9]+$/u.test(chatId)
        || customerMessageAt === undefined) {
        throw new DispatchFailure("Telegram Business reply is not customer-initiated", { retryable: false });
      }
      const eligibility = customerReplyWindowEligibility("telegram", "business", "message.send", customerMessageAt);
      if (eligibility !== "eligible") {
        throw new DispatchFailure("Telegram Business customer reply not permitted: " + eligibility, { retryable: false });
      }
    }
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

    if (businessConnectionId !== undefined) payload.business_connection_id = businessConnectionId;
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
          redirect: "error",
          cache: "no-store",
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

    const body = await readTelegramResponse(response);
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
