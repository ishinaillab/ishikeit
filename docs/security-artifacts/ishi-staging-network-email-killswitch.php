<?php
/**
 * Plugin Name: Ishi Staging Network And Email Kill Switch
 * Version: 1.0.0
 * Description: Prevents WordPress HTTP API, wp_mail, and WP-Cron outbound side effects during protected security-staging restoration.
 */
defined('ABSPATH') || exit;
if (!defined('WP_ENVIRONMENT_TYPE') || WP_ENVIRONMENT_TYPE !== 'staging') {
    return;
}
add_filter('pre_http_request', static function () {
    return new WP_Error('ishi_stage_network_disabled', 'External requests are blocked in confidential staging.');
}, PHP_INT_MAX, 3);
add_filter('pre_wp_mail', static function () { return true; }, PHP_INT_MAX);
add_filter('pre_schedule_event', static function () { return false; }, PHP_INT_MAX);
add_filter('pre_reschedule_event', static function () { return false; }, PHP_INT_MAX);
add_filter('allow_password_reset', '__return_false', PHP_INT_MAX);
