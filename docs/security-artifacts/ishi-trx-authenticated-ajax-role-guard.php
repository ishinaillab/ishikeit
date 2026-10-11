<?php
/**
 * Plugin Name: Ishi ThemeREX Authenticated AJAX Role Boundary
 * Description: Denies ThemeREX administrative AJAX to users without theme-management rights, while retaining expressly registered public widget AJAX routes.
 * Version: 1.0.1
 * Author: Ishi Nail Lab
 *
 * A defense-in-depth containment measure. Not an official ThemeREX vendor fix.
 */
defined('ABSPATH') || exit;
if (!function_exists('ishi_trx_ajax_needs_theme_manager')) {
    function ishi_trx_ajax_needs_theme_manager($action) {
        if (!is_string($action) || !preg_match('/\\Atrx_addons_[a-zA-Z0-9_]{1,120}\\z/D', $action)) {
            return false;
        }
        // Public widget/cart AJAX can register with priority 0, which has_action()
        // returns as integer 0. Only strict false means that no public handler exists.
        return has_action('wp_ajax_nopriv_' . $action) === false;
    }
}
add_action('admin_init', static function () {
    if (!wp_doing_ajax()) {
        return;
    }
    $action = isset($_REQUEST['action']) ? $_REQUEST['action'] : null;
    if (!ishi_trx_ajax_needs_theme_manager($action)) {
        return;
    }
    if (current_user_can('edit_theme_options')) {
        return;
    }
    wp_send_json_error(array('code' => 'ishi_trx_admin_ajax_role_required'), 403);
}, -10000);
