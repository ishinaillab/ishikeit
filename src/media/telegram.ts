import type { MediaContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";
import { ProcessingFailure } from "../processing/failure.js";
import type { MediaResolver, ResolvedMedia } from "./resolver.js";

interface TelegramMediaResolverOptions {
  botToken: string;
  maxBytes: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const TELEGRAM_CLOUD_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function safeFilename(value: string | undefined, filePath: string): string {
  const source = value ?? filePath.split("/").pop() ?? "attachment.bin";
  const cleaned = source.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 180);
  return cleaned.length === 0 ? "attachment.bin" : cleaned;
}

export class TelegramMediaResolver implements MediaResolver {
  readonly provider = "telegram";
  readonly #botToken: string;
  readonly #maxBytes: number;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TelegramMediaResolverOptions) {
    this.#botToken = options.botToken;
    this.#maxBytes = Math.min(options.maxBytes, TELEGRAM_CLOUD_DOWNLOAD_LIMIT);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async resolve(event: CanonicalEvent, part: MediaContentPart): Promise<ResolvedMedia> {
    if (event.provider !== "telegram" || event.channel !== "bot") {
      throw new ProcessingFailure("Telegram media resolver received a non-Telegram event", { retryable: false });
    }
    if (part.source.kind !== "provider") {
      throw new ProcessingFailure("Telegram inbound media requires a provider file_id", { retryable: false });
    }
    if (part.sizeBytes !== undefined && part.sizeBytes > this.#maxBytes) {
      throw new ProcessingFailure("Inbound Telegram media exceeds the supported download limit", { retryable: false });
    }

    const metadata = await this.#api("getFile", { file_id: part.source.value });
    const result = record(metadata.result);
    const filePath = typeof result?.file_path === "string" ? result.file_path : undefined;
    if (filePath === undefined || filePath.length === 0) {
      throw new ProcessingFailure("Telegram getFile response did not contain file_path", { retryable: true });
    }

    const metadataSize = typeof result?.file_size === "number" && Number.isFinite(result.file_size)
      ? result.file_size
      : undefined;
    if (metadataSize !== undefined && metadataSize > this.#maxBytes) {
      throw new ProcessingFailure("Inbound Telegram media exceeds the supported download limit", { retryable: false });
    }

    const segments = filePath.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      throw new ProcessingFailure("Telegram returned an unsafe file_path", { retryable: false });
    }
    const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
    const url = "https://api.telegram.org/file/bot" + this.#botToken + "/" + encodedPath;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new ProcessingFailure("Telegram media download failed before a response was received", {
        retryable: true,
        cause: error
      });
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ProcessingFailure("Telegram media download returned an unexpected redirect", { retryable: false });
    }
    if (!response.ok) {
      throw new ProcessingFailure("Telegram media download failed with HTTP " + response.status, {
        retryable: response.status === 429 || response.status >= 500
      });
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
      throw new ProcessingFailure("Inbound Telegram media exceeds the supported download limit", { retryable: false });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.#maxBytes) {
      throw new ProcessingFailure("Inbound Telegram media exceeds the supported download limit", { retryable: false });
    }

    return {
      bytes,
      filename: safeFilename(part.filename, filePath),
      mimeType: part.mimeType
        ?? response.headers.get("content-type")?.split(";")[0]?.trim()
        ?? "application/octet-stream"
    };
  }

  async #api(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
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
      throw new ProcessingFailure("Telegram Bot API request failed before a response was received", {
        retryable: true,
        cause: error
      });
    }

    const data: unknown = await response.json().catch(() => ({}));
    const body = record(data);
    if (response.ok && body?.ok === true) return body ?? {};

    const providerCode = typeof body?.error_code === "number" ? body.error_code : response.status;
    throw new ProcessingFailure("Telegram Bot API media request failed", {
      retryable: providerCode === 429 || providerCode >= 500
    });
  }
}
