<?php
/**
 * Plugin Name: Ishi ThemeREX Unused AI Surface Isolation
 * Description: Blocks the ThemeREX Addons AI generator endpoints and restricts importer/addon-management AJAX to site administrators while preserving storefront/layout widgets and Ishi messaging.
 * Version: 1.0.0
 * Author: Ishi Nail Lab
 *
 * Compensating hardening only. NOT an official ThemeREX 2.47.0 vendor patch.
 */
defined('ABSPATH') || exit;

if (!function_exists('ishi_trx_isolated_ajax_decision')) {
    /**
     * Pure predicate for independent regression tests.
     * Return: block, admin_only, allow. No wildcard gate for storefront actions.
     */
    function ishi_trx_isolated_ajax_decision($action) {
        if (!is_string($action) || $action === '' || strlen($action) > 192) {
            return 'allow';
        }
        // ThemeREX's standalone AI generator is unused on the inspected pages.
        // This does not affect AI Engine, /ishi-ai/v1, or ishikeit.
        if (strpos($action, 'trx_addons_ai_helper_') === 0
            || strpos($action, 'trx_addons_ai_assistant_') === 0) {
            return 'block';
        }
        static $restricted = array(
            'trx_addons_download_addon',
            'trx_addons_update_addon',
            'trx_addons_activate_addon',
            'trx_addons_deactivate_addon',
            'trx_addons_ocdi_demo_settings_change',
            'trx_addons_importer_start_import',
            'trx_addons_importer_get_list_pages',
            'trx_addons_cpt_layouts_create',
        );
        return in_array($action, $restricted, true) ? 'admin_only' : 'allow';
    }
}

add_action('admin_init', static function () {
    if (!function_exists('wp_doing_ajax') || !wp_doing_ajax()) {
        return;
    }
    $action = isset($_REQUEST['action']) ? $_REQUEST['action'] : '';
    $decision = ishi_trx_isolated_ajax_decision($action);
    if ($decision === 'block' || ($decision === 'admin_only' && !current_user_can('manage_options'))) {
        wp_send_json_error(array('code' => 'ishi_trx_unused_surface_disabled'), 403);
    }
}, -9999);

add_filter('rest_pre_dispatch', static function ($result, $server, $request) {
    if ($result !== null) {
        return $result;
    }
    $route = $request->get_route();
    if (is_string($route) && preg_match('~^/ai-helper/v1(?:/|$)~i', $route)) {
        return new WP_Error('ishi_trx_ai_surface_disabled', 'Unused ThemeREX AI endpoints disabled.', array('status' => 403));
    }
    return $result;
}, -9999, 3);
