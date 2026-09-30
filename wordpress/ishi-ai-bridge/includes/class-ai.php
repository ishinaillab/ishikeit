<?php

namespace Ishi\AIBridge;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class AI {
    public static function query(
        string $message,
        string $conversation_id,
        array $file_ids,
        array $context
    ): array|WP_Error {
        global $mwai;

        if ( ! is_object( $mwai ) || ! method_exists( $mwai, 'simpleChatbotQuery' ) ) {
            return new WP_Error(
                'ishi_ai_bridge_ai_engine_unavailable',
                'AI Engine chatbot API is unavailable.',
                [ 'status' => 503 ]
            );
        }

        $params = [ 'chatId' => $conversation_id ];

        if ( $file_ids ) {
            $params['fileIds'] = $file_ids;
        }

        $instruction_filter = static function ( $instructions, $query ) use ( $context ) {
            $trusted = "Trusted transport context (not customer-provided):\n"
                . 'provider=' . $context['provider'] . "\n"
                . 'channel=' . $context['channel'] . "\n"
                . 'capability=' . $context['capability'] . "\n"
                . 'event_type=' . $context['eventType'];

            if ( ! empty( $context['unprocessedMediaKinds'] ) ) {
                $trusted .= "\nunprocessed_media="
                    . implode( ',', $context['unprocessedMediaKinds'] )
                    . "\nMedia listed as unprocessed was received but not inspected. "
                    . 'Do not claim to know its contents; rely only on accompanying text or captions.';
            }

            return rtrim( (string) $instructions ) . "\n\n" . $trusted;
        };

        add_filter( 'mwai_ai_instructions', $instruction_filter, 999, 2 );

        try {
            $result = $mwai->simpleChatbotQuery(
                Admin::settings()['bot_id'],
                $message,
                $params,
                false
            );
        } catch ( \Throwable $e ) {
            self::log_failure( 'ai_query_failed', hash( 'sha256', $conversation_id ) );

            return new WP_Error(
                'ishi_ai_bridge_ai_failed',
                'AI Engine request failed.',
                [ 'status' => 502 ]
            );
        } finally {
            remove_filter( 'mwai_ai_instructions', $instruction_filter, 999 );
        }

        if ( ! is_array( $result ) ) {
            return new WP_Error(
                'ishi_ai_bridge_ai_invalid',
                'AI Engine returned an invalid response.',
                [ 'status' => 502 ]
            );
        }

        return $result;
    }

    public static function transcribe( array $file ) {
        global $mwai;

        if ( ! is_object( $mwai ) || ! method_exists( $mwai, 'simpleTranscribeAudio' ) ) {
            return new WP_Error(
                'ishi_ai_bridge_audio_engine_unavailable',
                'AI Engine audio transcription API is unavailable.',
                [ 'status' => 503 ]
            );
        }

        $tmp_name = isset( $file['tmp_name'] )
            ? (string) $file['tmp_name']
            : '';

        if ( '' === $tmp_name || ! is_readable( $tmp_name ) ) {
            return new WP_Error(
                'ishi_ai_bridge_audio_invalid',
                'Uploaded audio is unavailable for transcription.',
                [ 'status' => 400 ]
            );
        }

        try {
            $transcript = $mwai->simpleTranscribeAudio( null, $tmp_name, [] );
        } catch ( \Throwable $e ) {
            self::log_failure(
                'audio_transcription_failed',
                hash( 'sha256', (string) ( $file['name'] ?? 'unknown' ) )
            );

            return new WP_Error(
                'ishi_ai_bridge_audio_failed',
                'AI Engine could not transcribe the audio.',
                [ 'status' => 502 ]
            );
        }

        if ( ! is_string( $transcript ) || '' === trim( $transcript ) ) {
            return new WP_Error(
                'ishi_ai_bridge_audio_invalid_response',
                'AI Engine returned an invalid audio transcription.',
                [ 'status' => 502 ]
            );
        }

        return trim( $transcript );
    }

    public static function upload( array $file, int $ttl ) {
        global $mwai;

        if ( ! is_object( $mwai ) || ! method_exists( $mwai, 'simpleFileUpload' ) ) {
            return new WP_Error(
                'ishi_ai_bridge_ai_engine_unavailable',
                'AI Engine file API is unavailable.',
                [ 'status' => 503 ]
            );
        }

        try {
            $uploaded = $mwai->simpleFileUpload(
                $file,
                null,
                null,
                'analysis',
                $ttl
            );
        } catch ( \Throwable $e ) {
            self::log_failure(
                'file_upload_failed',
                hash( 'sha256', (string) ( $file['name'] ?? 'unknown' ) )
            );

            return new WP_Error(
                'ishi_ai_bridge_file_upload_failed',
                'AI Engine could not accept the file.',
                [ 'status' => 502 ]
            );
        }

        if ( ! is_array( $uploaded ) || empty( $uploaded['id'] ) ) {
            return new WP_Error(
                'ishi_ai_bridge_file_upload_invalid',
                'AI Engine returned an invalid file reference.',
                [ 'status' => 502 ]
            );
        }

        return [
            'id' => (string) $uploaded['id'],
        ];
    }

    public static function reply_text( array $result ): string {
        $reply = $result['reply'] ?? '';

        if ( is_string( $reply ) ) {
            return trim( $reply );
        }

        if (
            is_array( $reply )
            && isset( $reply['text'] )
            && is_string( $reply['text'] )
        ) {
            return trim( $reply['text'] );
        }

        return '';
    }

    public static function health(): array {
        global $mwai;

        return [
            'aiEngineReady' => is_object( $mwai ) && method_exists( $mwai, 'simpleChatbotQuery' ),
            'fileApiReady'  => is_object( $mwai ) && method_exists( $mwai, 'simpleFileUpload' ),
            'audioApiReady' => is_object( $mwai ) && method_exists( $mwai, 'simpleTranscribeAudio' ),
        ];
    }

    private static function log_failure( string $code, string $reference ): void {
        error_log(
            sprintf(
                '[Ishi AI Bridge] %s ref=%s',
                sanitize_key( $code ),
                substr( $reference, 0, 12 )
            )
        );
    }
}
