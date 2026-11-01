import { z } from "zod";
import type { ActionAdapter } from "../../dispatch/dispatcher.js";
import { DispatchFailure } from "../../dispatch/failure.js";
import type { ActionEnvelope, ActionResult } from "../../domain/actions.js";
import { messageSendBodySchema } from "../../domain/actions.js";
import { MetaSender } from "../../channels/meta-send.js";
import type { MetaHandoffReader } from "../../persistence/meta-handoff.js";
import { metaOutboundPayloadSchema } from "../../domain/outbound.js";
import { standardMetaReplyEligibility } from "../../dispatch/meta-customer-window.js";

const targetSchema = z.object({
  channel: z.enum(["messenger", "instagram", "whatsapp"]),
  accountId: z.string().min(1),
  recipientId: z.string().min(1)
}).passthrough();

export class MetaMessagingAdapter implements ActionAdapter {
  readonly provider = "meta";
  readonly capability = "messaging";
  readonly operation = "message.send";

  constructor(
    private readonly sender: MetaSender,
    private readonly metaHandoffs?: MetaHandoffReader
  ) {}

  async execute(action: ActionEnvelope): Promise<ActionResult> {
    const target = targetSchema.safeParse(action.target);
    const body = messageSendBodySchema.safeParse(action.body);
    if (!target.success || !body.success) {
      throw new DispatchFailure("Invalid Meta messaging action payload", { retryable: false });
    }

    const eligibility = standardMetaReplyEligibility(body.data.customerMessageAt, new Date(), target.data.channel);
    if (eligibility !== "eligible") {
      throw new DispatchFailure(`Meta standard reply is not eligible: ${eligibility}`, { retryable: false });
    }

    // A queued AI reply must never leave after a human has taken over
    // the conversation, even if the reply was generated before handoff.
    if (this.metaHandoffs !== undefined && await this.metaHandoffs.isActive(action.orderingKey)) {
      throw new DispatchFailure("Meta conversation is under human handoff", { retryable: false });
    }

    const payload = metaOutboundPayloadSchema.parse({
      schemaVersion: 2,
      channel: target.data.channel,
      accountId: target.data.accountId,
      recipientId: target.data.recipientId,
      message: body.data.part,
      ...(body.data.replyTo === undefined ? {} : { replyTo: body.data.replyTo }),
      ...(body.data.quickReplies === undefined ? {} : { quickReplies: body.data.quickReplies }),
      ...(body.data.interactiveList === undefined ? {} : { interactiveList: body.data.interactiveList })
    });

    const result = await this.sender.send(payload);
    return result.providerMessageId === undefined
      ? {}
      : { providerResourceId: result.providerMessageId };
  }
}
