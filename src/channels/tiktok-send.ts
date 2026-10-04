import { isIP } from "node:net";
import { DispatchFailure } from "../dispatch/failure.js";
import type { ContentPart } from "../domain/content.js";
import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";
import {
  TikTokBusinessMessagingNotAuthorizedError,
  TikTokBusinessMessagingValidationError,
  type TikTokBusinessConversationType
} from "../messaging/tiktok-business-read.js";

interface TikTokBusinessSenderOptions {
  businessId: string;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  apiVersion?: string;
  requestTimeoutMs?: number;
  imageCapabilityResolver?: TikTokImageCapabilityResolver;
  fetchImpl?: typeof fetch;
}

export interface TikTokImageCapabilityResolver {
  resolveConversationType(
    conversationId: string
  ): Promise<TikTokBusinessConversationType>;
  checkImageSendCapability(input: {
    conversationId: string;
    conversationType: TikTokBusinessConversationType;
  }): Promise<{ imageSend: boolean }>;
}

export interface TikTokSendResult {
  providerMessageId?: string;
}

type ImageContentPart = Extract<ContentPart, { kind: "image" }>;

const TIKTOK_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

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

function normalizedMimeType(value: string | null | undefined): string | undefined {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function privateIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
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
    if (/^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)) {
      return true;
    }
    const match = /^172\.(\d{1,3})\./u.exec(host);
    if (match !== null) {
      const second = Number(match[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return host === "0.0.0.0" || /^169\.254\./u.test(host);
  }

  return host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || /^fe[89ab]/u.test(host);
}

function retryableProviderFailure(status: number, code: string | undefined): boolean {
  return status === 429
    || status >= 500
    || code === "40100"
    || code === "51065";
}

function imageFilename(part: ImageContentPart, mimeType: string): string {
  if (part.filename !== undefined && part.filename.length > 0) {
    return part.filename;
  }
  return mimeType === "image/png" ? "image.png" : "image.jpg";
}

export class TikTokBusinessSender {
  readonly businessId: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #imageCapabilityResolver: TikTokImageCapabilityResolver | undefined;
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
    this.#imageCapabilityResolver = options.imageCapabilityResolver;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async send(
    conversationId: string,
    part: ContentPart,
    replyTo?: string
  ): Promise<TikTokSendResult> {
    if (part.kind === "text") {
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

    if (part.kind === "image") {
      return this.#sendImage(conversationId, part, replyTo);
    }

    throw new DispatchFailure(
      "TikTok generic messaging supports text and image messages only",
      { retryable: false }
    );
  }

  async sendCommentReply(
    commentId: string,
    part: ContentPart
  ): Promise<TikTokSendResult> {
    if (commentId.length < 1 || commentId.length > 2048) {
      throw new DispatchFailure("TikTok Comment-to-Message comment ID is invalid", {
        retryable: false
      });
    }
    if (part.kind !== "text") {
      throw new DispatchFailure(
        "TikTok Comment-to-Message direct replies support text only",
        { retryable: false }
      );
    }
    if (part.text.length > 6000) {
      throw new DispatchFailure("TikTok text exceeds the Business Messaging limit", {
        retryable: false
      });
    }

    return this.#request({
      business_id: this.businessId,
      message_type: "TEXT",
      text: { body: part.text },
      direct_reply: {
        reply_type: "COMMENT_REPLY",
        comment_reply: { comment_id: commentId }
      }
    });
  }

  async #sendImage(
    conversationId: string,
    part: ImageContentPart,
    replyTo: string | undefined
  ): Promise<TikTokSendResult> {
    if (replyTo !== undefined) {
      throw new DispatchFailure(
        "TikTok image messages cannot be sent as referenced-message replies",
        { retryable: false }
      );
    }
    if (part.caption !== undefined && part.caption.length > 0) {
      throw new DispatchFailure(
        "TikTok image messages cannot include a text caption",
        { retryable: false }
      );
    }
    if (part.source.kind !== "url") {
      throw new DispatchFailure(
        "TikTok outbound image messages require an HTTPS URL source",
        { retryable: false }
      );
    }
    if (
      part.sizeBytes !== undefined
      && part.sizeBytes > TIKTOK_IMAGE_MAX_BYTES
    ) {
      throw new DispatchFailure(
        "TikTok image exceeds the Business Messaging 3 MB limit",
        { retryable: false }
      );
    }

    const declaredMimeType = normalizedMimeType(part.mimeType);
    if (
      declaredMimeType !== undefined
      && !SUPPORTED_IMAGE_MIME_TYPES.has(declaredMimeType)
    ) {
      throw new DispatchFailure(
        "TikTok outbound images must be JPG/JPEG or PNG",
        { retryable: false }
      );
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(part.source.value);
    } catch {
      throw new DispatchFailure("TikTok outbound image URL is invalid", {
        retryable: false
      });
    }
    this.#validateImageUrl(sourceUrl, sourceUrl.hostname.toLowerCase());

    await this.#assertImageSendCapability(conversationId);

    const accessToken = await this.#accessToken();
    const image = await this.#downloadImage(sourceUrl, part);
    const mediaId = await this.#uploadImage(image, accessToken);

    return this.#request({
      business_id: this.businessId,
      recipient_type: "CONVERSATION",
      recipient: conversationId,
      message_type: "IMAGE",
      image: { media_id: mediaId }
    }, accessToken);
  }

  async #assertImageSendCapability(conversationId: string): Promise<void> {
    if (this.#imageCapabilityResolver === undefined) {
      throw new DispatchFailure(
        "TikTok IMAGE_SEND capability resolver is unavailable",
        { retryable: false, ambiguous: false }
      );
    }

    try {
      const conversationType =
        await this.#imageCapabilityResolver.resolveConversationType(conversationId);
      const capability =
        await this.#imageCapabilityResolver.checkImageSendCapability({
          conversationId,
          conversationType
        });

      if (!capability.imageSend) {
        throw new DispatchFailure(
          "TikTok conversation does not support image sending",
          { retryable: false, ambiguous: false }
        );
      }
    } catch (error) {
      if (error instanceof DispatchFailure) throw error;

      const retryable = error instanceof TikTokBusinessMessagingNotAuthorizedError
        || error instanceof TikTokBusinessMessagingValidationError
        ? false
        : typeof error === "object"
          && error !== null
          && typeof (error as { retryable?: unknown }).retryable === "boolean"
          ? (error as { retryable: boolean }).retryable
          : true;

      throw new DispatchFailure(
        "TikTok IMAGE_SEND capability preflight failed",
        {
          retryable,
          ambiguous: false,
          cause: error
        }
      );
    }
  }

  #validateImageUrl(url: URL, initialHost: string): void {
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || privateIpLiteral(url.hostname)
      || url.hostname.toLowerCase() !== initialHost
    ) {
      throw new DispatchFailure(
        "TikTok outbound image requires a safe HTTPS URL",
        { retryable: false }
      );
    }
  }

  async #downloadImage(
    initialUrl: URL,
    part: ImageContentPart
  ): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
    let url = initialUrl;
    const initialHost = initialUrl.hostname.toLowerCase();

    for (let redirect = 0; redirect <= 3; redirect++) {
      this.#validateImageUrl(url, initialHost);

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        });
      } catch (error) {
        throw new DispatchFailure(
          "TikTok outbound image download failed before a response was received",
          { retryable: true, ambiguous: false, cause: error }
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirect === 3) {
          throw new DispatchFailure(
            "TikTok outbound image redirect could not be followed safely",
            { retryable: false }
          );
        }
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        throw new DispatchFailure(
          "TikTok outbound image download failed with HTTP " + response.status,
          {
            retryable: response.status === 429 || response.status >= 500,
            ambiguous: false,
            status: response.status
          }
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength)
        && declaredLength > TIKTOK_IMAGE_MAX_BYTES
      ) {
        throw new DispatchFailure(
          "TikTok image exceeds the Business Messaging 3 MB limit",
          { retryable: false }
        );
      }

      const mimeType = normalizedMimeType(response.headers.get("content-type"))
        ?? normalizedMimeType(part.mimeType);
      if (
        mimeType === undefined
        || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
      ) {
        throw new DispatchFailure(
          "TikTok outbound images must be JPG/JPEG or PNG",
          { retryable: false }
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new DispatchFailure("TikTok outbound image is empty", {
          retryable: false
        });
      }
      if (bytes.byteLength > TIKTOK_IMAGE_MAX_BYTES) {
        throw new DispatchFailure(
          "TikTok image exceeds the Business Messaging 3 MB limit",
          { retryable: false }
        );
      }

      return {
        bytes,
        mimeType,
        filename: imageFilename(part, mimeType)
      };
    }

    throw new DispatchFailure(
      "TikTok outbound image redirect limit was exceeded",
      { retryable: false }
    );
  }

  async #uploadImage(
    image: { bytes: Uint8Array; mimeType: string; filename: string },
    accessToken: string
  ): Promise<string> {
    const form = new FormData();
    form.append("business_id", this.businessId);
    form.append(
      "file",
      new Blob([Uint8Array.from(image.bytes)], { type: image.mimeType }),
      image.filename
    );
    form.append("media_type", "IMAGE");

    let response: Response;
    try {
      response = await this.#fetch(
        `https://business-api.tiktok.com/open_api/${this.#apiVersion}/business/message/media/upload/`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "Access-Token": accessToken
          },
          body: form,
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        }
      );
    } catch (error) {
      throw new DispatchFailure(
        "TikTok image upload failed before a response was received",
        { retryable: true, ambiguous: false, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw);
    const codeString = providerCode(body?.code);
    const success = response.ok && (body?.code === 0 || body?.code === "0");
    if (!success) {
      throw new DispatchFailure("TikTok Business Messaging API rejected the image upload", {
        retryable: retryableProviderFailure(response.status, codeString),
        ambiguous: false,
        ...(response.status >= 400 ? { status: response.status } : {}),
        ...(codeString === undefined ? {} : { providerCode: codeString })
      });
    }

    const data = record(body?.data);
    const mediaId = data?.media_id;
    if (typeof mediaId !== "string" || mediaId.length === 0) {
      throw new DispatchFailure(
        "TikTok image upload response did not contain a media ID",
        { retryable: true, ambiguous: false }
      );
    }
    return mediaId;
  }

  async #accessToken(): Promise<string> {
    try {
      return await this.#accessTokenProvider.getAccessToken();
    } catch (error) {
      throw new DispatchFailure("TikTok OAuth access token is unavailable", {
        retryable: error instanceof AccessTokenError ? error.retryable : true,
        ambiguous: false,
        cause: error
      });
    }
  }

  async #request(
    payload: Record<string, unknown>,
    suppliedAccessToken?: string
  ): Promise<TikTokSendResult> {
    const accessToken = suppliedAccessToken ?? await this.#accessToken();

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
    throw new DispatchFailure("TikTok Business Messaging API rejected the outbound message", {
      retryable: retryableProviderFailure(response.status, codeString),
      ambiguous: false,
      ...(effectiveStatus === undefined ? {} : { status: effectiveStatus }),
      ...(codeString === undefined ? {} : { providerCode: codeString })
    });
  }
}
