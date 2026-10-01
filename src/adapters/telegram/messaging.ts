import { z } from "zod";
import type { ActionAdapter } from "../../dispatch/dispatcher.js";
import { DispatchFailure } from "../../dispatch/failure.js";
import type { ActionEnvelope, ActionResult } from "../../domain/actions.js";
import { messageSendBodySchema } from "../../domain/actions.js";
import { TelegramSender } from "../../channels/telegram-send.js";

const targetSchema = z.object({
  channel: z.literal("bot"),
  accountId: z.string().min(1),
  recipientId: z.string().min(1)
}).passthrough();

export class TelegramMessagingAdapter implements ActionAdapter {
  readonly provider = "telegram";
  readonly capability = "messaging";
  readonly operation = "message.send";

  constructor(private readonly sender: TelegramSender) {}

  async execute(action: ActionEnvelope): Promise<ActionResult> {
    const target = targetSchema.safeParse(action.target);
    const body = messageSendBodySchema.safeParse(action.body);
    if (!target.success || !body.success) {
      throw new DispatchFailure("Invalid Telegram messaging action payload", { retryable: false });
    }
    if (target.data.accountId !== this.sender.botId) {
      throw new DispatchFailure("Telegram action targets a different bot account", { retryable: false });
    }

    const result = await this.sender.send(target.data.recipientId, body.data.part);
    return result.providerMessageId === undefined
      ? {}
      : { providerResourceId: result.providerMessageId };
  }
}
