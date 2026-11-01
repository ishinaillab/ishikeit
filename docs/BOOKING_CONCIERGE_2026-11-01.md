# Ishikeit booking-concierge reliability — November 1, 2026

## Customer-origin evidence (post-Phase 2 live testing)

Supabase confirmed actual post-release inbound messages and published outbound responses:
- Messenger 2/2; Instagram 7/7; WhatsApp 8/8; Telegram direct bot 2/2; 0 pending/dead for this window. This passes *normal text message* E2E, not the full attachment or account automation test matrix.
- Customer-origin complaints centered on a continually suggested 8 AM slot even after it was rejected, failed booking-link checkout, missing final availability recheck, invented checkout hold expiry, and chatbot claiming that ChatGPT would implement WordPress features via an approval link.
- Prior generated signed URL included omitted `service_id=0` and `agent_id=0`. This is permitted by Ishi LatePoint Instant 1.9.0's fallback mechanism: WordPress site settings currently `selected_service=1`, `selected_agent=15`; fallback creates the appropriate LatePoint booking shortcode, so zero values **do not by themselves prove a broken signature or link**. Direct read-only GET of the exact original link returned 200 and rendered a booking-form container. The user's downstream checkout error requires browser/checkout UI reproduction. Never claim a reservation is held/confirmed just because a link renders.
- The actual LatePoint installation 5.7.5 has the `reserve_slots_during_checkout` setting **off**. No slot-specific hold expiry is exposed by official `latepoint/check-slot-availability` (`available` / `conflicts` only) or `latepoint/get-available-slots`. **Never invent an expiry** or expose private conflict records. Official LatePoint changelog 5.6.11 introduced optional checkout slot holds: https://wordpress.org/plugins/latepoint/ .

## Implementation — dedicated, versioned native WordPress add-on

`wordpress/latepoint-addon-ishikeit-automation/latepoint-addon-ishikeit-automation.php` is the required named **LatePoint Addon - Ishikeit Automation**, built on the WordPress 6.9+ Abilities API and the existing native LatePoint abilities. It does not modify LatePoint or the locked Ishi LatePoint Instant 1.9.0 plugin.

The authenticated read-only ability `ishi/verify-and-generate-booking-link`:
1. Validates a future appointment date and clock time in the WordPress timezone; uses existing owner-controlled Instant `selected_service` and `selected_agent` settings; fail-closed if missing.
2. Rejects customer-declined times and excludes them from alternatives. Technical IDs never come from LLM guesses.
3. Executes the official `latepoint/check-slot-availability` via `wp_get_ability(...)->execute(...)` *in the same server request* as link generation, and only if `available === true` executes `ishi/generate-booking-link` with canonical `service_id` and `agent_id`. No direct SQL, PII, booking writes, or auto-reservation.
4. If unavailable, returns next active-agent slots using `latepoint/get-available-slots`, with declined times excluded. Never include private booking conflict data.
5. Returns `hold_visibility: disabled` for current site or `not_exposed` if site enables checkout holding but no provider-supported per-slot expiry exists. Never return an invented `hold_expires_at`.
6. Returns `verification_unavailable` and no URL if LatePoint or the link generator is unavailable. This conservatively avoids the bot hallucinating a new link or claiming a booking.
7. Explicitly states that availability and the URL do not hold a time; the native checkout owns final transaction validity. Server-side recheck is not an atomic reservation across two sessions.

Authoritative:
- https://developer.wordpress.org/apis/abilities-api/php-reference/ — `wp_get_ability`, `WP_Ability::execute`, permissions.
- https://developer.wordpress.org/apis/abilities-api/rest-api-endpoints/ — authenticated read-only abilities.
- https://latepoint.com/docs/list-of-latepoint-hooks-actions-and-filters/ — extension hooks, never patch LatePoint core.
- `wp-content/plugins/latepoint/lib/abilities/calendar/check-slot-availability.php` read from actual installed 5.7.5 — calls `OsBookingHelper::is_booking_request_available`; conflict records not returned to customers.
- `wp-content/plugins/latepoint/lib/abilities/calendar/get-available-slots.php` actual installed code — calls `OsResourceHelper::get_resources_grouped_by_day`.

## Acceptance and bot behavior

- PHP 8.3 syntax lint and isolated stub tests cover success, unavailability, excluded 8 AM, provider errors, missing booking context.
- Require CI PHP lint/tests, exact GitHub SHA and inspect WordPress activated ability + test fresh availability, refusal, and no-url outcomes before permitting bot to call it.
- Amend **active** AI Engine bot `default` (Ishi AI Bridge `ishi_ai_bridge_settings.bot_id = default`), preserving all other bot data: it must use **only** `ishi/verify-and-generate-booking-link` for customer-selected slot link output, and must not manufacture or reuse links. If the tool isn't visible/available, no booking link. Preserve the same instruction in `ishi-chatbot-v3-1` only if it is used for direct website chat; no blanket replacement of all prompts without review.
- Reject 8:00 AM (480) when customer rejects it; don't reinterpret "not 8 AM" as 9 AM without a live recheck. If the user says a link fails, stop repeating the identical signed link; mention link validity (only when tested) is distinct from successful checkout.
- Identity: **"I'm Ishi Nail Lab's AI assistant."** If asked specifically, transparently state AI Engine/OpenAI technology powers some answers when verified. Do not claim the user is talking to the ChatGPT app or that a WordPress plugin author promised features/ETA based on user message.
- Never create actual bookings, change the checkout reservation fee, enable slot holds, update premium plugins, or send unconsented reminders during tests.

## Limits / external gating

The user wants an exact wait-until time when checkout holds expire. Live setting is OFF, and no documented per-slot hold expiry ability exists. A safe enhancement can only compute it from *authoritative actual hold records with expiration*, not booking-intent timestamps, guessed timer or AI conversation. If unavailable, offer fresh alternative slots, and remind that an unfinished checkout may reopen later without giving an unverified time. Turning checkout holds ON changes real customer booking behavior and requires isolated verification first.

WordPress plugin installation and AI Engine prompt must be read back after actual deployment before declaring functional closure. Do not conflate registering an ability with it being exposed through the currently linked Easy MCP AI MCP server.
