<?php
/**
 * Plugin Name: Ishi ThemeREX Elementor Preset Access Guard
 * Description: Limits ThemeREX site-wide Elementor preset mutation endpoints to theme managers.
 * Version: 1.0.0
 *
 * Local defense in depth. This is not an official ThemeREX CVE patch.
 */
defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'ishi_trx_preset_is_protected_action' ) ) {
    function ishi_trx_preset_is_protected_action( $action ) {
        return is_string( $action ) && in_array(
            $action,
            array(
                'trx_addons_action_create_preset',
                'trx_addons_action_update_preset',
                'trx_addons_action_delete_preset',
                'trx_addons_elementor_presets_create',
            ),
            true
        );
    }
}

if ( ! function_exists( 'ishi_trx_preset_access_enforce' ) ) {
    function ishi_trx_preset_access_enforce() {
        if ( ! function_exists( 'wp_doing_ajax' ) || ! wp_doing_ajax() ) {
            return;
        }
        $raw = isset( $_REQUEST['action'] ) ? $_REQUEST['action'] : '';
        if ( ! is_string( $raw ) || ! ishi_trx_preset_is_protected_action( $raw ) ) {
            return;
        }
        // Presets change site-wide Elementor widget configuration; nonce alone
        // does not establish authorization for a Contributor or Editor.
        if ( current_user_can( 'edit_theme_options' ) ) {
            return;
        }
        wp_send_json_error(
            array( 'code' => 'ishi_trx_preset_insufficient_capability' ),
            403
        );
    }
}
add_action( 'admin_init', 'ishi_trx_preset_access_enforce', 0 );
