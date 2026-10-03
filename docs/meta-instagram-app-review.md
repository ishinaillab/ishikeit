# Meta Instagram App Review package

Updated: 2026-10-03

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
- Production app SHA: `ce25903aa21ff0fa23c6eacaa0971499c1a7c231`
- Production health: ready
- Authorized Instagram Professional account: **@povnailstudio.ph**
- Professional account ID: `17841437646366614`
- OAuth credential: encrypted at rest and approximately 60-day lifetime
- Required scopes are present
- Account-level webhook subscription is reconciled for `messages`, `standby`, and `messaging_handover`
- Instagram routing is OAuth-only whenever the OAuth provider is configured; the retired static token is not used as fallback

Public reviewer entry point:

https://www.ishinaillab.com/instagram-connect-review/
## Why Advanced Access is required

Meta's current Instagram Messaging documentation states that apps with Standard Access can only interact with people who have a role on the app. Ishikeit's production users are ordinary Instagram customers who send Direct Messages to the business and do not have app roles.

Advanced Access is therefore required so Ishikeit can receive and respond to customer-initiated Instagram messages from non-role users in production.

This is not for unsolicited outreach. The customer starts the conversation. Ishikeit receives the webhook, processes the message as customer support, and replies inside Meta's allowed messaging context.

Official references:

- https://developers.facebook.com/documentation/instagram-platform/app-review
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/docs/instagram-platform/overview/
- https://developers.facebook.com/docs/instagram-platform/self-messaging/
- https://developers.facebook.com/documentation/development/create-an-app/other-app-types/instagram-apis

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
6. To test the live Ishi Nail Lab experience, send a new Instagram Direct Message such as `Hello` to **@povnailstudio.ph** from a separate Instagram account permitted to participate in the review.
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

The current OAuth routing path has also been verified against Meta with the newly authorized Professional account: Meta accepted the OAuth token and Professional-account routing identity. A canary to an existing first-party conversation was rejected only because that conversation was outside the 24-hour response window, which confirms routing/authentication were accepted.

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

The technical integration is ready for App Review. The remaining review artifact is the real screencast required by Meta's dashboard.

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
