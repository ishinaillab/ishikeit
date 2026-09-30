import type { MediaContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";
import { ProcessingFailure } from "../processing/failure.js";

export interface ResolvedMedia {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface MediaResolver {
  readonly provider: string;
  resolve(event: CanonicalEvent, part: MediaContentPart): Promise<ResolvedMedia>;
}

export class MediaResolverRegistry {
  readonly #resolvers = new Map<string, MediaResolver>();

  register(resolver: MediaResolver): void {
    if (this.#resolvers.has(resolver.provider)) {
      throw new Error("duplicate media resolver for provider " + resolver.provider);
    }
    this.#resolvers.set(resolver.provider, resolver);
  }

  resolve(event: CanonicalEvent, part: MediaContentPart): Promise<ResolvedMedia> {
    const resolver = this.#resolvers.get(event.provider);
    if (resolver === undefined) {
      throw new ProcessingFailure("No media resolver registered for provider " + event.provider, { retryable: false });
    }
    return resolver.resolve(event, part);
  }
}
