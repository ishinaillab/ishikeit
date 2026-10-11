<?php
/**
 * Plugin Name: Ishi ThemeREX Preset Output Guard
 * Description: Escapes and validates saved ThemeREX Elementor preset identifiers and titles.
 * Version: 1.0.0
 *
 * Local defense in depth pending the authenticated ThemeREX 2.47+ vendor release.
 */
defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'ishi_trx_preset_safe_id' ) ) {
    function ishi_trx_preset_safe_id( $id ) {
        return is_string( $id )
            && preg_match( '/\A[A-Za-z0-9_.:\-]{1,128}\z/D', $id )
            && ! in_array( strtolower( $id ), array( '__proto__', 'constructor', 'prototype' ), true );
    }
}
if ( ! function_exists( 'ishi_trx_preset_filter_json' ) ) {
    /**
     * Context-specific protection for the vendor's jQuery .append(html) call.
     * Data is JSON in the WordPress option; styles/options are NEVER modified.
     *
     * $for_output=true: HTML-encode title for dynamic <option> text insertion.
     * $for_output=false: strip markup from future persisted names.
     */
    function ishi_trx_preset_filter_json( $raw, $for_output ) {
        if ( ! is_string( $raw ) || strlen( $raw ) > 1048576 || $raw === '' ) {
            return $raw;
        }
        $presets = json_decode( $raw, true );
        if ( ! is_array( $presets ) || json_last_error() !== JSON_ERROR_NONE || ! $presets ) {
            return $raw;
        }
        $changed = false;
        foreach ( $presets as $id => &$preset ) {
            if ( ! ishi_trx_preset_safe_id( $id ) || ! is_array( $preset ) ) {
                unset( $presets[ $id ] );
                $changed = true;
                continue;
            }
            if ( array_key_exists( 'title', $preset ) ) {
                $value = is_string( $preset['title'] ) ? $preset['title'] : '';
                // A literal '&lt;' must remain text, not become live HTML.
                $plain = wp_strip_all_tags( $value, true );
                $safe = $for_output ? esc_html( $plain ) : sanitize_text_field( $plain );
                if ( $safe !== $preset['title'] ) {
                    $preset['title'] = $safe;
                    $changed = true;
                }
            }
        }
        unset( $preset );
        return $changed ? wp_json_encode( $presets, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : $raw;
    }
}

add_filter( 'option_trx_addons_elementor_widgets_presets_qwery',
    static function ( $value ) { return ishi_trx_preset_filter_json( $value, true ); }, 10, 1 );

add_filter( 'pre_update_option_trx_addons_elementor_widgets_presets_qwery',
    static function ( $value ) { return ishi_trx_preset_filter_json( $value, false ); }, 10, 1 );
