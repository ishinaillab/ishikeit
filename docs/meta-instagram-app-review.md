# Meta Instagram App Review package

Updated: 2026-10-02

## Scope

Ishikeit uses **Instagram API with Instagram Login** and requests only:

- `instagram_business_basic`
- `instagram_business_manage_messages`

The production use case is customer support for an Instagram Professional account. Customers send Instagram DMs to the business. Ishikeit receives the messaging webhook, persists the event durably, sends the message to the configured AI service, creates a durable outbound action, and replies through the Instagram Messaging API.

## Why Advanced Access is required

Meta distinguishes the Instagram Professional account being onboarded from the people whose data is delivered in messaging webhooks.

The Ishi Instagram Professional account is owned/managed by the business, but ordinary customers who send DMs do not have app roles. Meta's current Instagram Messaging webhook guidance states that webhook notifications containing data owned or managed by people without an app role require App Review / Advanced Access. Standard Access remains role-limited for those webhook notifications.

Official references:

- https://developers.facebook.com/documentation/instagram-platform/app-review
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api
- https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks

## Current verified app state

As of 2026-10-02:

- Business Verification: passes
- App Review: `NO_SUBMISSION`
- `can_submit=true`
- Advanced Access grants: none
- compliance: clean
- required compliance actions: none
- open violations: none

The OAuth lifecycle code is deployed but configuration-gated until the product-specific Instagram App ID and Instagram App Secret are supplied securely.
## Permission justification copy

### `instagram_business_basic`

Ishikeit uses `instagram_business_basic` to authenticate an Instagram Professional account through Business Login for Instagram, obtain the Instagram-scoped account ID returned by Meta, and bind the authorized professional account to its encrypted server-side credential. This account identity is required so Ishikeit can route messaging events and outbound replies to the correct authorized Instagram Professional account.

The app does not use this permission for unrelated profile harvesting, advertising, or public-content collection.

### `instagram_business_manage_messages`

Ishikeit uses `instagram_business_manage_messages` to receive Instagram Direct messaging webhook events for the authorized Instagram Professional account and to send replies to the customer who initiated the conversation.

The functionality is a customer-support messaging workflow. A customer initiates the conversation by messaging the business on Instagram. Ishikeit receives that event, processes it, and sends a reply through the authorized professional account using the Instagram Messaging API.

The app does not initiate unsolicited conversations.

## External reviewer entry point

The production login route is:

`https://apps.ishinaillab.com/ishikeit/oauth/instagram/login/`

This route is intentionally unavailable until the product-specific Instagram OAuth configuration is activated. After activation it creates a one-time CSRF state and redirects the reviewer to Meta's Instagram authorization flow.

The exact registered callback must be:

`https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/`

Business Login must also register:

- Deauthorize callback URL: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/`
- Data deletion request URL: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/`

The production login route uses Meta's current Business Login endpoint, `https://www.instagram.com/oauth/authorize`, includes one-time CSRF `state`, and sends `force_reauth=true` as recommended for Business Login.

Before submission, expose a clearly visible **Connect Instagram** link/button on a public reviewer-accessible web page. The link must launch the production login route above and must be visible in the submitted screencast.
## Reviewer verification instructions

Use a controlled Instagram Professional account that Meta reviewers are permitted to authorize for this submission.

1. Open the public reviewer-accessible page containing the **Connect Instagram** link.
2. Click **Connect Instagram**. The link opens the production Ishikeit Instagram login route and redirects to Instagram's authorization window.
3. Sign in to the Instagram Professional account supplied for review and approve the requested permissions.
4. Confirm that Instagram redirects to the exact Ishikeit callback and that the page reports successful authorization.
5. From a separate Instagram user account, send a new direct message to the authorized Instagram Professional account.
6. Confirm that the message arrives in Instagram and is delivered to Ishikeit's webhook.
7. Confirm that Ishikeit processes the message and sends a reply.
8. Confirm that the reply is visible in the Instagram conversation.

Do not provide production secrets, database credentials, API tokens, or operational bearer tokens to the reviewer. Provide only reviewer/test account credentials if Meta's review form requires them.

## Screencast requirements

Record one uninterrupted end-to-end flow that visibly demonstrates:

1. the public web page with the visible **Connect Instagram** link
2. clicking the link
3. Instagram's authorization screen
4. the requested permissions being granted
5. the redirect back to Ishikeit and successful authorization result
6. a customer account sending a DM to the authorized professional account
7. the incoming DM appearing in the professional account's Instagram inbox
8. Ishikeit handling the event
9. the API-generated reply appearing in the same Instagram conversation

Do not use mocked screenshots, fabricated provider responses, edited success states, or synthetic reviewer evidence.

## API-call evidence

Meta's App Review guidance notes that certain Advanced Access requests require at least one successful API call.

Ishikeit's production database already contains successful Instagram `message.send` actions with Meta provider message IDs, including a successful send recorded on 2026-10-01. This can support the API-call requirement, but the submitted screencast must still demonstrate the current authorization and messaging flow actually used for review.
## Meta Dashboard completion checklist

Before starting the submission:

- Instagram > API setup with Instagram login > Business login settings:
  - copy the product-specific **Instagram App ID**
  - copy the product-specific **Instagram App Secret**
  - register the exact OAuth redirect URI shown above
  - register the exact deauthorize callback URL shown above
  - register the exact data deletion request URL shown above
  - confirm the generated Business Login / Embed URL uses the intended permissions
- App settings:
  - app icon: present
  - Privacy Policy URL: present and publicly reachable
  - app category: present
  - business email: present
- App Review:
  - request `instagram_business_basic`
  - request `instagram_business_manage_messages`
  - confirm external testability
  - provide the reviewer instructions above
  - provide reviewer credentials only when genuinely needed
  - upload the real end-to-end screencast
  - verify at least one successful API call requirement is satisfied
- Do not add unrelated permissions merely because Meta offers them.

## Activation gate

The secure local handoff is:

`C:\Users\MBDS\Downloads\ishikeit-instagram-app.env`

The Hostinger promotion helper is:

`C:\Users\MBDS\Downloads\hostinger-mcp-client\activate_instagram_oauth_env.mjs`

The helper must not run until the product App ID and App Secret placeholders have been replaced with the real Instagram product values. It validates the values, preserves the existing production environment, adds the Instagram OAuth keys, verifies the resulting live key set, and requests a restart without printing secrets.

After activation, verify all of the following before recording any screencast:

- `GET /health/ready` returns 200
- `GET /ishikeit/oauth/instagram/login/` redirects to `www.instagram.com/oauth/authorize` with `force_reauth=true`
- the redirect contains the configured Instagram product App ID
- the redirect URI exactly matches the registered callback including trailing slash
- requested scopes are exactly `instagram_business_basic,instagram_business_manage_messages`
- callback state can be consumed only once
- protected OAuth status returns account/scope/expiry metadata without tokens
- existing Ishi production messaging remains operational
- a controlled authorized-account customer DM is ingested and receives a successful reply
