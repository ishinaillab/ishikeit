<?php

namespace Ishi\AIBridge;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Storage {
    public const SCHEMA_OPTION = 'ishi_ai_bridge_schema_version';

    private const IDEMPOTENCY_TTL = DAY_IN_SECONDS;
    private const PROCESSING_STALE_AFTER = 5 * MINUTE_IN_SECONDS;
    private const CLEANUP_INTERVAL = HOUR_IN_SECONDS;

    public static function install(): void {
        global $wpdb;

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset_collate = $wpdb->get_charset_collate();
        $turns = self::turns_table();
        $files = self::files_table();

        dbDelta(
            "CREATE TABLE {$turns} (
                turn_hash char(64) NOT NULL,
                request_hash char(64) NULL,
                status varchar(20) NOT NULL,
                response_json longtext NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL,
                expires_at datetime NOT NULL,
                PRIMARY KEY  (turn_hash),
                KEY expires_at (expires_at),
                KEY status_updated (status, updated_at)
            ) {$charset_collate};"
        );

        dbDelta(
            "CREATE TABLE {$files} (
                request_hash char(64) NOT NULL,
                status varchar(20) NOT NULL,
                response_json longtext NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL,
                expires_at datetime NOT NULL,
                PRIMARY KEY  (request_hash),
                KEY expires_at (expires_at),
                KEY status_updated (status, updated_at)
            ) {$charset_collate};"
        );

        update_option( self::SCHEMA_OPTION, ISHI_AI_BRIDGE_SCHEMA_VERSION, false );
    }

    public static function claim_turn( string $turn_hash, string $request_hash ) {
        return self::claim_turn_request( $turn_hash, $request_hash );
    }

    public static function complete_turn( string $turn_hash, array $response ): bool {
        return self::complete( self::turns_table(), 'turn_hash', $turn_hash, $response, self::IDEMPOTENCY_TTL );
    }

    public static function release_turn( string $turn_hash ): void {
        self::release( self::turns_table(), 'turn_hash', $turn_hash );
    }

    public static function claim_file( string $request_hash, int $ttl ) {
        return self::claim( self::files_table(), 'request_hash', $request_hash, $ttl );
    }

    public static function complete_file( string $request_hash, array $response, int $ttl ): bool {
        return self::complete( self::files_table(), 'request_hash', $request_hash, $response, $ttl );
    }

    public static function release_file( string $request_hash ): void {
        self::release( self::files_table(), 'request_hash', $request_hash );
    }

    public static function maybe_cleanup(): void {
        if ( get_transient( 'ishi_ai_bridge_cleanup_lock' ) ) {
            return;
        }

        set_transient( 'ishi_ai_bridge_cleanup_lock', 1, self::CLEANUP_INTERVAL );

        global $wpdb;
        $now = current_time( 'mysql', true );

        $wpdb->query(
            $wpdb->prepare(
                'DELETE FROM ' . self::turns_table() . ' WHERE expires_at < %s',
                $now
            )
        );

        $wpdb->query(
            $wpdb->prepare(
                'DELETE FROM ' . self::files_table() . ' WHERE expires_at < %s',
                $now
            )
        );
    }

    private static function claim_turn_request( string $turn_hash, string $request_hash ) {
        global $wpdb;

        $table = self::turns_table();
        $now = current_time( 'mysql', true );
        $expires = gmdate( 'Y-m-d H:i:s', time() + self::IDEMPOTENCY_TTL );

        $inserted = $wpdb->query(
            $wpdb->prepare(
                "INSERT IGNORE INTO {$table}
                 (turn_hash,request_hash,status,response_json,created_at,updated_at,expires_at)
                 VALUES (%s,%s,'processing',NULL,%s,%s,%s)",
                $turn_hash,
                $request_hash,
                $now,
                $now,
                $expires
            )
        );

        if ( 1 === $inserted ) {
            return [ 'claimed' => true ];
        }

        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT request_hash,status,response_json,updated_at,expires_at
                 FROM {$table}
                 WHERE turn_hash = %s
                 LIMIT 1",
                $turn_hash
            ),
            ARRAY_A
        );

        if ( ! is_array( $row ) ) {
            return new WP_Error(
                'ishi_ai_bridge_storage_failed',
                'Idempotency storage failed.',
                [ 'status' => 503 ]
            );
        }

        if ( empty( $row['request_hash'] ) ) {
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$table}
                     SET request_hash=%s
                     WHERE turn_hash=%s AND request_hash IS NULL",
                    $request_hash,
                    $turn_hash
                )
            );

            $stored_hash = $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT request_hash FROM {$table} WHERE turn_hash=%s LIMIT 1",
                    $turn_hash
                )
            );

            $row['request_hash'] = is_string( $stored_hash ) ? $stored_hash : '';
        }

        if (
            empty( $row['request_hash'] )
            || ! hash_equals( (string) $row['request_hash'], $request_hash )
        ) {
            return new WP_Error(
                'ishi_ai_bridge_idempotency_conflict',
                'The turn ID was reused with a different request.',
                [ 'status' => 409 ]
            );
        }

        if (
            'completed' === $row['status']
            && ! empty( $row['response_json'] )
            && strtotime( $row['expires_at'] . ' UTC' ) > time()
        ) {
            $cached = json_decode( $row['response_json'], true );
            if ( is_array( $cached ) ) {
                return [ 'cached_response' => $cached ];
            }
        }

        $stale_before = gmdate(
            'Y-m-d H:i:s',
            time() - self::PROCESSING_STALE_AFTER
        );

        $reclaimed = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$table}
                 SET status='processing',response_json=NULL,updated_at=%s,expires_at=%s
                 WHERE turn_hash=%s
                   AND request_hash=%s
                   AND (expires_at <= %s OR updated_at < %s)",
                $now,
                $expires,
                $turn_hash,
                $request_hash,
                $now,
                $stale_before
            )
        );

        if ( 1 === $reclaimed ) {
            return [ 'claimed' => true ];
        }

        return new WP_Error(
            'ishi_ai_bridge_in_progress',
            'This request is already processing.',
            [ 'status' => 409 ]
        );
    }

    private static function claim( string $table, string $key_column, string $key_hash, int $ttl ) {
        global $wpdb;

        $now = current_time( 'mysql', true );
        $expires = gmdate( 'Y-m-d H:i:s', time() + $ttl );

        $inserted = $wpdb->query(
            $wpdb->prepare(
                "INSERT IGNORE INTO {$table} ({$key_column},status,response_json,created_at,updated_at,expires_at)
                 VALUES (%s,'processing',NULL,%s,%s,%s)",
                $key_hash,
                $now,
                $now,
                $expires
            )
        );

        if ( 1 === $inserted ) {
            return [ 'claimed' => true ];
        }

        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT status,response_json,updated_at,expires_at
                 FROM {$table}
                 WHERE {$key_column} = %s
                 LIMIT 1",
                $key_hash
            ),
            ARRAY_A
        );

        if ( ! is_array( $row ) ) {
            return new WP_Error(
                'ishi_ai_bridge_storage_failed',
                'Idempotency storage failed.',
                [ 'status' => 503 ]
            );
        }

        if (
            'completed' === $row['status']
            && ! empty( $row['response_json'] )
            && strtotime( $row['expires_at'] . ' UTC' ) > time()
        ) {
            $cached = json_decode( $row['response_json'], true );
            if ( is_array( $cached ) ) {
                return [ 'cached_response' => $cached ];
            }
        }

        $stale_before = gmdate( 'Y-m-d H:i:s', time() - self::PROCESSING_STALE_AFTER );

        $reclaimed = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$table}
                 SET status='processing',response_json=NULL,updated_at=%s,expires_at=%s
                 WHERE {$key_column}=%s
                   AND (expires_at <= %s OR updated_at < %s)",
                $now,
                $expires,
                $key_hash,
                $now,
                $stale_before
            )
        );

        if ( 1 === $reclaimed ) {
            return [ 'claimed' => true ];
        }

        return new WP_Error(
            'ishi_ai_bridge_in_progress',
            'This request is already processing.',
            [ 'status' => 409 ]
        );
    }

    private static function complete(
        string $table,
        string $key_column,
        string $key_hash,
        array $response,
        int $ttl
    ): bool {
        global $wpdb;

        $json = wp_json_encode( $response );
        if ( false === $json ) {
            return false;
        }

        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$table}
                 SET status='completed',response_json=%s,updated_at=%s,expires_at=%s
                 WHERE {$key_column}=%s AND status='processing'",
                $json,
                current_time( 'mysql', true ),
                gmdate( 'Y-m-d H:i:s', time() + $ttl ),
                $key_hash
            )
        );

        return 1 === $updated;
    }

    private static function release( string $table, string $key_column, string $key_hash ): void {
        global $wpdb;
        $wpdb->delete( $table, [ $key_column => $key_hash ], [ '%s' ] );
    }

    private static function turns_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'ishi_ai_bridge_turns';
    }

    private static function files_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'ishi_ai_bridge_files';
    }
}
