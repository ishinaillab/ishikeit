# Ishikeit — Telegram official-account reply integration (2026-11-01)

## Objective
Make the studio's real customer-facing Telegram account `@ishinaillab` the preferred Telegram conversation entry point. Preserve the existing Telegram bot replies, which work independently. The bot must not impersonate a personal/business account without an explicit Telegram Business connection.

## Authoritative Telegram API design
- Official Bot API: https://core.telegram.org/bots/api
- Official Business Bot features: https://core.telegram.org/bots/features#business-bots
- Connected business bots: https://core.telegram.org/api/bots/connected-business-bots
- Account-owner settings: https://telegram.org/privacy (Settings > Chat Automation (or Telegram Business > Chatbots when available))
- Telegram User `getMe.can_connect_to_business` reports the bot's Secretary Mode capability.
- Telegram `business_connection`, `business_message`, `edited_business_message`, `deleted_business_messages` webhook updates; the latter three must not automatically trigger AI replies.
- `getBusinessConnection(business_connection_id)` checks the connection is enabled, belongs to username `@ishinaillab`, and has `rights.can_reply`. Revalidate on ingress and egress; fail closed on a foreign/disabled/permissionless account.
- `sendMessage` and media sends support `business_connection_id`. Only reply to private messages from a different, non-bot customer, within 24 hours of the incoming message. Never generate unsolicited messages, message a different Telegram account, or circumvent the account owner's configured chat restrictions.
- Bot messages and connected Business messages are isolated in separate persistent conversation partition keys. The old `channel: bot` and provider-neutral outbox are retained to avoid schema migration.
- Telegram Bot API response size for account checks is 16 KiB bounded. Errors exclude customer data, bot token and raw Telegram error payloads. No new third-party package.

## Deployment and verification
1. CI and disposable Docker Node24/Postgres17 suite pass (existing 536 + new 12 = 548 tests). Review all changes, then merge into `ishinaillab/ishikeit` main and verify exact Hostinger deployed SHA plus /health/live and /health/ready.
2. The private `dist/observability/telegram-business-webhook-cli.js` inspects `getMe.can_connect_to_business`, `getWebhookInfo`, allowed business update types, and the preexisting canonical callback. It outputs only booleans/counts. With `--reconcile`, adds the four business update types **without dropping pending updates or removing existing webhook types**, only if the current webhook URL equals the known canonical callback and no custom certificate is involved.
3. If `businessBotReady=false`, the owner must enable **Secretary Mode** for the bot inside @BotFather; only the bot owner can authorize this.
4. The official `@ishinaillab` Telegram account owner, including on the free tier, must open Telegram Settings > Chat Automation (or Telegram Business > Chatbots when available) and connect the existing Ishikeit bot, grant **Manage Messages / Reply** permission, and select the desired customer-chat scope (ideally new/non-contact customers; explicitly exclude personal chats). This is a Telegram account authorization which cannot be performed with the bot's token, and the bot must never attempt to control the owner's personal session.
5. After connection, an authorized tester sends a fresh private message **to @ishinaillab** (not the bot); verify a signed webhook `business_message` event, one processed inbound record, a single published outbound action containing the business connection ID, and the reply **appearing from @ishinaillab**.
6. Keep the existing Telegram bot independently responding normally, and verify Meta Messenger, Instagram, WhatsApp regression. Do not update premium WordPress plugins or submit Meta App Review.
7. **No success claim until owner connection and actual Telegram Business send-through are verified.** If `@ishinaillab` is a channel (not a user account), this Business Bot mechanism does not provide channel DMs; inspect Telegram channel direct-messages APIs first.

## Configuration
`TELEGRAM_BUSINESS_USERNAME` defaults to `ishinaillab` for this dedicated studio deployment and can be explicitly set if needed. A Telegram Bot API token + existing webhook secret are already required. The username is checked against Telegram's authoritative `BusinessConnection.user.username`; it is not inferred from message text. Treat the bot business connection rights as revocable at any time.

