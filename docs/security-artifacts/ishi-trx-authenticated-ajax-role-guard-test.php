<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
define('ABSPATH', __DIR__);
$GLOBALS['actions'] = array();
$GLOBALS['cap'] = false;
$GLOBALS['public_hooks'] = array();
$GLOBALS['ajax'] = true;
function add_action($hook, $fn, $priority = 10) { $GLOBALS['actions'][$hook] = $fn; }
function has_action($hook) { return in_array($hook, $GLOBALS['public_hooks'], true) ? 0 : false; }
function wp_doing_ajax() { return $GLOBALS['ajax']; }
function current_user_can($cap) { return $GLOBALS['cap']; }
function wp_send_json_error($data, $status) { throw new RuntimeException('DENIED:' . $status); }
require __DIR__ . '/wp-content/mu-plugins/ishi-trx-authenticated-ajax-role-guard-v101.php';
$cases = array(
 array('trx_addons_importer_start_import', false, false, true),
 array('trx_addons_action_create_preset', false, false, true),
 array('trx_addons_download_addon', false, false, true),
 array('trx_addons_action_get_post', false, true, false),
 array('trx_addons_woo_products_add_product_to_cart', false, true, false),
 array('latepoint_route_call', false, false, false),
 array('woocommerce_add_to_cart', false, false, false),
 array('trx_addons_importer_start_import', true, false, false),
 array('trx_addons_action_create_preset', true, false, false),
 array(array('bad'), false, false, false),
);
foreach ($cases as $i => $case) {
 [$action, $cap, $public, $blocked] = $case;
 $GLOBALS['cap'] = $cap;
 $GLOBALS['public_hooks'] = $public && is_string($action) ? array('wp_ajax_nopriv_' . $action) : array();
 $_REQUEST['action'] = $action;
 $got = false;
 try { ($GLOBALS['actions']['admin_init'])(); }
 catch (RuntimeException $e) { $got = $e->getMessage() === 'DENIED:403'; }
 if ($got !== $blocked) { throw new RuntimeException('CASE_FAIL:' . $i); }
}
$GLOBALS['ajax'] = false;
$_REQUEST['action'] = 'trx_addons_importer_start_import';
($GLOBALS['actions']['admin_init'])();
echo 'ISHI_TRX_AJAX_BOUNDARY_TESTS_PASS:' . (count($cases) + 1) . PHP_EOL;
