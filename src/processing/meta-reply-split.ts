import type { ContentPart } from "../domain/content.js";

/**
 * Exact current Meta sender limits. Split before creating durable outbox
 * actions: each chunk receives its own stable, ordered idempotency key.
 */
const TEXT_LIMITS = {
  instagram: { max: 1000, utf8: true },
  messenger: { max: 1999, utf8: false },
  whatsapp: { max: 4096, utf8: false }
} as const;

export type MetaTextChannel = keyof typeof TEXT_LIMITS;

/** Prevent a single AI turn from flooding a customer conversation. */
export const MAX_META_REPLY_ACTIONS = 8;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function measuredLength(value: string, utf8: boolean): number {
  return utf8 ? Buffer.byteLength(value, "utf8") : value.length;
}

function splitText(
  value: string,
  limit: number,
  utf8: boolean
): string[] | undefined {
  if (measuredLength(value, utf8) <= limit) return [value];

  const result: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = start;
    let whitespaceBoundary = start;
    let length = 0;

    for (const item of graphemes.segment(value.slice(start))) {
      const nextLength = measuredLength(item.segment, utf8);
      if (length + nextLength > limit) break;
      length += nextLength;
      end += item.segment.length;
      if (/\s$/u.test(item.segment)) whitespaceBoundary = end;
    }

    // A single Unicode grapheme must never be split into invalid fragments.
    if (end <= start) return undefined;
    const boundary = whitespaceBoundary > start + Math.floor((end - start) * 0.65)
      ? whitespaceBoundary
      : end;
    result.push(value.slice(start, boundary));
    if (result.length > MAX_META_REPLY_ACTIONS) return undefined;
    start = boundary;
  }
  return result;
}

/**
 * Return an ordered, lossless expansion of AI response parts for the Meta
 * provider, or undefined when a safe bounded reply cannot be constructed.
 * Do not silently truncate customer-facing content.
 */
export function splitMetaReplyParts(
  parts: readonly ContentPart[],
  channel: MetaTextChannel
): ContentPart[] | undefined {
  const { max, utf8 } = TEXT_LIMITS[channel];
  const result: ContentPart[] = [];
  for (const part of parts) {
    if (part.kind !== "text") {
      result.push(part);
    } else {
      const chunks = splitText(part.text, max, utf8);
      if (chunks === undefined) return undefined;
      for (const text of chunks) result.push({ kind: "text", text });
    }
    if (result.length > MAX_META_REPLY_ACTIONS) return undefined;
  }
  return result;
}
