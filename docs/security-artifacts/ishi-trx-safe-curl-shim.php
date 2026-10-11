<?php
/**
 * Plugin Name: Ishi ThemeREX Safe cURL Compatibility Shim
 * Description: Routes ThemeREX's legacy cURL helper through WordPress safe HTTP transport with TLS, URL validation and no automatic redirects.
 * Version: 1.0.0
 * Author: Ishi Nail Lab
 *
 * Defense in depth; does NOT certify CVE-2026-102797 / CVE-2026-102798 as fixed.
 */
defined('ABSPATH') || exit;
if (!function_exists('trx_addons_remote_curl')) {
    function trx_addons_remote_curl($file, $vars = array(), $args = array(), $curl_options = array()) {
        if (!is_string($file) || !is_array($args) || !is_array($curl_options) || $curl_options) {
            return '';
        }
        if (!function_exists('ishi_trx_guard_safe_url') || !function_exists('wp_safe_remote_request')) {
            return '';
        }
        if (function_exists('trx_addons_add_protocol')) {
            $file = trx_addons_add_protocol($file);
        }
        // This legacy helper is not called by the audited 2.46.0 plugin itself.
        // Fail closed on HTTP, internal destinations, proxies, or custom curl overrides.
        if (!ishi_trx_guard_safe_url($file, true) || !empty($args['proxy']) || !empty($args['proxy_user_pwd'])) {
            return '';
        }
        $method = strtolower((string)($args['method'] ?? ''));
        if ($method === '') {
            $method = empty($vars) ? 'GET' : 'POST';
        } elseif ($method === 'put') {
            $method = 'PUT';
        } elseif ($method === 'post') {
            $method = 'POST';
        } elseif ($method === 'get') {
            $method = 'GET';
        } else {
            return '';
        }
        $timeout = max(1, min(25, (int)($args['timeout'] ?? 15)));
        $headers = $args['headers'] ?? array();
        if (!is_array($headers)) return '';
        $request = array(
            'method' => $method,
            'timeout' => $timeout,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'sslverify' => true,
            'headers' => $headers,
            'limit_response_size' => 2097152,
        );
        if ($method !== 'GET' && $vars !== array() && $vars !== '') {
            $request['body'] = $vars;
        }
        $response = wp_safe_remote_request($file, $request);
        if (is_wp_error($response)) {
            $GLOBALS['trx_addons_last_curl_error'] = $response->get_error_code();
            return '';
        }
        $code = (int)wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code > 299) {
            $GLOBALS['trx_addons_last_curl_error'] = $code;
            return '';
        }
        $body = wp_remote_retrieve_body($response);
        return is_string($body) ? $body : '';
    }
}
