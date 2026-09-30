<?php

namespace Ishi\AIBridge;

use WP_Error;
use WP_REST_Request;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Auth {
    public const TOKEN_HASH_OPTION = 'ishi_ai_bridge_token_hash';
    public const TOKEN_NOTICE_PREFIX = 'ishi_ai_bridge_token_notice_';

    public static function verify( WP_REST_Request $request ) {
        $stored_hash = self::token_hash();

        if ( '' === $stored_hash ) {
            return new WP_Error(
                'ishi_ai_bridge_not_configured',
                'AI bridge authentication is not configured.',
                [ 'status' => 503 ]
            );
        }

        $header = trim( (string) $request->get_header( 'authorization' ) );
        if ( ! preg_match( '/^Bearer\s+([^\s]+)$/i', $header, $matches ) ) {
            return new WP_Error(
                'ishi_ai_bridge_unauthorized',
                'Unauthorized.',
                [ 'status' => 401 ]
            );
        }

        $provided_hash = hash( 'sha256', $matches[1] );
        if ( ! hash_equals( $stored_hash, $provided_hash ) ) {
            return new WP_Error(
                'ishi_ai_bridge_unauthorized',
                'Unauthorized.',
                [ 'status' => 401 ]
            );
        }

        return true;
    }

    public static function token_hash(): string {
        if ( defined( 'ISHI_AI_BRIDGE_TOKEN_HASH' ) && is_string( ISHI_AI_BRIDGE_TOKEN_HASH ) ) {
            return strtolower( trim( ISHI_AI_BRIDGE_TOKEN_HASH ) );
        }

        return strtolower( trim( (string) get_option( self::TOKEN_HASH_OPTION, '' ) ) );
    }

    public static function rotate(): string {
        $token = 'ishi_ai_' . wp_generate_password( 56, false, false );
        update_option( self::TOKEN_HASH_OPTION, hash( 'sha256', $token ), false );
        return $token;
    }
}
