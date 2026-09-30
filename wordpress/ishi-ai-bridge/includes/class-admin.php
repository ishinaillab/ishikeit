<?php

namespace Ishi\AIBridge;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Admin {
    private const OPTION = 'ishi_ai_bridge_settings';
    private const DEFAULT_FILE_MAX_BYTES = 26214400;

    public static function boot(): void {
        add_action( 'admin_menu', [ __CLASS__, 'admin_menu' ] );
        add_action( 'admin_init', [ __CLASS__, 'register_settings' ] );
    }

    public static function ensure_defaults(): void {
        if ( false === get_option( self::OPTION, false ) ) {
            add_option(
                self::OPTION,
                [
                    'bot_id'         => 'default',
                    'file_max_bytes' => self::DEFAULT_FILE_MAX_BYTES,
                ],
                '',
                false
            );
        }
    }

    public static function settings(): array {
        $stored = get_option( self::OPTION, [] );
        $stored = is_array( $stored ) ? $stored : [];

        return [
            'bot_id'         => isset( $stored['bot_id'] ) && '' !== trim( (string) $stored['bot_id'] )
                ? sanitize_text_field( (string) $stored['bot_id'] )
                : 'default',
            'file_max_bytes' => min(
                104857600,
                max( 1048576, (int) ( $stored['file_max_bytes'] ?? self::DEFAULT_FILE_MAX_BYTES ) )
            ),
        ];
    }

    public static function admin_menu(): void {
        add_options_page(
            'Ishi AI Bridge',
            'Ishi AI Bridge',
            'manage_options',
            'ishi-ai-bridge',
            [ __CLASS__, 'settings_page' ]
        );
    }

    public static function register_settings(): void {
        register_setting(
            'ishi_ai_bridge',
            self::OPTION,
            [
                'type'              => 'array',
                'sanitize_callback' => [ __CLASS__, 'sanitize_settings' ],
                'default'           => [],
            ]
        );
    }

    public static function sanitize_settings( $input ): array {
        $input = is_array( $input ) ? $input : [];

        return [
            'bot_id'         => sanitize_text_field( (string) ( $input['bot_id'] ?? 'default' ) ),
            'file_max_bytes' => min(
                104857600,
                max( 1048576, (int) ( $input['file_max_bytes'] ?? self::DEFAULT_FILE_MAX_BYTES ) )
            ),
        ];
    }

    public static function settings_page(): void {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $settings = self::settings();
        ?>
        <div class="wrap">
            <h1>Ishi AI Bridge</h1>
            <p>Private transport from Ishikeit's durable processor to AI Engine. The bridge does not receive public social webhooks or send provider messages.</p>

            <table class="widefat striped" style="max-width:980px;margin:20px 0;">
                <tbody>
                    <tr><td><strong>Turn endpoint</strong></td><td><code><?php echo esc_html( rest_url( Rest::REST_NS . '/turn' ) ); ?></code></td></tr>
                    <tr><td><strong>File endpoint</strong></td><td><code><?php echo esc_html( rest_url( Rest::REST_NS . '/files' ) ); ?></code></td></tr>
                    <tr><td><strong>Audio transcription endpoint</strong></td><td><code><?php echo esc_html( rest_url( Rest::REST_NS . '/transcribe' ) ); ?></code></td></tr>
                    <tr><td><strong>Health endpoint</strong></td><td><code><?php echo esc_html( rest_url( Rest::REST_NS . '/health' ) ); ?></code></td></tr>
                    <tr><td><strong>Authentication configured</strong></td><td><?php echo Auth::token_hash() ? 'Yes' : 'No'; ?></td></tr>
                    <tr><td><strong>Storage schema</strong></td><td><code><?php echo esc_html( (string) get_option( Storage::SCHEMA_OPTION, 'not installed' ) ); ?></code></td></tr>
                </tbody>
            </table>

            <form method="post" action="options.php">
                <?php settings_fields( 'ishi_ai_bridge' ); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="ishi-ai-bot-id">AI Engine chatbot ID</label></th>
                        <td><input id="ishi-ai-bot-id" class="regular-text" name="<?php echo esc_attr( self::OPTION ); ?>[bot_id]" value="<?php echo esc_attr( $settings['bot_id'] ); ?>"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="ishi-ai-file-max">Maximum inbound file bytes</label></th>
                        <td><input id="ishi-ai-file-max" type="number" min="1048576" max="104857600" step="1048576" name="<?php echo esc_attr( self::OPTION ); ?>[file_max_bytes]" value="<?php echo esc_attr( $settings['file_max_bytes'] ); ?>"></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>

            <p><strong>Secret management:</strong> configure the dedicated bridge credential server-side; only its SHA-256 hash is stored in WordPress.</p>
        </div>
        <?php
    }
}
