import { describe, expect, it } from "vitest";
import { MAX_META_REPLY_ACTIONS, splitMetaReplyParts } from "../src/processing/meta-reply-split.js";

describe("lossless Meta AI reply segmentation", () => {
  it("keeps Instagram outbound text inside 1000 UTF-8 bytes", () => {
    const text = "Our nail appointments are private. ".repeat(80) + "👩‍💻✨";
    const result = splitMetaReplyParts([{ kind: "text", text }], "instagram");
    expect(result).toBeDefined();
    const chunks = result!.map((part) => part.kind === "text" ? part.text : "");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(1000);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("does not split a multi-codepoint emoji or a combining grapheme", () => {
    const text = "a".repeat(995) + "👩‍💻" + "o\u0301".repeat(200);
    const result = splitMetaReplyParts([{ kind: "text", text }], "instagram");
    expect(result).toBeDefined();
    const chunks = result!.map((part) => part.kind === "text" ? part.text : "");
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(1000);
      expect(chunk.startsWith("\u0301")).toBe(false);
      expect(chunk.endsWith("\u200d")).toBe(false);
    }
  });

  it("honors Messenger and WhatsApp character limits", () => {
    for (const [channel, max] of [["messenger",1999],["whatsapp",4096]] as const) {
      const text = "x".repeat(max + 24) + " y";
      const result = splitMetaReplyParts([{ kind: "text", text }], channel);
      expect(result).toBeDefined();
      const chunks = result!.map((part) => part.kind === "text" ? part.text : "");
      expect(chunks.join("")).toBe(text);
      expect(chunks).toHaveLength(2);
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(max);
    }
  });

  it("keeps existing media and exact response-part order", () => {
    const media = { kind: "image" as const, source: { kind: "url", value: "https://example.org/a.png" } };
    const parts = [{ kind: "text" as const, text: "a".repeat(1100) }, media];
    const result = splitMetaReplyParts(parts, "instagram");
    expect(result).toHaveLength(3);
    expect(result?.[2]).toBe(media);
    expect(result?.slice(0,2).map((part) => part.kind === "text" ? part.text : "").join("")).toBe(parts[0]?.text);
  });

  it("hands off instead of partially sending a reply above the flood limit", () => {
    const result = splitMetaReplyParts([{ kind: "text", text: "A".repeat(9500) }], "instagram");
    expect(result).toBeUndefined();
    const exact = splitMetaReplyParts([{ kind: "text", text: "A".repeat(8000) }], "instagram");
    expect(exact).toHaveLength(MAX_META_REPLY_ACTIONS);
  });
});
