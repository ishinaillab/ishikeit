import { z } from "zod";
import type { ActionAdapter } from "../../dispatch/dispatcher.js";
import { DispatchFailure } from "../../dispatch/failure.js";
import type { ActionEnvelope, ActionResult } from "../../domain/actions.js";
import { messageSendBodySchema } from "../../domain/actions.js";
import { TikTokBusinessSender } from "../../channels/tiktok-send.js";

const targetSchema = z.object({
  channel: z.literal("business"),
  accountId: z.string().min(1),
  commentId: z.string().min(1).max(2048)
}).passthrough();

export class TikTokCommentToMessageAdapter implements ActionAdapter {
  readonly provider = "tiktok";
  readonly capability = "messaging";
  readonly operation = "comment_to_message.reply";

  constructor(private readonly sender: TikTokBusinessSender) {}

  async execute(action: ActionEnvelope): Promise<ActionResult> {
    const target = targetSchema.safeParse(action.target);
    const body = messageSendBodySchema.safeParse(action.body);
    if (!target.success || !body.success || body.data.replyTo !== undefined) {
      throw new DispatchFailure(
        "Invalid TikTok Comment-to-Message action payload",
        { retryable: false }
      );
    }
    if (target.data.accountId !== this.sender.businessId) {
      throw new DispatchFailure(
        "TikTok Comment-to-Message action targets a different Business Account",
        { retryable: false }
      );
    }
    if (body.data.part.kind !== "text") {
      throw new DispatchFailure(
        "TikTok Comment-to-Message direct replies support text only",
        { retryable: false }
      );
    }

    const result = await this.sender.sendCommentReply(
      target.data.commentId,
      body.data.part
    );
    return result.providerMessageId === undefined
      ? {}
      : { providerResourceId: result.providerMessageId };
  }
}
