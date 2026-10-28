import { z } from "zod";

/**
 * Provider-neutral representation for an explicit structured list of customer
 * choices. WhatsApp Cloud API is the first supported transport.
 */
export const interactiveListRowSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(24),
  description: z.string().trim().min(1).max(72).optional()
}).strict();

export const interactiveListSchema = z.object({
  button: z.string().trim().min(1).max(20),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(24),
    rows: z.array(interactiveListRowSchema).min(1).max(10)
  }).strict()).min(1).max(10)
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  let rows = 0;
  for (const [sectionIndex, section] of value.sections.entries()) {
    for (const [rowIndex, row] of section.rows.entries()) {
      rows += 1;
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: "custom", message: "Duplicate interactive list row ID",
          path: ["sections", sectionIndex, "rows", rowIndex, "id"]
        });
      }
      seen.add(row.id);
    }
  }
  if (rows > 10) {
    ctx.addIssue({
      code: "custom", message: "Interactive lists support ten total rows",
      path: ["sections"]
    });
  }
});

export type InteractiveList = z.infer<typeof interactiveListSchema>;
