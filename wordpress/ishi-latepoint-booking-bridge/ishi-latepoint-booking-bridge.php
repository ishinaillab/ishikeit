<?php
/**
 * Plugin Name: Ishi LatePoint Booking Bridge
 * Description: Signed, PII-free LatePoint booking lifecycle events for Ishikeit. Never sends customer notifications.
 * Version: 0.2.0
 * Requires PHP: 8.1
 * Author: Ishi Nail Lab
 * License: GPL-2.0-or-later
 *
 * Private ECDSA P-256 key is generated ONLY in WordPress and stored outside
 * the public_html document root with owner-only filesystem permissions.
 * It is never sent to Ishikeit, its logs, a connector, or source control.
 * Activation generates the key but DOES NOT enable event delivery.
 * To enable: update the protected WordPress option
 * ishi_latepoint_bridge_enabled to the literal string "1".
 */
defined('ABSPATH') || exit;

if (!class_exists('Ishi_LatePoint_Booking_Bridge', false)) {
    final class Ishi_LatePoint_Booking_Bridge {
        private const DISPATCH_HOOK = 'ishi_latepoint_booking_bridge_dispatch';
        private const ENDPOINT = 'https://apps.ishinaillab.com/ishikeit/webhooks/latepoint';
        private const RETRY_DELAYS = [60, 300, 900, 3600];
        private const STATUS_OPTION = 'ishi_latepoint_bridge_key_status_v1';
        private const PUBLIC_OPTION = 'ishi_latepoint_bridge_public_key_v1';
        private const ENABLED_OPTION = 'ishi_latepoint_bridge_enabled';

        public static function init(): void {
            add_action('latepoint_booking_created', [self::class, 'created'], 20, 1);
            add_action('latepoint_booking_updated', [self::class, 'updated'], 20, 2);
            add_action('latepoint_booking_deleted', [self::class, 'deleted'], 20, 1);
            add_action(self::DISPATCH_HOOK, [self::class, 'dispatch'], 10, 2);
            register_activation_hook(__FILE__, [self::class, 'provision_signing_key']);
        }

        private static function private_key_path(): ?string {
            $webroot = realpath(ABSPATH);
            $domain_dir = realpath(dirname(rtrim(ABSPATH, '/\\')));
            if (!is_string($webroot) || !is_string($domain_dir)
                || strpos($webroot, $domain_dir . DIRECTORY_SEPARATOR) !== 0) {
                return null;
            }
            $path = $domain_dir . '/.ishi-latepoint-bridge-p256.pem';
            // Never follow an unexpected symlink in the parent directory.
            return is_link($path) ? null : $path;
        }

        /**
         * Idempotent private-key provisioning. Fail closed on missing crypto,
         * filesystem limitations, key mismatch or any ambiguous existing file.
         * Never rotate a key implicitly.
         */
        public static function provision_signing_key(): void {
            if (wp_parse_url(home_url('/'), PHP_URL_HOST) !== 'www.ishinaillab.com') {
                update_option(self::STATUS_OPTION, 'wrong_host', false);
                return;
            }
            if (!function_exists('openssl_pkey_new')
                || !defined('OPENSSL_KEYTYPE_EC')
                || !function_exists('openssl_sign')) {
                update_option(self::STATUS_OPTION, 'crypto_unavailable', false);
                return;
            }
            $path = self::private_key_path();
            if ($path === null) {
                update_option(self::STATUS_OPTION, 'private_path_unavailable', false);
                return;
            }
            $public = get_option(self::PUBLIC_OPTION, '');
            if (is_string($public) && $public !== '') {
                $existing = @file_get_contents($path);
                $pkey = is_string($existing) ? @openssl_pkey_get_private($existing) : false;
                $details = $pkey === false ? false : openssl_pkey_get_details($pkey);
                update_option(
                    self::STATUS_OPTION,
                    is_array($details) && isset($details['key']) && trim($details['key']) === trim($public)
                        ? 'ready' : 'key_mismatch_or_missing',
                    false
                );
                return;
            }
            // A pre-existing file without its public-key record is ambiguous.
            if (file_exists($path)) {
                update_option(self::STATUS_OPTION, 'unpaired_existing_key', false);
                return;
            }
            $pair = openssl_pkey_new([
                'private_key_type' => OPENSSL_KEYTYPE_EC,
                'curve_name' => 'prime256v1'
            ]);
            $private = '';
            if ($pair === false || !openssl_pkey_export($pair, $private)) {
                update_option(self::STATUS_OPTION, 'key_generation_failed', false);
                return;
            }
            $details = openssl_pkey_get_details($pair);
            if (!is_array($details) || !isset($details['key'])
                || !is_string($details['key'])) {
                update_option(self::STATUS_OPTION, 'public_export_failed', false);
                return;
            }
            // Create exclusively with umask 077 to avoid any world-readable
            // interval. File stays outside the web-served document root.
            $prior_umask = umask(0077);
            $handle = @fopen($path, 'x');
            umask($prior_umask);
            if ($handle === false) {
                update_option(self::STATUS_OPTION, 'private_write_denied', false);
                return;
            }
            $written = fwrite($handle, $private);
            fflush($handle);
            fclose($handle);
            @chmod($path, 0600);
            if ($written !== strlen($private)) {
                // Never publish the public key if its private counterpart
                // was not written completely.
                update_option(self::STATUS_OPTION, 'private_write_incomplete', false);
                return;
            }
            add_option(self::PUBLIC_OPTION, trim($details['key']), '', false);
            update_option(self::STATUS_OPTION, 'ready', false);
        }

        private static function private_signing_key() {
            $path = self::private_key_path();
            if ($path === null || !is_file($path) || is_link($path)) return false;
            $pem = @file_get_contents($path);
            if (!is_string($pem)) return false;
            $key = @openssl_pkey_get_private($pem);
            if ($key === false) return false;
            $details = openssl_pkey_get_details($key);
            $expected = get_option(self::PUBLIC_OPTION, '');
            if (!is_array($details) || !isset($details['key']) || !is_string($expected)
                || $expected === '' || trim($details['key']) !== trim($expected)) return false;
            return $key;
        }

        private static function configured(): bool {
            return get_option(self::ENABLED_OPTION, '0') === '1'
                && get_option(self::STATUS_OPTION, 'not_provisioned') === 'ready'
                && wp_parse_url(home_url('/'), PHP_URL_HOST) === 'www.ishinaillab.com'
                && self::private_signing_key() !== false;
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
                || !is_scalar($booking->id)) return;
            $id = (string) $booking->id;
            if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id)) return;
            $status = isset($booking->status) && is_string($booking->status)
                ? $booking->status : '';
            if (!in_array($status, ['approved', 'pending', 'cancelled', 'no_show', 'completed'], true)) {
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
                || $attempt < 0 || $attempt > count(self::RETRY_DELAYS)) return;
            $body = wp_json_encode($payload);
            if (!is_string($body) || strlen($body) > 4096) return;
            $timestamp = (string) time();
            $private = self::private_signing_key();
            if ($private === false) return;
            $signature = '';
            if (!openssl_sign(
                "ishi-latepoint-booking-v2\n" . $timestamp . "\n" . $body,
                $signature,
                $private,
                OPENSSL_ALGO_SHA256
            )) return;
            $encoded = rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
            $result = wp_remote_post(self::ENDPOINT, [
                'timeout' => 4,
                'redirection' => 0,
                'sslverify' => true,
                'blocking' => true,
                'headers' => [
                    'Content-Type' => 'application/json',
                    'X-Ishi-Latepoint-Timestamp' => $timestamp,
                    'X-Ishi-Latepoint-Signature-P256' => $encoded
                ],
                'body' => $body
            ]);
            $http_status = is_wp_error($result)
                ? 0 : (int) wp_remote_retrieve_response_code($result);
            if ($http_status >= 200 && $http_status < 300) return;
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
