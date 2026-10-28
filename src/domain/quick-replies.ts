import { z } from "zod";

/**
 * Provider-neutral representation of fixed customer-selectable text choices.
 * A quick reply is a response option to a customer-initiated conversation,
 * never a standalone marketing authorization or consent grant.
 */
export const quickReplyChoiceSchema = z.object({
  title: z.string().trim().min(1).max(20),
  payload: z.string().min(1).max(1000).regex(/^[^\u0000-\u001f\u007f]+$/u)
}).strict();

export const quickReplyChoicesSchema = z.array(quickReplyChoiceSchema).min(1).max(13)
  .superRefine((choices, ctx) => {
    const payloads = new Set<string>();
    for (const [index, choice] of choices.entries()) {
      if (payloads.has(choice.payload)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate quick reply payload",
          path: [index, "payload"]
        });
      }
      payloads.add(choice.payload);
    }
  });

export type QuickReplyChoice = z.infer<typeof quickReplyChoiceSchema>;
