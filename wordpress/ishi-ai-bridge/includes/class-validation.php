<?php

namespace Ishi\AIBridge;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Validation {
    public static function json_body( WP_REST_Request $request ) {
        $content_type = strtolower( trim( (string) $request->get_header( 'content-type' ) ) );

        if ( ! preg_match( '#^application/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)#i', $content_type ) ) {
            return new WP_Error(
                'ishi_ai_bridge_content_type',
                'Content-Type must be application/json.',
                [ 'status' => 415 ]
            );
        }

        if ( method_exists( $request, 'get_json_error' ) ) {
            $error = $request->get_json_error();
            if ( is_wp_error( $error ) ) {
                return new WP_Error(
                    'ishi_ai_bridge_invalid_json',
                    'Invalid JSON body.',
                    [ 'status' => 400 ]
                );
            }
        }

        $data = $request->get_json_params();

        return is_array( $data )
            ? $data
            : new WP_Error(
                'ishi_ai_bridge_invalid_json',
                'JSON body must be an object.',
                [ 'status' => 400 ]
            );
    }

    public static function opaque_id( $value, int $max ) {
        if ( ! is_string( $value ) ) {
            return new WP_Error(
                'ishi_ai_bridge_invalid_identifier',
                'Invalid identifier.',
                [ 'status' => 400 ]
            );
        }

        $value = trim( $value );

        if (
            '' === $value
            || strlen( $value ) > $max
            || ! preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $value )
        ) {
            return new WP_Error(
                'ishi_ai_bridge_invalid_identifier',
                'Invalid identifier.',
                [ 'status' => 400 ]
            );
        }

        return $value;
    }

    public static function file_ids( $value ) {
        if ( null === $value || [] === $value ) {
            return [];
        }

        if ( ! is_array( $value ) || count( $value ) > 10 ) {
            return new WP_Error(
                'ishi_ai_bridge_invalid_files',
                'fileIds must be an array of at most 10 IDs.',
                [ 'status' => 400 ]
            );
        }

        $ids = [];

        foreach ( $value as $id ) {
            $normalized = self::opaque_id( $id, 255 );

            if ( is_wp_error( $normalized ) ) {
                return new WP_Error(
                    'ishi_ai_bridge_invalid_files',
                    'One or more file IDs are invalid.',
                    [ 'status' => 400 ]
                );
            }

            $ids[] = $normalized;
        }

        return array_values( array_unique( $ids ) );
    }

    public static function trusted_context( $context ): array {
        $context = is_array( $context ) ? $context : [];

        return [
            'provider'   => sanitize_key( (string) ( $context['provider'] ?? 'unknown' ) ),
            'channel'    => sanitize_key( (string) ( $context['channel'] ?? 'unknown' ) ),
            'capability' => sanitize_key( (string) ( $context['capability'] ?? 'unknown' ) ),
            'eventType'  => sanitize_text_field( (string) ( $context['eventType'] ?? 'unknown' ) ),
        ];
    }

    public static function reply_parts( $parts ) {
        if ( ! is_array( $parts ) || count( $parts ) > 32 ) {
            return self::parts_error();
        }

        $validated = [];

        foreach ( $parts as $part ) {
            if ( ! is_array( $part ) || empty( $part['kind'] ) ) {
                return self::parts_error();
            }

            $kind = sanitize_key( (string) $part['kind'] );

            if ( 'text' === $kind ) {
                $text = isset( $part['text'] ) && is_string( $part['text'] )
                    ? trim( $part['text'] )
                    : '';

                if ( '' !== $text ) {
                    $validated[] = [
                        'kind' => 'text',
                        'text' => $text,
                    ];
                }

                continue;
            }

            if ( in_array( $kind, [ 'image', 'video', 'audio', 'document' ], true ) ) {
                $media = self::media_part( $kind, $part );

                if ( is_wp_error( $media ) ) {
                    return $media;
                }

                $validated[] = $media;
                continue;
            }

            if ( 'structured' === $kind && isset( $part['format'] ) ) {
                $format = sanitize_key( (string) $part['format'] );

                if ( '' === $format ) {
                    return self::parts_error();
                }

                $validated[] = [
                    'kind'   => 'structured',
                    'format' => $format,
                    'data'   => $part['data'] ?? null,
                ];

                continue;
            }

            return self::parts_error();
        }

        return $validated
            ? $validated
            : self::parts_error();
    }

    public static function response( array $data, int $status = 200 ): WP_REST_Response {
        $response = new WP_REST_Response( $data, $status );
        $response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
        $response->header( 'Pragma', 'no-cache' );

        return $response;
    }

    public static function string_length( string $value ): int {
        return function_exists( 'mb_strlen' )
            ? mb_strlen( $value, 'UTF-8' )
            : strlen( $value );
    }

    private static function media_part( string $kind, array $part ) {
        $source = $part['source'] ?? null;

        if (
            ! is_array( $source )
            || 'url' !== sanitize_key( (string) ( $source['kind'] ?? '' ) )
            || empty( $source['value'] )
        ) {
            return self::parts_error();
        }

        $url = wp_http_validate_url( esc_url_raw( (string) $source['value'] ) );

        if ( ! $url || 0 !== strpos( $url, 'https://' ) ) {
            return self::parts_error();
        }

        $entry = [
            'kind'   => $kind,
            'source' => [
                'kind'  => 'url',
                'value' => $url,
            ],
        ];

        foreach ( [ 'mimeType', 'filename', 'caption' ] as $optional ) {
            if (
                isset( $part[ $optional ] )
                && is_string( $part[ $optional ] )
                && '' !== trim( $part[ $optional ] )
            ) {
                $entry[ $optional ] = sanitize_text_field( $part[ $optional ] );
            }
        }

        return $entry;
    }

    private static function parts_error(): WP_Error {
        return new WP_Error(
            'ishi_ai_bridge_invalid_reply_parts',
            'Reply parts are invalid.',
            [ 'status' => 500 ]
        );
    }
}
