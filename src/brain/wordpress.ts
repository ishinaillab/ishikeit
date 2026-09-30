import { z } from "zod";
import { contentPartSchema, isMediaContentPart } from "../domain/content.js";
import type { BrainClient, BrainTurnRequest, BrainTurnResponse } from "./types.js";
import type { MediaResolverRegistry } from "../media/resolver.js";
import { ProcessingFailure } from "../processing/failure.js";

interface WordPressBrainClientOptions {
  baseUrl: string;
  token: string;
  mediaResolvers: MediaResolverRegistry;
  requestTimeoutMs?: number;
  fileTtlSeconds?: number;
  fetchImpl?: typeof fetch;
}

const turnResponseSchema = z.object({
  ok: z.literal(true),
  turnId: z.string(),
  parts: z.array(contentPartSchema).max(32),
  handoff: z.boolean()
}).passthrough();

const fileResponseSchema = z.object({
  ok: z.literal(true),
  file: z.object({ id: z.string().min(1) }).passthrough()
}).passthrough();

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

export class WordPressBrainClient implements BrainClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #mediaResolvers: MediaResolverRegistry;
  readonly #requestTimeoutMs: number;
  readonly #fileTtlSeconds: number;
  readonly #fetch: typeof fetch;

  constructor(options: WordPressBrainClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#mediaResolvers = options.mediaResolvers;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 90_000;
    this.#fileTtlSeconds = options.fileTtlSeconds ?? 3600;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async respond(request: BrainTurnRequest): Promise<BrainTurnResponse> {
    const fileIds: string[] = [];
    const textSegments: string[] = [];

    for (const part of request.input) {
      if (part.kind === "text") {
        textSegments.push(part.text);
        continue;
      }
      if (part.kind === "structured") {
        textSegments.push(
          "[Structured customer content: " + part.format + "]\n" +
          JSON.stringify(part.data).slice(0, 12_000)
        );
        continue;
      }
      if (isMediaContentPart(part)) {
        if (part.caption !== undefined && part.caption.length > 0) textSegments.push(part.caption);
        const media = await this.#mediaResolvers.resolve(request.event, part);
        fileIds.push(await this.#upload(media.bytes, media.filename, media.mimeType));
      }
    }

    const message = textSegments.join("\n\n").trim()
      || "The customer sent one or more attachments without accompanying text. Respond appropriately to the attachments.";

    const response = await this.#request(this.#baseUrl + "/turn", {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.#token,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        schemaVersion: 1,
        turnId: request.turnId,
        conversationId: request.conversationId,
        message,
        fileIds,
        context: {
          provider: request.event.provider,
          channel: request.event.channel,
          capability: request.event.capability,
          eventType: request.event.eventType,
          occurredAt: request.event.occurredAt ?? null
        }
      })
    });

    const data: unknown = await response.json().catch(() => ({}));
    const parsed = turnResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProcessingFailure("WordPress AI bridge returned an invalid turn response", {
        retryable: response.status >= 500
      });
    }
    return { parts: parsed.data.parts, handoff: parsed.data.handoff };
  }

  async #upload(bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
    const form = new FormData();
    const copied = Uint8Array.from(bytes);
    form.append("file", new Blob([copied], { type: mimeType }), filename);
    form.append("purpose", "analysis");
    form.append("ttl", String(this.#fileTtlSeconds));

    const response = await this.#request(this.#baseUrl + "/files", {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.#token,
        accept: "application/json"
      },
      body: form
    });
    const data: unknown = await response.json().catch(() => ({}));
    const parsed = fileResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProcessingFailure("WordPress AI bridge returned an invalid file response", {
        retryable: response.status >= 500
      });
    }
    return parsed.data.file.id;
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new ProcessingFailure("WordPress AI bridge request failed before a response was received", {
        retryable: true,
        cause: error
      });
    }

    if (response.ok) return response;
    const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
    throw new ProcessingFailure("WordPress AI bridge returned HTTP " + response.status, {
      retryable,
      ...(retryAfterMs(response.headers.get("retry-after")) === undefined
        ? {}
        : { retryAfterMs: retryAfterMs(response.headers.get("retry-after"))! })
    });
  }
}
