<?php
/**
 * Plugin Name: Ishi LatePoint Booking Bridge
 * Description: Optional, PII-free and independently signed LatePoint booking lifecycle events for Ishikeit. No notifications.
 * Version: 0.1.0
 * Requires PHP: 8.1
 * Author: Ishi Nail Lab
 * License: GPL-2.0-or-later
 *
 * Disabled by default. Never edit LatePoint or its premium add-ons.
 * Configuration belongs in wp-config.php or host-managed PHP environment:
 *   define('ISHI_LATEPOINT_BRIDGE_ENABLED', true);
 *   define('ISHI_LATEPOINT_BRIDGE_SECRET', '<unique-random-32+-byte-secret>');
 *
 * Match the key with the Ishikeit Node environment variable
 * LATEPOINT_BOOKING_WEBHOOK_SECRET. Do not publish it in source control.
 */
defined('ABSPATH') || exit;

if (!class_exists('Ishi_LatePoint_Booking_Bridge', false)) {
    final class Ishi_LatePoint_Booking_Bridge {
        private const DISPATCH_HOOK = 'ishi_latepoint_booking_bridge_dispatch';
        private const ENDPOINT = 'https://apps.ishinaillab.com/ishikeit/webhooks/latepoint';
        private const RETRY_DELAYS = [60, 300, 900, 3600];

        public static function init(): void {
            add_action('latepoint_booking_created', [self::class, 'created'], 20, 1);
            add_action('latepoint_booking_updated', [self::class, 'updated'], 20, 2);
            add_action('latepoint_booking_deleted', [self::class, 'deleted'], 20, 1);
            add_action(self::DISPATCH_HOOK, [self::class, 'dispatch'], 10, 2);
        }

        private static function configured(): bool {
            if (!defined('ISHI_LATEPOINT_BRIDGE_ENABLED')
                || ISHI_LATEPOINT_BRIDGE_ENABLED !== true
                || !defined('ISHI_LATEPOINT_BRIDGE_SECRET')
                || !is_string(ISHI_LATEPOINT_BRIDGE_SECRET)
                || strlen(ISHI_LATEPOINT_BRIDGE_SECRET) < 32) {
                return false;
            }
            // Suppress staging and accidental cross-site activation.
            return wp_parse_url(home_url('/'), PHP_URL_HOST) === 'www.ishinaillab.com';
        }

        private static function occurrence_time(): string {
            return (new DateTimeImmutable('now', new DateTimeZone('UTC')))
                ->format('Y-m-d\TH:i:s.u\Z');
        }

        private static function normalized_start($booking): ?string {
            if (!is_object($booking) || !isset($booking->start_datetime_utc)
                || !is_string($booking->start_datetime_utc)) {
                return null;
            }
            $raw = $booking->start_datetime_utc;
            if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/D', $raw)) {
                return null;
            }
            $value = DateTimeImmutable::createFromFormat(
                '!Y-m-d H:i:s', $raw, new DateTimeZone('UTC')
            );
            if ($value === false || $value->format('Y-m-d H:i:s') !== $raw) {
                return null;
            }
            return $value->format('Y-m-d\TH:i:s\Z');
        }

        private static function schedule_change($booking, string $change): void {
            if (!self::configured() || !is_object($booking) || !isset($booking->id)
                || !is_scalar($booking->id)) {
                return;
            }
            $id = (string) $booking->id;
            if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id)) {
                return;
            }
            $status = isset($booking->status) && is_string($booking->status)
                ? $booking->status : '';
            if (!in_array($status, ['approved', 'pending', 'cancelled', 'no_show', 'completed'], true)) {
                // Reject unknown or future plugin statuses. No notification is generated.
                return;
            }
            $start = self::normalized_start($booking);
            if ($start === null) return;

            self::queue([
                'schemaVersion' => 1,
                'source' => 'www.ishinaillab.com',
                'bookingId' => $id,
                'change' => $change,
                'status' => $status,
                'startsAt' => $start,
                'occurredAt' => self::occurrence_time()
            ]);
        }

        private static function queue(array $payload): void {
            // WP-Cron stores ONLY a booking ID, lifecycle status, timestamp and
            // no phone, customer name, email, notes, tokens or financial data.
            if (!function_exists('wp_schedule_single_event')) return;
            $arguments = [$payload, 0];
            if (!wp_next_scheduled(self::DISPATCH_HOOK, $arguments)) {
                wp_schedule_single_event(time() + 10, self::DISPATCH_HOOK, $arguments);
            }
        }

        public static function created($booking): void {
            self::schedule_change($booking, 'created');
        }

        public static function updated($booking, $old_booking = null): void {
            // The hook supplies both versions; never assume the old object is
            // available or trustworthy. Send only the current normalized state.
            self::schedule_change($booking, 'updated');
        }

        public static function deleted($booking_id): void {
            if (!self::configured() || !is_scalar($booking_id)) return;
            $id = (string) $booking_id;
            if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id)) return;
            self::queue([
                'schemaVersion' => 1,
                'source' => 'www.ishinaillab.com',
                'bookingId' => $id,
                'change' => 'deleted',
                'status' => 'deleted',
                'startsAt' => null,
                'occurredAt' => self::occurrence_time()
            ]);
        }

        public static function dispatch($payload, $attempt = 0): void {
            if (!self::configured() || !is_array($payload) || !is_int($attempt)
                || $attempt < 0 || $attempt > count(self::RETRY_DELAYS)) {
                return;
            }
            // Sign the exact UTF-8 request body, not JSON reconstructed by Node.
            $body = wp_json_encode($payload);
            if (!is_string($body) || strlen($body) > 4096) return;
            $timestamp = (string) time();
            $signature = 'sha256=' . hash_hmac(
                'sha256', $timestamp . '.' . $body, ISHI_LATEPOINT_BRIDGE_SECRET
            );
            $result = wp_remote_post(self::ENDPOINT, [
                'timeout' => 4,
                'redirection' => 0,
                'sslverify' => true,
                'blocking' => true,
                'headers' => [
                    'Content-Type' => 'application/json',
                    'X-Ishi-Latepoint-Timestamp' => $timestamp,
                    'X-Ishi-Latepoint-Signature-256' => $signature
                ],
                'body' => $body
            ]);
            $http_status = is_wp_error($result)
                ? 0 : (int) wp_remote_retrieve_response_code($result);
            if ($http_status >= 200 && $http_status < 300) return;
            // Never retry 400/401/403/404/422 misconfiguration or bad input;
            // keep this non-sending integration from creating a retry storm.
            if ($http_status >= 400 && $http_status < 500 && $http_status !== 429) return;
            if ($attempt >= count(self::RETRY_DELAYS)) return;
            wp_schedule_single_event(
                time() + self::RETRY_DELAYS[$attempt],
                self::DISPATCH_HOOK,
                [$payload, $attempt + 1]
            );
        }
    }

    Ishi_LatePoint_Booking_Bridge::init();
}
