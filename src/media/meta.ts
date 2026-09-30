import type { MediaContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";
import type { MediaResolver, ResolvedMedia } from "./resolver.js";
import { ProcessingFailure } from "../processing/failure.js";

interface MetaMediaResolverOptions {
  graphApiVersion: string;
  whatsappAccessToken?: string;
  maxBytes: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isAllowedMetaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "graph.facebook.com"
    || host === "graph.instagram.com"
    || host.endsWith(".facebook.com")
    || host.endsWith(".fbcdn.net")
    || host.endsWith(".fbsbx.com")
    || host.endsWith(".instagram.com")
    || host.endsWith(".cdninstagram.com");
}

function safeFilename(value: string | undefined, url: URL): string {
  if (value !== undefined) {
    const cleaned = value.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 180);
    if (cleaned.length > 0) return cleaned;
  }
  const basename = decodeURIComponent(url.pathname.split("/").pop() ?? "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .slice(0, 180);
  return basename.length > 0 ? basename : "attachment.bin";
}

export class MetaMediaResolver implements MediaResolver {
  readonly provider = "meta";
  readonly #graphApiVersion: string;
  readonly #whatsappAccessToken: string | undefined;
  readonly #maxBytes: number;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: MetaMediaResolverOptions) {
    this.#graphApiVersion = options.graphApiVersion;
    this.#whatsappAccessToken = options.whatsappAccessToken;
    this.#maxBytes = options.maxBytes;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async resolve(event: CanonicalEvent, part: MediaContentPart): Promise<ResolvedMedia> {
    if (part.source.kind === "url") {
      return this.#download(new URL(part.source.value), part, undefined);
    }

    if (part.source.kind !== "provider") {
      throw new ProcessingFailure("Unsupported Meta media reference kind: " + part.source.kind, { retryable: false });
    }

    if (event.channel !== "whatsapp") {
      throw new ProcessingFailure(
        "Provider media IDs for this Meta channel require a channel-specific resolver update",
        { retryable: false }
      );
    }

    if (this.#whatsappAccessToken === undefined) {
      throw new ProcessingFailure(
        "WhatsApp media resolution requires a configured WhatsApp access token",
        { retryable: false }
      );
    }

    const metadataUrl = new URL(
      `https://graph.facebook.com/${this.#graphApiVersion}/${encodeURIComponent(part.source.value)}`
    );
    metadataUrl.searchParams.set("phone_number_id", event.accountId);
    const metadata = await this.#json(metadataUrl, this.#whatsappAccessToken);
    const rawUrl = metadata.url;
    if (typeof rawUrl !== "string") {
      throw new ProcessingFailure("WhatsApp media metadata did not contain a download URL", { retryable: true });
    }

    const fileSize = typeof metadata.file_size === "string" || typeof metadata.file_size === "number"
      ? Number(metadata.file_size)
      : undefined;
    if (fileSize !== undefined && Number.isFinite(fileSize) && fileSize > this.#maxBytes) {
      throw new ProcessingFailure("Inbound media exceeds the configured byte limit", { retryable: false });
    }

    const enrichedPart: MediaContentPart = {
      ...part,
      ...(typeof metadata.mime_type === "string" ? { mimeType: metadata.mime_type } : {}),
      ...(fileSize === undefined || !Number.isFinite(fileSize) ? {} : { sizeBytes: fileSize })
    };
    return this.#download(new URL(rawUrl), enrichedPart, this.#whatsappAccessToken);
  }

  async #json(url: URL, token: string): Promise<Record<string, unknown>> {
    const response = await this.#request(url, token);
    if (!response.ok) {
      throw new ProcessingFailure("Meta media metadata request failed with HTTP " + response.status, {
        retryable: response.status === 429 || response.status >= 500
      });
    }
    try {
      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null) throw new Error("invalid JSON object");
      return data as Record<string, unknown>;
    } catch (error) {
      throw new ProcessingFailure("Meta media metadata response was invalid", { retryable: true, cause: error });
    }
  }

  async #download(
    initialUrl: URL,
    part: MediaContentPart,
    token: string | undefined
  ): Promise<ResolvedMedia> {
    let url = initialUrl;
    for (let redirect = 0; redirect <= 4; redirect++) {
      const response = await this.#request(url, token);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirect === 4) {
          throw new ProcessingFailure("Meta media redirect could not be followed safely", { retryable: false });
        }
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        throw new ProcessingFailure("Meta media download failed with HTTP " + response.status, {
          retryable: response.status === 429 || response.status >= 500
        });
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
        throw new ProcessingFailure("Inbound media exceeds the configured byte limit", { retryable: false });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.#maxBytes) {
        throw new ProcessingFailure("Inbound media exceeds the configured byte limit", { retryable: false });
      }

      const mimeType = part.mimeType
        ?? response.headers.get("content-type")?.split(";")[0]?.trim()
        ?? "application/octet-stream";
      return {
        bytes,
        filename: safeFilename(part.filename, url),
        mimeType
      };
    }

    throw new ProcessingFailure("Meta media download exceeded redirect limit", { retryable: false });
  }

  async #request(url: URL, token: string | undefined): Promise<Response> {
    if (url.protocol !== "https:" || !isAllowedMetaHost(url.hostname)) {
      throw new ProcessingFailure("Refused non-Meta media URL", { retryable: false });
    }

    try {
      return await this.#fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: token === undefined ? {} : { authorization: "Bearer " + token },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new ProcessingFailure("Meta media request failed before a response was received", {
        retryable: true,
        cause: error
      });
    }
  }
}
