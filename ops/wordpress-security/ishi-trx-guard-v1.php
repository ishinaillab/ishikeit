<?php
/**
 * Plugin Name: Ishi ThemeREX Request and Editor Guard
 * Description: Locally developed defense in depth for ThemeREX Addons 2.45.0 pending an authenticated vendor security release.
 * Version: 1.0.0
 * Author: Ishi Nail Lab
 *
 * This is NOT an official ThemeREX fix and does not change the affected plugin's version.
 */
defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'ishi_trx_guard_plugin_call' ) ) {
    function ishi_trx_guard_plugin_call() {
        foreach ( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 30 ) as $frame ) {
            if ( ! empty( $frame['file'] )
                && strpos( str_replace( '\\', '/', $frame['file'] ), '/wp-content/plugins/trx_addons/' ) !== false ) {
                return true;
            }
        }
        return false;
    }
}

if ( ! function_exists( 'ishi_trx_guard_safe_url' ) ) {
    function ishi_trx_guard_safe_url( $url, $https_only = false ) {
        if ( ! is_string( $url ) || strlen( $url ) > 2048 ) {
            return false;
        }
        $parts = wp_parse_url( $url );
        if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] )
            || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
            return false;
        }
        $scheme = strtolower( $parts['scheme'] );
        if ( $https_only ? $scheme !== 'https' : ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
            return false;
        }
        return function_exists( 'wp_http_validate_url' ) && wp_http_validate_url( $url ) !== false;
    }
}

// WordPress HTTP API: force safe URL and redirect handling only when called by ThemeREX.
add_filter( 'http_request_args', function ( $args, $url ) {
    if ( ! ishi_trx_guard_plugin_call() || ! is_array( $args ) ) {
        return $args;
    }
    $args['reject_unsafe_urls'] = true;
    $args['redirection'] = max( 0, min( 2, (int) ( $args['redirection'] ?? 0 ) ) );
    $args['timeout'] = max( 1, min( 25, (int) ( $args['timeout'] ?? 15 ) ) );
    $args['sslverify'] = true;
    return $args;
}, 9999, 2 );

add_filter( 'pre_http_request', function ( $preempt, $args, $url ) {
    if ( $preempt !== false || ! ishi_trx_guard_plugin_call() ) {
        return $preempt;
    }
    if ( ! ishi_trx_guard_safe_url( $url ) ) {
        return new WP_Error( 'ishi_trx_guard_ssrf_blocked', 'Unsafe ThemeREX outbound request blocked.' );
    }
    return $preempt;
}, 9999, 3 );

// ThemeREX AI vendor uses bare cURL, disables TLS validation, and follows redirects.
// Its documented filter provides a small, upgrade-safe interception point.
add_filter( 'trx_addons_filter_ai_helper_curl_info', function ( $opts ) {
    if ( ! is_array( $opts ) || ! defined( 'CURLOPT_URL' ) ) {
        return $opts;
    }
    $url = $opts[CURLOPT_URL] ?? '';
    if ( ! ishi_trx_guard_safe_url( $url, true ) ) {
        // Invalid URL scheme deliberately prevents curl_exec from contacting any host.
        $opts[CURLOPT_URL] = 'invalid://blocked';
    }
    $opts[CURLOPT_SSL_VERIFYPEER] = true;
    $opts[CURLOPT_SSL_VERIFYHOST] = 2;
    $opts[CURLOPT_FOLLOWLOCATION] = false;
    $opts[CURLOPT_MAXREDIRS] = 0;
    $opts[CURLOPT_TIMEOUT] = max( 1, min( 25, (int) ( $opts[CURLOPT_TIMEOUT] ?? 15 ) ) );
    $opts[CURLOPT_CONNECTTIMEOUT] = 10;
    if ( defined( 'CURLOPT_PROTOCOLS_STR' ) ) {
        $opts[CURLOPT_PROTOCOLS_STR] = 'https';
    } elseif ( defined( 'CURLOPT_PROTOCOLS' ) && defined( 'CURLPROTO_HTTPS' ) ) {
        $opts[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
    }
    // Reject custom proxy routing for this specific ThemeREX helper.
    foreach ( array( 'CURLOPT_PROXY', 'CURLOPT_PROXYUSERPWD', 'CURLOPT_PROXYTYPE' ) as $constant ) {
        if ( defined( $constant ) ) {
            unset( $opts[ constant( $constant ) ] );
        }
    }
    return $opts;
}, 9999, 1 );

// The Gutenberg AI helper endpoints grant access to anyone allowed to edit posts,
// including Contributors. Avoid exposing their remote AI/HTML operations to that role.
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
    if ( $result !== null || current_user_can( 'upload_files' ) ) {
        return $result;
    }
    $route = $request->get_route();
    if ( preg_match( '~^/ai-helper/v1/(?:get-response|fetch-answer)/?$~i', $route ) ) {
        return new WP_Error( 'ishi_trx_guard_rest_forbidden', 'ThemeREX editor AI access restricted.', array( 'status' => 403 ) );
    }
    return $result;
}, 2, 3 );

// Block ThemeREX post metadata writes initiated by logged-in users who lack media
// upload permission. This narrowly reduces low-privilege stored markup injection.
function ishi_trx_guard_postmeta_write( $check, $object_id, $meta_key ) {
    if ( $check !== null || ! is_user_logged_in() || current_user_can( 'upload_files' ) ) {
        return $check;
    }
    if ( is_string( $meta_key ) && preg_match( '/^_?trx_(?:addons_|sc_|widget_|layout|settings|options)/i', $meta_key ) ) {
        return false;
    }
    return $check;
}
add_filter( 'add_post_metadata', 'ishi_trx_guard_postmeta_write', 5, 3 );
add_filter( 'update_post_metadata', 'ishi_trx_guard_postmeta_write', 5, 3 );

// Contributor-owned posts cannot render potentially unsafe ThemeREX shortcodes
// after publication by someone more privileged. Leave staff/admin posts alone.
add_filter( 'pre_do_shortcode_tag', function ( $return, $tag ) {
    if ( $return !== false || ! is_string( $tag )
        || ! preg_match( '/^trx_(?:sc_|widget_|slide$|slider_)/i', $tag ) ) {
        return $return;
    }
    $post = get_post();
    if ( ! $post instanceof WP_Post || ! $post->post_author ) {
        return $return;
    }
    $author = get_userdata( (int) $post->post_author );
    if ( $author && ! user_can( $author, 'upload_files' ) ) {
        return '';
    }
    return $return;
}, 5, 2 );
