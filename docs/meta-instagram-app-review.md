# Meta Instagram App Review package

Updated: 2026-10-28

## Production state

Ishikeit uses **Instagram API with Instagram Login** and requests only:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Current verified state:

- Meta app: **Ishikeit** (`1042452472116584`)
- App mode: live
- Business Verification: passes
- App Review: `NO_SUBMISSION`
- `can_submit=true`
- Advanced Access grants: none
- Production revision must be verified against Hostinger `/health/build` before submission; prior October 3 fingerprint is historical.
- Production health: ready
- Previously authorized OAuth account: **@povnailstudio.ph** (tester; current Graph account resolution returns code 190).
- The actual business account used to receive customers' DMs must be verified as **@ishinaillab** before App Review.
- OAuth credential: encrypted at rest, locally unexpired but currently rejected by Graph API error 190; reauthorization may be required.
- Required scopes are present
- App-level subscription exists for `messages`, `standby`, and `messaging_handover`; account-level reconciliation is currently warning and needs a verified owner token.
- Instagram outgoing token routing is OAuth-first, with a strictly account-matched managed owner token allowed when no OAuth grant exists. Do not assume the historic tester OAuth grant authorizes the business inbox.

Public reviewer entry point:

https://www.ishinaillab.com/instagram-connect-review/
## Instagram access-level decision: own-business case versus webhook delivery

**Do not assume App Review is invariably required or already approved.** Meta's [Instagram API App Review documentation](https://developers.facebook.com/documentation/instagram-platform/app-review) says an app used **only by a business it owns or manages** may use Standard Access without App Review, including Instagram Login. Ishikeit currently serves Ishi Nail Lab's own Professional account.

The separate [Instagram Messaging webhooks guide](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks) also states that webhooks containing data owned by users without an app role require App Review and describes role-limited delivery when review is absent or not needed. The [Instagram API with Instagram Login send guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) distinguishes own-managed Standard Access again. These statements must be reconciled for Ishikeit's exact product, permissions, recipient and ownership before any general-public delivery assertion.

**Release test:** verify the actual Instagram Login path, `instagram_business_basic` and `instagram_business_manage_messages` grants, managed Professional-account identity and account-level webhook subscription, followed by a fresh **authorized** ordinary non-role sender-initiated message to `@ishinaillab`. Check actual signed ingress, durable message processing and legitimate outbound reply without creating an app role or using another account's credential. If Meta limits the webhook because of access, request the applicable permission review or authoritative provider clarification. The reviewer package below is a prepared conditional path, not proof that review is mandatory in all single-business scenarios.

Ishikeit's use is customer-initiated support, not unsolicited messaging.

## Permission justification

### `instagram_business_basic`

Ishikeit uses `instagram_business_basic` to authenticate an Instagram Professional account through Business Login for Instagram, identify the authorized Professional account, and bind that routing identity to its encrypted server-side OAuth credential.

The permission is used only to support the authorized business account's messaging integration. Ishikeit does not use it for unrelated profile harvesting, advertising, or public-content collection.

### `instagram_business_manage_messages`

Ishikeit uses `instagram_business_manage_messages` to receive Instagram Direct message webhook events for the authorized Professional account and send replies to the Instagram user who initiated the conversation.

The use case is an automated customer-support experience for Ishi Nail Lab. Ishikeit does not initiate unsolicited conversations.
## Reviewer verification instructions

1. Open https://www.ishinaillab.com/instagram-connect-review/
2. Click **Connect Instagram**.
3. Complete Instagram Business Login using an Instagram Professional test account permitted for this review.
4. Approve `instagram_business_basic` and `instagram_business_manage_messages`.
5. Confirm Instagram redirects to Ishikeit's callback and the page reports successful authorization.
6. To test the live Ishi Nail Lab experience, send a new Instagram Direct Message such as `Hello` to the verified **@ishinaillab** business inbox from a separate Instagram account permitted to participate in the review.
7. Confirm the message reaches the Instagram conversation.
8. Confirm Ishikeit receives the `messages` webhook, processes the customer-support message, and sends a reply through the Instagram Messaging API.
9. Confirm the reply appears in the same Instagram conversation.

No Ishikeit login is required to open the reviewer page. Do not provide production secrets, database credentials, OAuth tokens, or operational bearer tokens to reviewers.

Production OAuth endpoints:

- Login: https://apps.ishinaillab.com/ishikeit/oauth/instagram/login/
- Callback: https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/
- Deauthorize: https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/
- Data deletion: https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/

## Screencast script

Record one uninterrupted English-language flow showing:

1. The public reviewer page and visible **Connect Instagram** button.
2. Clicking **Connect Instagram**.
3. Instagram's authorization UI.
4. The requested permissions being granted.
5. The redirect back to Ishikeit and the successful authorization message.
6. A separate Instagram user sending a new DM to the authorized business account.
7. The incoming message appearing in the business's Instagram inbox.
8. The automated Ishikeit reply appearing in the same conversation.

Use the real production app and real review/test accounts. Do not use mocked screenshots, fabricated provider responses, or edited success states.
## API-call evidence

Meta requires at least one successful API call for certain Advanced Access requests.

Ishikeit's production database contains successful published Instagram `message.send` actions for this Meta app, including a successful publish on **2026-10-01** and multiple earlier successful sends. These are durable outbox records, not simulated responses.

**Historical evidence only:** The OAuth routing path previously passed Meta tests. As of 2026-10-28, the separate stored OAuth tester credential is rejected by Graph account-resolution with HTTP 400, code 190, despite a future stored expiry. This is not a valid current authentication canary. The independently verified managed Instagram Professional token succeeds in webhook subscription reconciliation and matches the account ID in previously signed inbound customer messages. Do not delete or overwrite the OAuth credential merely to hide the warning; obtain an authorized fresh Business Login when that specific tester integration is needed.

The account-level `POST /me/subscribed_apps` reconciliation also succeeds for `messages`, `standby`, and `messaging_handover`.

## App settings checklist

Verified:

- App icon: present
- Privacy Policy URL: https://www.ishinaillab.com/privacy-policy
- Terms URL: https://www.ishinaillab.com/terms-conditions
- Data deletion URL: https://www.ishinaillab.com/meta-data-deletion
- Category: Messaging
- Business Verification: passes
- Base domains include `apps.ishinaillab.com` and `www.ishinaillab.com`

Attention before final submission:

- Meta currently reports the app contact email as present but not verified. This does not currently block `can_submit=true`, but the email should be verified before or during the final App Review checklist if Meta prompts for it.
- Request only `instagram_business_basic` and `instagram_business_manage_messages`. Do not add unrelated permissions.
- If Meta automatically adds the Human Agent feature, do not claim a 7-day human-agent use case unless Ishikeit actually implements and demonstrates it.

## Final submission gate

**Do not submit yet.** The October 28 runtime diagnosis identified Graph error 190 on the stored tester OAuth grant and an identity mismatch between the sole OAuth account alias and the account receiving Instagram customer DMs. First confirm that @ishinaillab is authorized through the reviewer's actual Instagram Business Login flow, that the account-level webhook subscription succeeds, and that a fresh tester-initiated DM gets a verified reply. The real Meta screencast must then demonstrate that exact working configuration.

Before clicking Submit:

- reviewer page is publicly reachable
- production OAuth login succeeds
- required scopes are present
- deauthorization and data-deletion callbacks are live
- account-level webhook subscription is active
- successful Instagram API-call history exists
- permission descriptions above are copied into the request
- reviewer verification instructions above are supplied
- the real end-to-end screencast is uploaded

Do not submit a mocked or incomplete recording. Do not reauthorize the production account merely to recreate routing aliases or webhook subscriptions; startup reconciliation is idempotent.

## Current review and production prerequisites (2026-10-28)

- Meta developer app ID `1042452472116584` remains **Live**; read-only App Review status is **NO_SUBMISSION**. The app's verified business and live webhook setup do not confer Advanced Access. A real uninterrupted review screencast, current permitted reviewer credentials/test account and app contact-email confirmation remain external prerequisites.
- Production evidence on 2026-10-28: the managed Instagram Professional token successfully reconciles its webhook subscription, and the account ID independently validated by that token matches a previously signed inbound Instagram customer-message account ID. A different stored OAuth credential with scopes `instagram_business_basic` and `instagram_business_manage_messages` fails Meta Graph `/me` / account resolution with numeric provider code **190**. Local expiry timestamps cannot override provider rejection. No authorization or consent was fabricated.
- Confirm any new tester reply with a fresh opted-in, tester-originated DM; never replay historical messages, retry closed-window sends or trigger a new customer message without an authorized test sender. Ensure Meta's Advanced Access permission review is complete before describing ordinary non-role customers as generally supported.
- Current engineering improvements in repository include signed webhook persistence, 24-hour standard reply policy, private human-handoff and Meta native ownership checks, per-message delivery correlation and provider-error privacy minimization. TikTok Business Messaging remains separately parked pending provider approval.
