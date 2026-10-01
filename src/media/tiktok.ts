import { isIP } from "node:net";
import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";
import type { MediaContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";
import { ProcessingFailure } from "../processing/failure.js";
import type { MediaResolver, ResolvedMedia } from "./resolver.js";

interface TikTokMediaResolverOptions {
  businessId: string;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  maxBytes: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function privateIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
  ) {
    return true;
  }

  const version = isIP(host);
  if (version === 0) return false;
  if (version === 4) {
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = /^172\.(\d{1,3})\./.exec(host);
    if (match !== null) {
      const second = Number(match[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return host === "0.0.0.0" || /^169\.254\./.test(host);
  }

  return host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || /^fe[89ab]/.test(host);
}

function extension(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "video/webm") return "webm";
  return "bin";
}

export class TikTokMediaResolver implements MediaResolver {
  readonly provider = "tiktok";
  readonly #businessId: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #maxBytes: number;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokMediaResolverOptions) {
    this.#businessId = options.businessId;
    if ((options.accessToken === undefined) === (options.accessTokenProvider === undefined)) {
      throw new Error("TikTok media resolver requires exactly one access-token source");
    }
    this.#accessTokenProvider = options.accessTokenProvider
      ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#maxBytes = options.maxBytes;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async resolve(event: CanonicalEvent, part: MediaContentPart): Promise<ResolvedMedia> {
    if (event.provider !== "tiktok" || event.channel !== "business") {
      throw new ProcessingFailure("TikTok media resolver requires a TikTok business event", {
        retryable: false
      });
    }
    if (event.accountId !== this.#businessId) {
      throw new ProcessingFailure("TikTok media event targets a different Business Account", {
        retryable: false
      });
    }
    if (part.source.kind !== "provider") {
      throw new ProcessingFailure("TikTok inbound media requires a provider media ID", {
        retryable: false
      });
    }
    if (part.kind !== "image" && part.kind !== "video") {
      throw new ProcessingFailure("TikTok inbound media type is not supported", {
        retryable: false
      });
    }
    if (event.identityId === undefined || event.providerMessageId === undefined) {
      throw new ProcessingFailure("TikTok media event is missing conversation or message identity", {
        retryable: false
      });
    }

    let accessToken: string;
    try {
      accessToken = await this.#accessTokenProvider.getAccessToken();
    } catch (error) {
      throw new ProcessingFailure("TikTok OAuth access token is unavailable", {
        retryable: error instanceof AccessTokenError ? error.retryable : true,
        cause: error
      });
    }

    const metadata = await this.#metadata({
      business_id: this.#businessId,
      conversation_id: event.identityId,
      message_id: event.providerMessageId,
      media_id: part.source.value,
      media_type: part.kind.toUpperCase()
    }, accessToken);

    const rawUrl = metadata.download_url;
    if (typeof rawUrl !== "string") {
      throw new ProcessingFailure("TikTok media metadata did not contain a download URL", {
        retryable: true
      });
    }

    return this.#download(new URL(rawUrl), part, event.providerMessageId, accessToken);
  }

  async #metadata(
    payload: Record<string, unknown>,
    accessToken: string
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(
        `https://business-api.tiktok.com/open_api/${this.#apiVersion}/business/message/media/download/`,
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
      throw new ProcessingFailure(
        "TikTok media metadata request failed before a response was received",
        { retryable: true, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw);
    const code = body?.code;
    if (!response.ok || (code !== 0 && code !== "0")) {
      throw new ProcessingFailure("TikTok media metadata request failed", {
        retryable: response.status === 429 || response.status >= 500
      });
    }

    const data = record(body?.data);
    if (data === undefined) {
      throw new ProcessingFailure("TikTok media metadata response was invalid", { retryable: true });
    }
    return data;
  }

  async #download(
    initialUrl: URL,
    part: MediaContentPart,
    messageId: string,
    accessToken: string
  ): Promise<ResolvedMedia> {
    let url = initialUrl;
    const initialHost = initialUrl.hostname.toLowerCase();

    for (let redirect = 0; redirect <= 3; redirect++) {
      this.#validateDownloadUrl(url, initialHost);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          redirect: "manual",
          headers: { "x-user": accessToken },
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        });
      } catch (error) {
        throw new ProcessingFailure(
          "TikTok media download failed before a response was received",
          { retryable: true, cause: error }
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirect === 3) {
          throw new ProcessingFailure("TikTok media redirect could not be followed safely", {
            retryable: false
          });
        }
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        throw new ProcessingFailure("TikTok media download failed with HTTP " + response.status, {
          retryable: response.status === 429 || response.status >= 500
        });
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
        throw new ProcessingFailure("Inbound media exceeds the configured byte limit", {
          retryable: false
        });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.#maxBytes) {
        throw new ProcessingFailure("Inbound media exceeds the configured byte limit", {
          retryable: false
        });
      }

      const mimeType = part.mimeType
        ?? response.headers.get("content-type")?.split(";", 1)[0]?.trim()
        ?? (part.kind === "image" ? "image/jpeg" : "video/mp4");
      return {
        bytes,
        filename: `tiktok-${part.kind}-${messageId}.${extension(mimeType)}`,
        mimeType
      };
    }

    throw new ProcessingFailure("TikTok media download exceeded redirect limit", {
      retryable: false
    });
  }

  #validateDownloadUrl(url: URL, initialHost: string): void {
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || privateIpLiteral(url.hostname)
      || url.hostname.toLowerCase() !== initialHost
    ) {
      throw new ProcessingFailure("Refused unsafe TikTok media download URL", {
        retryable: false
      });
    }
  }
}
