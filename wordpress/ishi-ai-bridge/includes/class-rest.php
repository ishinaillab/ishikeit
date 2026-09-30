<?php

namespace Ishi\AIBridge;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Rest {
    public const REST_NS = 'ishi-ai/v1';

    private const CACHE_POLICY_VERSION = '2';

    public static function boot(): void {
        add_action( 'init', [ __CLASS__, 'protect_current_request_from_cache' ], 0 );
        add_action( 'init', [ __CLASS__, 'ensure_cache_policy' ], 1 );
        add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
        add_filter( 'rest_post_dispatch', [ __CLASS__, 'add_no_store_headers' ], 10, 3 );
    }

    public static function protect_current_request_from_cache(): void {
        $uri = isset( $_SERVER['REQUEST_URI'] )
            ? (string) $_SERVER['REQUEST_URI']
            : '';

        $is_bridge_request = false !== strpos( $uri, '/wp-json/' . self::REST_NS . '/' )
            || false !== strpos( $uri, 'rest_route=%2F' . rawurlencode( self::REST_NS ) )
            || false !== strpos( $uri, 'rest_route=/' . self::REST_NS . '/' );

        if ( ! $is_bridge_request ) {
            return;
        }

        if ( ! defined( 'DONOTCACHEPAGE' ) ) {
            define( 'DONOTCACHEPAGE', true );
        }

        do_action(
            'litespeed_control_set_nocache',
            'Ishi AI Bridge private REST endpoint'
        );
    }

    public static function ensure_cache_policy(): void {
        if ( self::CACHE_POLICY_VERSION === (string) get_option( 'ishi_ai_bridge_cache_policy_version', '' ) ) {
            return;
        }

        foreach ( [ '/health', '/turn', '/files' ] as $route ) {
            do_action(
                'litespeed_purge_url',
                rest_url( self::REST_NS . $route )
            );
        }

        update_option(
            'ishi_ai_bridge_cache_policy_version',
            self::CACHE_POLICY_VERSION,
            false
        );
    }

    public static function register_routes(): void {
        register_rest_route(
            self::REST_NS,
            '/turn',
            [
                'methods'             => 'POST',
                'callback'            => [ __CLASS__, 'turn' ],
                'permission_callback' => [ Auth::class, 'verify' ],
            ]
        );

        register_rest_route(
            self::REST_NS,
            '/files',
            [
                'methods'             => 'POST',
                'callback'            => [ __CLASS__, 'upload_file' ],
                'permission_callback' => [ Auth::class, 'verify' ],
            ]
        );

        register_rest_route(
            self::REST_NS,
            '/health',
            [
                'methods'             => 'GET',
                'callback'            => [ __CLASS__, 'health' ],
                'permission_callback' => [ Auth::class, 'verify' ],
            ]
        );
    }

    public static function turn( WP_REST_Request $request ): WP_REST_Response|WP_Error {
        Storage::maybe_cleanup();

        $data = Validation::json_body( $request );

        if ( is_wp_error( $data ) ) {
            return $data;
        }

        $turn_id = Validation::opaque_id( $data['turnId'] ?? '', 128 );
        $conversation_id = Validation::opaque_id( $data['conversationId'] ?? '', 255 );
        $message = isset( $data['message'] ) && is_string( $data['message'] )
            ? trim( $data['message'] )
            : '';

        if ( is_wp_error( $turn_id ) || is_wp_error( $conversation_id ) || '' === $message ) {
            return new WP_Error(
                'ishi_ai_bridge_invalid_turn',
                'turnId, conversationId, and a non-empty message are required.',
                [ 'status' => 400 ]
            );
        }

        if ( Validation::string_length( $message ) > 100000 ) {
            return new WP_Error(
                'ishi_ai_bridge_message_too_large',
                'Message is too large.',
                [ 'status' => 413 ]
            );
        }

        $file_ids = Validation::file_ids( $data['fileIds'] ?? [] );

        if ( is_wp_error( $file_ids ) ) {
            return $file_ids;
        }

        $context = Validation::trusted_context( $data['context'] ?? [] );
        $turn_hash = hash( 'sha256', $turn_id );
        $claim = Storage::claim_turn( $turn_hash );

        if ( is_wp_error( $claim ) ) {
            return $claim;
        }

        if ( isset( $claim['cached_response'] ) ) {
            return Validation::response( $claim['cached_response'] );
        }

        $result = AI::query( $message, $conversation_id, $file_ids, $context );

        if ( is_wp_error( $result ) ) {
            Storage::release_turn( $turn_hash );
            return $result;
        }

        $reply = AI::reply_text( $result );

        if ( '' === $reply ) {
            Storage::release_turn( $turn_hash );

            return new WP_Error(
                'ishi_ai_bridge_empty_reply',
                'AI Engine returned no reply.',
                [ 'status' => 502 ]
            );
        }

        $parts = [
            [
                'kind' => 'text',
                'text' => $reply,
            ],
        ];

        $parts = apply_filters(
            'ishi_ai_bridge_reply_parts',
            $parts,
            $data,
            $result
        );

        $parts = Validation::reply_parts( $parts );

        if ( is_wp_error( $parts ) ) {
            Storage::release_turn( $turn_hash );
            return $parts;
        }

        $handoff = (bool) apply_filters(
            'ishi_ai_bridge_handoff_required',
            false,
            $data,
            $result,
            $parts
        );

        $response = [
            'ok'      => true,
            'turnId'  => $turn_id,
            'parts'   => $handoff ? [] : $parts,
            'handoff' => $handoff,
        ];

        if ( ! Storage::complete_turn( $turn_hash, $response ) ) {
            return new WP_Error(
                'ishi_ai_bridge_persistence_failed',
                'Unable to persist the completed AI turn.',
                [ 'status' => 503 ]
            );
        }

        return Validation::response( $response );
    }

    public static function upload_file( WP_REST_Request $request ): WP_REST_Response|WP_Error {
        Storage::maybe_cleanup();

        $files = $request->get_file_params();

        if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
            return new WP_Error(
                'ishi_ai_bridge_missing_file',
                'A multipart file is required.',
                [ 'status' => 400 ]
            );
        }

        $file = $files['file'];

        if ( ! empty( $file['error'] ) ) {
            return new WP_Error(
                'ishi_ai_bridge_upload_error',
                'File upload failed.',
                [ 'status' => 400 ]
            );
        }

        $size = isset( $file['size'] ) ? (int) $file['size'] : 0;
        $max = Admin::settings()['file_max_bytes'];

        if ( $size <= 0 || $size > $max ) {
            return new WP_Error(
                'ishi_ai_bridge_file_too_large',
                'File size is not allowed.',
                [ 'status' => 413 ]
            );
        }

        $name = isset( $file['name'] )
            ? sanitize_file_name( (string) $file['name'] )
            : '';

        $tmp_name = isset( $file['tmp_name'] )
            ? (string) $file['tmp_name']
            : '';

        if ( '' === $name || '' === $tmp_name || ! is_uploaded_file( $tmp_name ) ) {
            return new WP_Error(
                'ishi_ai_bridge_invalid_file',
                'Invalid uploaded file.',
                [ 'status' => 400 ]
            );
        }

        $checked = wp_check_filetype_and_ext( $tmp_name, $name );

        if ( empty( $checked['type'] ) || empty( $checked['ext'] ) ) {
            return new WP_Error(
                'ishi_ai_bridge_file_type',
                'File type is not allowed.',
                [ 'status' => 415 ]
            );
        }

        $ttl = isset( $_POST['ttl'] )
            ? (int) $_POST['ttl']
            : 3600;

        $ttl = min( DAY_IN_SECONDS, max( 60, $ttl ) );

        $content_hash = hash_file( 'sha256', $tmp_name );
        if ( false === $content_hash ) {
            return new WP_Error(
                'ishi_ai_bridge_file_hash_failed',
                'Unable to fingerprint the uploaded file.',
                [ 'status' => 500 ]
            );
        }

        $request_hash = hash( 'sha256', $content_hash . "\n" . $name );
        $claim = Storage::claim_file( $request_hash, $ttl );

        if ( is_wp_error( $claim ) ) {
            return $claim;
        }

        if ( isset( $claim['cached_response'] ) ) {
            return Validation::response( $claim['cached_response'] );
        }

        $uploaded = AI::upload( $file, $ttl );

        if ( is_wp_error( $uploaded ) ) {
            Storage::release_file( $request_hash );
            return $uploaded;
        }

        $response = [
            'ok'   => true,
            'file' => $uploaded,
        ];

        if ( ! Storage::complete_file( $request_hash, $response, $ttl ) ) {
            return new WP_Error(
                'ishi_ai_bridge_persistence_failed',
                'Unable to persist the completed file upload.',
                [ 'status' => 503 ]
            );
        }

        return Validation::response( $response );
    }

    public static function health(): WP_REST_Response {
        $health = AI::health();

        return Validation::response(
            [
                'ok'            => true,
                'version'       => ISHI_AI_BRIDGE_VERSION,
                'schemaVersion' => (string) get_option( Storage::SCHEMA_OPTION, '' ),
                'tokenReady'    => '' !== Auth::token_hash(),
                'aiEngineReady' => $health['aiEngineReady'],
                'fileApiReady'  => $health['fileApiReady'],
                'botId'         => Admin::settings()['bot_id'],
            ]
        );
    }

    public static function add_no_store_headers(
        $response,
        $server,
        WP_REST_Request $request
    ) {
        if (
            0 === strpos(
                (string) $request->get_route(),
                '/' . self::REST_NS . '/'
            )
            && $response instanceof WP_REST_Response
        ) {
            $response->header(
                'Cache-Control',
                'no-store, no-cache, must-revalidate, max-age=0'
            );

            $response->header( 'Pragma', 'no-cache' );
            $response->header( 'X-Robots-Tag', 'noindex, nofollow, noarchive' );

            if ( 409 === $response->get_status() ) {
                $response->header( 'Retry-After', '2' );
            }
        }

        return $response;
    }
}
