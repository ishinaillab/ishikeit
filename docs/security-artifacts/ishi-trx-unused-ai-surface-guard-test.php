<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
define('ABSPATH',__DIR__);
$GLOBALS['callbacks']=array();
$GLOBALS['capability']=false;
function add_action($name,$callback,$priority=10){$GLOBALS['callbacks'][$name]=$callback;}
function add_filter($name,$callback,$priority=10){$GLOBALS['callbacks'][$name]=$callback;}
function wp_doing_ajax(){return true;}
function current_user_can($cap){return $GLOBALS['capability'];}
function wp_send_json_error($data,$status=200){throw new RuntimeException('BLOCK_'.$status);}
class WP_Error {
 public $code;public $data;
 public function __construct($code,$message,$data){$this->code=$code;$this->data=$data;}
}
require __DIR__.'/wp-content/mu-plugins/ishi-trx-unused-ai-surface-guard.php';
$cases=array(
 'trx_addons_ai_helper_process_selection'=>'block',
 'trx_addons_ai_helper_fetch_images'=>'block',
 'trx_addons_ai_helper_speech_to_text'=>'block',
 'trx_addons_ai_helper_chat'=>'block',
 'trx_addons_ai_helper_tgenerator'=>'block',
 'trx_addons_ai_assistant_add_support'=>'block',
 'trx_addons_download_addon'=>'admin_only',
 'trx_addons_importer_start_import'=>'admin_only',
 'trx_addons_ocdi_demo_settings_change'=>'admin_only',
 'trx_addons_woo_products_add_product_to_cart'=>'allow',
 'trx_addons_action_get_post'=>'allow',
 'trx_addons_instagram_load_images'=>'allow',
 'latepoint_route_call'=>'allow',
 'woocommerce_add_to_cart'=>'allow',
 'ishi_ai_respond'=>'allow'
);
$passed=0;
foreach($cases as $action=>$expected) {
 if(ishi_trx_isolated_ajax_decision($action)!==$expected)throw new RuntimeException('predicate failed: '.$action);
 $GLOBALS['capability']=false;$_REQUEST['action']=$action;
 $blocked=false;
 try{$GLOBALS['callbacks']['admin_init']();}catch(RuntimeException $e){$blocked=$e->getMessage()==='BLOCK_403';}
 if($blocked!==($expected!=='allow'))throw new RuntimeException('low privilege failed: '.$action);
 $GLOBALS['capability']=true;$_REQUEST['action']=$action;
 $blocked=false;
 try{$GLOBALS['callbacks']['admin_init']();}catch(RuntimeException $e){$blocked=$e->getMessage()==='BLOCK_403';}
 if($blocked!==($expected==='block'))throw new RuntimeException('admin failed: '.$action);
 $passed++;
}
$request=new class{public function get_route(){return '/ai-helper/v1/get-response';}};
$rest=$GLOBALS['callbacks']['rest_pre_dispatch'](null,null,$request);
if(!$rest instanceof WP_Error||$rest->data['status']!==403)throw new RuntimeException('REST guard failed');
echo 'ISHI_GUARD_PREDICATE_AND_ROLE_TESTS_PASSED:'.$passed.PHP_EOL;
