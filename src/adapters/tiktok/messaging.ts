import { z } from "zod";
import type { ActionAdapter } from "../../dispatch/dispatcher.js";
import { DispatchFailure } from "../../dispatch/failure.js";
import type { ActionEnvelope, ActionResult } from "../../domain/actions.js";
import { messageSendBodySchema } from "../../domain/actions.js";
import { TikTokBusinessSender } from "../../channels/tiktok-send.js";

const targetSchema = z.object({
  channel: z.literal("business"),
  accountId: z.string().min(1),
  recipientId: z.string().min(1)
}).passthrough();

export class TikTokBusinessMessagingAdapter implements ActionAdapter {
  readonly provider = "tiktok";
  readonly capability = "messaging";
  readonly operation = "message.send";

  constructor(private readonly sender: TikTokBusinessSender) {}

  async execute(action: ActionEnvelope): Promise<ActionResult> {
    const target = targetSchema.safeParse(action.target);
    const body = messageSendBodySchema.safeParse(action.body);
    if (!target.success || !body.success) {
      throw new DispatchFailure("Invalid TikTok messaging action payload", { retryable: false });
    }
    if (target.data.accountId !== this.sender.businessId) {
      throw new DispatchFailure("TikTok action targets a different Business Account", {
        retryable: false
      });
    }

    const result = await this.sender.send(
      target.data.recipientId,
      body.data.part,
      body.data.replyTo
    );
    return result.providerMessageId === undefined
      ? {}
      : { providerResourceId: result.providerMessageId };
  }
}
