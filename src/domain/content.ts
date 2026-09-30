import { z } from "zod";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const mediaReferenceSchema = z.object({
  kind: identifierSchema,
  value: z.string().min(1).max(4096)
}).strict();

const mediaBase = {
  source: mediaReferenceSchema,
  mimeType: z.string().min(1).max(255).optional(),
  filename: z.string().min(1).max(255).optional(),
  caption: z.string().max(4096).optional(),
  sizeBytes: z.number().int().nonnegative().optional()
};

export const contentPartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(100000) }).strict(),
  z.object({ kind: z.literal("image"), ...mediaBase }).strict(),
  z.object({ kind: z.literal("video"), ...mediaBase }).strict(),
  z.object({ kind: z.literal("audio"), ...mediaBase }).strict(),
  z.object({ kind: z.literal("document"), ...mediaBase }).strict(),
  z.object({ kind: z.literal("structured"), format: identifierSchema, data: z.unknown() }).strict()
]);

export type ContentPart = z.infer<typeof contentPartSchema>;
export type MediaContentPart = Extract<ContentPart, { source: unknown }>;

export function isMediaContentPart(part: ContentPart): part is MediaContentPart {
  return part.kind === "image" || part.kind === "video" || part.kind === "audio" || part.kind === "document";
}
