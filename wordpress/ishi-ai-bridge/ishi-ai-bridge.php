<?php
/**
 * Plugin Name: Ishi AI Bridge
 * Description: Private, idempotent bridge from Ishikeit's durable processor to the configured AI Engine chatbot.
 * Version: 0.1.0
 * Author: Ishi Nail Lab
 * Requires at least: 6.9
 * Requires PHP: 8.1
 */

namespace Ishi\AIBridge;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'ISHI_AI_BRIDGE_VERSION', '0.1.0' );
define( 'ISHI_AI_BRIDGE_SCHEMA_VERSION', '1.1.0' );
define( 'ISHI_AI_BRIDGE_FILE', __FILE__ );
define( 'ISHI_AI_BRIDGE_DIR', __DIR__ );

require_once ISHI_AI_BRIDGE_DIR . '/includes/class-storage.php';
require_once ISHI_AI_BRIDGE_DIR . '/includes/class-auth.php';
require_once ISHI_AI_BRIDGE_DIR . '/includes/class-validation.php';
require_once ISHI_AI_BRIDGE_DIR . '/includes/class-ai.php';
require_once ISHI_AI_BRIDGE_DIR . '/includes/class-rest.php';
require_once ISHI_AI_BRIDGE_DIR . '/includes/class-admin.php';

function activate(): void {
    Storage::install();
    Admin::ensure_defaults();
}

function boot(): void {
    add_action(
        'plugins_loaded',
        static function (): void {
            if ( ISHI_AI_BRIDGE_SCHEMA_VERSION !== (string) get_option( Storage::SCHEMA_OPTION, '' ) ) {
                Storage::install();
            }
        },
        20
    );

    Rest::boot();
    Admin::boot();
}

register_activation_hook( __FILE__, __NAMESPACE__ . '\\activate' );
boot();
