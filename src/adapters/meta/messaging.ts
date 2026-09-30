import { z } from "zod";
import type { ActionAdapter } from "../../dispatch/dispatcher.js";
import { DispatchFailure } from "../../dispatch/failure.js";
import type { ActionEnvelope, ActionResult } from "../../domain/actions.js";
import { messageSendBodySchema } from "../../domain/actions.js";
import { MetaSender } from "../../channels/meta-send.js";
import { metaOutboundPayloadSchema } from "../../domain/outbound.js";

const targetSchema = z.object({
  channel: z.enum(["messenger", "instagram", "whatsapp"]),
  accountId: z.string().min(1),
  recipientId: z.string().min(1)
}).passthrough();

export class MetaMessagingAdapter implements ActionAdapter {
  readonly provider = "meta";
  readonly capability = "messaging";
  readonly operation = "message.send";

  constructor(private readonly sender: MetaSender) {}

  async execute(action: ActionEnvelope): Promise<ActionResult> {
    const target = targetSchema.safeParse(action.target);
    const body = messageSendBodySchema.safeParse(action.body);
    if (!target.success || !body.success) {
      throw new DispatchFailure("Invalid Meta messaging action payload", { retryable: false });
    }

    const payload = metaOutboundPayloadSchema.parse({
      schemaVersion: 2,
      channel: target.data.channel,
      accountId: target.data.accountId,
      recipientId: target.data.recipientId,
      message: body.data.part,
      ...(body.data.replyTo === undefined ? {} : { replyTo: body.data.replyTo })
    });

    const result = await this.sender.send(payload);
    return result.providerMessageId === undefined
      ? {}
      : { providerResourceId: result.providerMessageId };
  }
}
