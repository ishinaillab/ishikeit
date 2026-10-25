<?php
declare(strict_types=1);

namespace {
    define( 'ABSPATH', __DIR__ );

    final class WP_Error {
        public function __construct(
            private readonly string $code,
            private readonly string $message,
            private readonly array $data = []
        ) {}
        public function get_error_code(): string {
            return $this->code;
        }
    }
}

namespace Ishi\AIBridge {
    // The test intercepts WordPress logging without changing production code.
    function error_log( string $message ): bool {
        $GLOBALS['ishi_bridge_test_log'][] = $message;
        return true;
    }
    function add_filter( ...$args ): void {}
    function remove_filter( ...$args ): void {}
    function sanitize_key( string $code ): string {
        return preg_replace( '/[^a-z0-9_-]/', '', strtolower( $code ) ) ?? '';
    }

    final class Admin {
        public static function settings(): array {
            return [ 'bot_id' => 'default' ];
        }
    }

    require_once dirname( __DIR__, 2 ) . '/wordpress/ishi-ai-bridge/includes/class-ai.php';

    final class FakeFailingEngine {
        public function __construct( private readonly \Throwable $error ) {}

        public function simpleChatbotQuery( ...$args ): array {
            throw $this->error;
        }

        public function simpleFileUpload( ...$args ): array {
            throw $this->error;
        }

        public function simpleTranscribeAudio( ...$args ): string {
            throw $this->error;
        }
    }

    function check( bool $condition, string $label ): void {
        if ( ! $condition ) {
            throw new \RuntimeException( 'PHP bridge diagnostic regression: ' . $label );
        }
    }

    $scenarios = [
        [ new \RuntimeException( '429 rate_limit token=sensitive-token-123' ), 'rate_limit' ],
        [ new \RuntimeException( 'insufficient_quota token=sensitive-token-123' ), 'quota' ],
        [ new \RuntimeException( '401 Unauthorized token=sensitive-token-123' ), 'authentication' ],
        [ new \RuntimeException( 'Request timed out token=sensitive-token-123' ), 'timeout' ],
        [ new \RuntimeException( 'SSL certificate failed token=sensitive-token-123' ), 'transport' ],
        [ new \RuntimeException( 'Upstream 502 Bad Gateway token=sensitive-token-123' ), 'upstream' ],
        [ new \TypeError( 'Unexpected type token=sensitive-token-123' ), 'runtime' ],
        [ new \RuntimeException( 'Undiagnosed private message token=sensitive-token-123' ), 'other' ],
    ];

    foreach ( $scenarios as [ $thrown, $expectedCategory ] ) {
        $GLOBALS['mwai'] = new FakeFailingEngine( $thrown );
        $GLOBALS['ishi_bridge_test_log'] = [];
        $result = AI::query(
            'Private customer inquiry',
            'private-conversation-id',
            [],
            [
                'provider' => 'meta',
                'channel' => 'instagram',
                'capability' => 'messaging',
                'eventType' => 'message'
            ]
        );

        check( $result instanceof \WP_Error, 'throw must be converted to WP_Error' );
        check( $result->get_error_code() === 'ishi_ai_bridge_ai_failed', 'stable error code' );
        check( count( $GLOBALS['ishi_bridge_test_log'] ) === 1, 'one event per failure' );
        $log = $GLOBALS['ishi_bridge_test_log'][0];
        check( str_contains( $log, 'category=' . $expectedCategory ), 'correct category: ' . $expectedCategory );
        check( str_contains( $log, 'ref=' ), 'hashed correlation reference' );
        check( ! str_contains( $log, 'sensitive-token-123' ), 'never log upstream credentials' );
        check( ! str_contains( $log, 'Private customer inquiry' ), 'never log the customer message' );
        check( ! str_contains( $log, 'private-conversation-id' ), 'never log the conversation ID' );
        check( ! str_contains( $log, $thrown->getMessage() ), 'never log raw exception message' );
    }

    $GLOBALS['ishi_bridge_test_log'] = [];
    $GLOBALS['mwai'] = new class {
        public function simpleChatbotQuery( ...$args ): array {
            return [ 'reply' => 'Verified mock reply' ];
        }
    };
    $success = AI::query( 'Hello', 'safe:test', [], [
        'provider' => 'telegram',
        'channel' => 'bot',
        'capability' => 'messaging',
        'eventType' => 'message'
    ] );
    check( is_array( $success ) && $success['reply'] === 'Verified mock reply', 'successful chatbot contract' );
    check( count( $GLOBALS['ishi_bridge_test_log'] ) === 0, 'never log successful turn' );

    $GLOBALS['mwai'] = new FakeFailingEngine( new \RuntimeException( '429 rate_limit key=private' ) );
    $GLOBALS['ishi_bridge_test_log'] = [];
    $upload = AI::upload( [ 'name' => 'test.txt' ], 60 );
    check( $upload instanceof \WP_Error, 'file error contract' );
    check( count( $GLOBALS['ishi_bridge_test_log'] ) === 1, 'file logged once' );
    check( str_contains( $GLOBALS['ishi_bridge_test_log'][0], 'category=rate_limit' ), 'file category' );
    check( ! str_contains( $GLOBALS['ishi_bridge_test_log'][0], 'private' ), 'file log redacted' );

    $tempFile = tempnam( sys_get_temp_dir(), 'ishi-bridge-check-' );
    check( is_string( $tempFile ), 'temporary test fixture created' );
    try {
        $GLOBALS['ishi_bridge_test_log'] = [];
        $transcript = AI::transcribe( [ 'name' => 'test.wav', 'tmp_name' => $tempFile ] );
        check( $transcript instanceof \WP_Error, 'audio error contract' );
        check( count( $GLOBALS['ishi_bridge_test_log'] ) === 1, 'audio logged once' );
        check( str_contains( $GLOBALS['ishi_bridge_test_log'][0], 'category=rate_limit' ), 'audio category' );
        check( ! str_contains( $GLOBALS['ishi_bridge_test_log'][0], 'private' ), 'audio log redacted' );
    } finally {
        unlink( $tempFile );
    }

    echo "Ishi AI Bridge sanitized failure diagnostics: PASS\n";
}
