<?php
/**
 * Plugin Name: LatePoint Addon - Ishikeit Automation
 * Description: Server-verified, non-reserving LatePoint booking links for Ishi Nail Lab's AI concierge.
 * Version: 0.1.2
 * Requires at least: 6.9
 * Requires PHP: 8.1
 * Requires Plugins: latepoint, ishi-latepoint-instant
 * Author: Ishi Nail Lab
 * License: GPL-2.0-or-later
 */
defined( 'ABSPATH' ) || exit;

final class Ishi_LatePoint_Automation {
    private const ABILITY = 'ishi/verify-and-generate-booking-link';
    private const SETTINGS_OPTION = 'ishi_latepoint_instant_settings';

    public static function boot(): void {
        add_action( 'wp_abilities_api_init', [ __CLASS__, 'register_ability' ], 30 );
    }

    private static function failure( string $code, string $message ): WP_Error {
        return new WP_Error( $code, $message );
    }

    /** Derive the canonical technical service and staff from the existing, owner-managed Instant settings. */
    private static function booking_context(): array|WP_Error {
        $settings = get_option( self::SETTINGS_OPTION, [] );
        if ( ! is_array( $settings ) ) {
            return self::failure( 'ishi_booking_settings_missing', 'Booking settings are unavailable.' );
        }
        $service = isset( $settings['selected_service'] ) && ctype_digit( (string) $settings['selected_service'] )
            ? (int) $settings['selected_service'] : 0;
        $agent = isset( $settings['selected_agent'] ) && ctype_digit( (string) $settings['selected_agent'] )
            ? (int) $settings['selected_agent'] : 0;
        if ( $service < 1 || $agent < 1 ) {
            return self::failure( 'ishi_booking_context_missing', 'The public booking service or agent is not configured.' );
        }
        return [ 'service_id' => $service, 'agent_id' => $agent ];
    }

    public static function register_ability(): void {
        if ( ! function_exists( 'wp_register_ability' ) ) {
            return;
        }
        wp_register_ability( self::ABILITY, [
            'label' => 'Verify a specific appointment and generate its booking link',
            'description' => 'Use this as the LAST step for a customer-selected exact appointment time. In one server-side operation, LatePoint rechecks the date, time, service and assigned agent, then generates a customer-facing link only when still available. Never use older availability or previously generated links as proof. If unavailable, return current alternatives without a link. This tool never holds, reserves, or pays for an appointment and never invents a temporary-hold expiry. A customer who rejected 8:00 AM must choose a different time; supply rejected times under excluded_start_times. For relative dates such as tomorrow, supply day_offset=1 alongside the Manila calendar date; any disagreement fails closed. Do not manually construct links.',
            'category' => 'ishi-booking',
            'input_schema' => [
                'type' => 'object',
                'additionalProperties' => false,
                'properties' => [
                    'date' => [ 'type' => 'string', 'format' => 'date', 'description' => 'Requested date in Asia/Manila, YYYY-MM-DD.' ],
                    'start_time' => [ 'type' => 'integer', 'minimum' => 0, 'maximum' => 1439, 'description' => 'Customer-selected time in minutes after midnight (8 AM = 480; 9 AM = 540).' ],
                    'excluded_start_times' => [ 'type' => 'array', 'items' => [ 'type' => 'integer', 'minimum' => 0, 'maximum' => 1439 ], 'maxItems' => 12, 'description' => 'Times this customer declined; never return those times as booking links or alternatives.' ],
                    'day_offset' => [ 'type' => 'integer', 'minimum' => 0, 'maximum' => 30, 'description' => 'Set 0 for today or 1 for tomorrow, computed in the studio timezone. A mismatched absolute date fails closed with no URL.' ],
                ],
                'required' => [ 'date', 'start_time' ],
            ],
            'output_schema' => [
                'type' => 'object',
                'additionalProperties' => false,
                'properties' => [
                    'bookable' => [ 'type' => 'boolean' ],
                    'status' => [ 'type' => 'string', 'enum' => [ 'available', 'unavailable', 'declined', 'verification_unavailable' ] ],
                    'url' => [ 'type' => 'string', 'format' => 'uri' ],
                    'date' => [ 'type' => 'string', 'format' => 'date' ],
                    'start_time' => [ 'type' => 'integer' ],
                    'alternatives' => [ 'type' => 'array', 'items' => [ 'type' => 'integer' ] ],
                    'hold_expires_at' => [ 'type' => 'string', 'description' => 'Never present unless provided by verified LatePoint slot-specific hold API; not currently available.' ],
                    'hold_visibility' => [ 'type' => 'string', 'enum' => [ 'disabled', 'not_exposed' ] ],
                    'message' => [ 'type' => 'string' ],
                ],
                'required' => [ 'bookable', 'status', 'date', 'start_time', 'alternatives', 'hold_visibility', 'message' ],
            ],
            'execute_callback' => [ __CLASS__, 'execute' ],
            'permission_callback' => [ __CLASS__, 'can_execute' ],
            'meta' => [
                'annotations' => [ 'readonly' => true, 'destructive' => false, 'idempotent' => true ],
                // WordPress 6.9+ uses public as the client/MCP visibility
                // default; permission_callback still enforces login.
                'public' => true,
                'show_in_rest' => true,
            ],
        ] );
    }

    public static function can_execute( $input = null ): bool {
        return is_user_logged_in() && current_user_can( 'read' );
    }

    private static function run_native( string $ability_name, array $args ): array|WP_Error {
        if ( ! function_exists( 'wp_get_ability' ) ) {
            return self::failure( 'ishi_booking_abilities_unavailable', 'The WordPress Abilities API is unavailable.' );
        }
        $ability = wp_get_ability( $ability_name );
        if ( ! $ability || ! method_exists( $ability, 'execute' ) ) {
            return self::failure( 'ishi_booking_ability_missing', 'A required LatePoint booking ability is unavailable.' );
        }
        $result = $ability->execute( $args );
        if ( is_wp_error( $result ) || ! is_array( $result ) ) {
            return self::failure( 'ishi_booking_ability_failed', 'The booking system could not verify this appointment.' );
        }
        return $result;
    }

    private static function is_future_time( string $date, int $minute ): bool {
        $zone = wp_timezone();
        $candidate = DateTimeImmutable::createFromFormat(
            '!Y-m-d H:i', sprintf( '%s %02d:%02d', $date, intdiv( $minute, 60 ), $minute % 60 ), $zone
        );
        return $candidate instanceof DateTimeImmutable
            && $candidate->format( 'Y-m-d' ) === $date
            && $candidate > new DateTimeImmutable( 'now', $zone );
    }

    private static function public_result( bool $available, string $status, string $date, int $minute, array $alternatives, string $hold_visibility, string $message ): array {
        return [
            'bookable' => $available,
            'status' => $status,
            'date' => $date,
            'start_time' => $minute,
            'alternatives' => $alternatives,
            'hold_visibility' => $hold_visibility,
            'message' => $message,
        ];
    }

    private static function alternative_times( array $context, string $date, array $excluded, int $original ): array {
        $data = self::run_native( 'latepoint/get-available-slots', $context + [ 'date' => $date ] );
        if ( is_wp_error( $data ) || ! isset( $data['slots'] ) || ! is_array( $data['slots'] ) ) return [];
        $times = [];
        foreach ( $data['slots'] as $candidate ) {
            if ( ! is_array( $candidate ) ) continue;
            $m = $candidate['start_time'] ?? null;
            if ( ! is_int( $m ) || $m === $original || in_array( $m, $excluded, true ) || ! self::is_future_time( $date, $m ) ) continue;
            if ( isset( $candidate['agent_id'] ) && (int) $candidate['agent_id'] !== $context['agent_id'] ) continue;
            $times[$m] = $m;
        }
        sort( $times, SORT_NUMERIC );
        return array_slice( $times, 0, 5 );
    }

    public static function execute( $input ): array|WP_Error {
        if ( ! is_array( $input ) ) return self::failure( 'ishi_booking_invalid_input', 'Expected a booking request object.' );
        $date = $input['date'] ?? null;
        $time = $input['start_time'] ?? null;
        if ( ! is_string( $date ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $date )
            || ! is_int( $time ) || $time < 0 || $time > 1439 ) {
            return self::failure( 'ishi_booking_invalid_slot', 'Specify a valid date and a start time in minutes after midnight.' );
        }
        $excluded = $input['excluded_start_times'] ?? [];
        if ( ! is_array( $excluded ) || count( $excluded ) > 12 ) {
            return self::failure( 'ishi_booking_invalid_exclusions', 'Invalid list of declined times.' );
        }
        foreach ( $excluded as $m ) {
            if ( ! is_int( $m ) || $m < 0 || $m > 1439 ) {
                return self::failure( 'ishi_booking_invalid_exclusions', 'Declined times must be valid minute values.' );
            }
        }
        $context = self::booking_context();
        if ( is_wp_error( $context ) ) return $context;
        $hold_enabled = class_exists( 'OsSettingsHelper' )
            && method_exists( 'OsSettingsHelper', 'is_on' )
            && OsSettingsHelper::is_on( 'reserve_slots_during_checkout' );
        $hold_visibility = $hold_enabled ? 'not_exposed' : 'disabled';

        // An actual customer requested "tomorrow" just after midnight Manila,
        // but the model sent yesterday's absolute date and a valid signed URL.
        // Reconcile relative dates with the trusted site timezone before ANY
        // LatePoint availability or URL operation; fail closed on disagreement.
        if ( array_key_exists( 'day_offset', $input ) ) {
            $offset = $input['day_offset'];
            if ( ! is_int( $offset ) || $offset < 0 || $offset > 30 ) {
                return self::failure( 'ishi_booking_invalid_relative_day', 'Relative day must be 0-30 in the studio timezone.' );
            }
            $expected_date = ( new DateTimeImmutable( 'now', wp_timezone() ) )
                ->setTime( 0, 0 )->modify( '+' . $offset . ' days' )->format( 'Y-m-d' );
            if ( $date !== $expected_date ) {
                return self::public_result( false, 'verification_unavailable', $date, $time, [], $hold_visibility,
                    'The requested date does not match the studio local date for that relative day. No booking link was generated; check the Manila date again.' );
            }
        }

        if ( ! self::is_future_time( $date, $time ) ) {
            return self::public_result( false, 'unavailable', $date, $time, [], $hold_visibility, 'This appointment time is in the past.' );
        }
        if ( in_array( $time, $excluded, true ) ) {
            return self::public_result(
                false, 'declined', $date, $time, self::alternative_times( $context, $date, $excluded, $time ),
                $hold_visibility, 'The customer rejected this time. Never send a booking link for it.'
            );
        }

        // Native LatePoint revalidation, in the SAME server request as the URL
        // generation. This is NOT a transaction/hold; LatePoint still owns checkout.
        $args = $context + [ 'date' => $date, 'start_time' => $time ];
        $check = self::run_native( 'latepoint/check-slot-availability', $args );
        if ( is_wp_error( $check ) || ! isset( $check['available'] ) || ! is_bool( $check['available'] ) ) {
            return self::public_result( false, 'verification_unavailable', $date, $time, [], $hold_visibility, 'Live availability could not be verified. No link was generated.' );
        }
        if ( $check['available'] !== true ) {
            return self::public_result(
                false, 'unavailable', $date, $time, self::alternative_times( $context, $date, $excluded, $time ),
                $hold_visibility, 'This time is not currently bookable. Offer fresh alternatives. Do not promise a hold release time.'
            );
        }
        $link = self::run_native( 'ishi/generate-booking-link', [
            'date' => $date,
            'start_time' => sprintf( '%02d:%02d', intdiv( $time, 60 ), $time % 60 ),
            'service_id' => $context['service_id'],
            'agent_id' => $context['agent_id'],
        ] );
        if ( is_wp_error( $link ) || empty( $link['url'] ) || ! is_string( $link['url'] )
            || strlen( $link['url'] ) > 2048 || wp_parse_url( $link['url'], PHP_URL_SCHEME ) !== 'https'
            || ! wp_parse_url( $link['url'], PHP_URL_HOST ) ) {
            return self::public_result( false, 'verification_unavailable', $date, $time, [], $hold_visibility, 'The booking link could not be generated. No reservation has been made.' );
        }
        $result = self::public_result( true, 'available', $date, $time, [], $hold_visibility,
            'Available at the time of verification only. The URL does not hold or confirm a reservation. Complete the native LatePoint checkout.' );
        $result['url'] = $link['url'];
        return $result;
    }
}
Ishi_LatePoint_Automation::boot();
