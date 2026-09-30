import type { MediaContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";
import type { ResolvedMedia } from "./resolver.js";

export interface MediaInterpretation {
  text: string;
  backend: string;
  model?: string;
}

export interface MediaInterpreter {
  readonly kind: MediaContentPart["kind"];
  interpret(
    event: CanonicalEvent,
    part: MediaContentPart,
    media: ResolvedMedia
  ): Promise<MediaInterpretation | undefined>;
}

export class MediaInterpreterRegistry {
  readonly #interpreters = new Map<MediaContentPart["kind"], MediaInterpreter>();

  register(interpreter: MediaInterpreter): void {
    if (this.#interpreters.has(interpreter.kind)) {
      throw new Error("duplicate media interpreter for kind " + interpreter.kind);
    }
    this.#interpreters.set(interpreter.kind, interpreter);
  }

  has(kind: MediaContentPart["kind"]): boolean {
    return this.#interpreters.has(kind);
  }

  interpret(
    event: CanonicalEvent,
    part: MediaContentPart,
    media: ResolvedMedia
  ): Promise<MediaInterpretation | undefined> {
    const interpreter = this.#interpreters.get(part.kind);
    if (interpreter === undefined) return Promise.resolve(undefined);
    return interpreter.interpret(event, part, media);
  }
}
