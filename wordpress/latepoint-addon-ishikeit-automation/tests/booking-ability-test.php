<?php
declare(strict_types=1);
define('ABSPATH', '/wordpress/');
final class WP_Error {
    private string $code;
    private string $message;
    public function __construct(string $code, string $message) { $this->code=$code; $this->message=$message; }
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
}
function is_wp_error($x): bool { return $x instanceof WP_Error; }
function wp_timezone(): DateTimeZone { return new DateTimeZone('Asia/Manila'); }
function wp_parse_url(string $url, int $part = -1) { return parse_url($url, $part); }
function is_user_logged_in(): bool { return true; }
function current_user_can(string $cap): bool { return $cap==='read'; }
function add_action(string $tag, $callback, int $priority=10): void { $GLOBALS['hooks'][]=[$tag,$callback,$priority]; }
function wp_register_ability(string $name, array $definition): void { $GLOBALS['registered'][$name]=$definition; }
function get_option(string $name, $default=null) { return $name==='ishi_latepoint_instant_settings'
    ? $GLOBALS['booking_settings'] : $default; }
function wp_get_ability(string $name) { return $GLOBALS['abilities'][$name] ?? null; }

final class FakeAbility {
    public int $calls=0;
    private $fn;
    public function __construct(callable $fn) { $this->fn=$fn; }
    public function execute(array $args) { $this->calls++; return ($this->fn)($args); }
}

require dirname(__DIR__).'/latepoint-addon-ishikeit-automation.php';
$GLOBALS['booking_settings']=['selected_service'=>'1','selected_agent'=>'15'];
Ishi_LatePoint_Automation::register_ability();
$definition=$GLOBALS['registered']['ishi/verify-and-generate-booking-link'] ?? null;
assert_true(is_array($definition), 'WordPress ability registration');
assert_true($definition['meta']['annotations']['readonly']===true,'readonly declaration');
assert_true($definition['meta']['public'] === true && $definition['meta']['show_in_rest'] === true,'client discoverability requires authentication');
assert_true($definition['permission_callback']===['Ishi_LatePoint_Automation','can_execute'], 'correct permission');
$date=(new DateTimeImmutable('tomorrow',wp_timezone()))->format('Y-m-d');
$slot=['date'=>$date,'start_time'=>480];
function assert_true(bool $condition,string $message): void { if(!$condition) throw new RuntimeException($message); }
function mock_abilities(bool $available=true): void {
    $GLOBALS['abilities']=[
      'latepoint/check-slot-availability'=>new FakeAbility(static function(array $args) use ($available) {
          assert_true($args['service_id']===1 && $args['agent_id']===15,'canonical service and agent');
          return ['available'=>$available,'conflicts'=>[['customer_email'=>'PRIVATE']]];
      }),
      'latepoint/get-available-slots'=>new FakeAbility(static function(array $args) {
          return ['slots'=>[
            ['start_time'=>480,'end_time'=>660,'agent_id'=>15],
            ['start_time'=>540,'end_time'=>720,'agent_id'=>15],
            ['start_time'=>600,'end_time'=>780,'agent_id'=>15],
            ['start_time'=>660,'end_time'=>840,'agent_id'=>99]
          ]];
      }),
      'ishi/generate-booking-link'=>new FakeAbility(static function(array $args) {
          assert_true($args['service_id']===1 && $args['agent_id']===15,'link canonical identity');
          return ['url'=>'https://www.ishinaillab.com/?ishi_booking_slot=test-signature'];
      })
    ];
}
mock_abilities(true);
$ok=Ishi_LatePoint_Automation::execute($slot);
assert_true($ok['status']==='available' && $ok['bookable']===true,'valid slot accepted');
assert_true(isset($ok['url']) && $ok['hold_visibility']==='disabled','valid URL and disabled hold');
assert_true($GLOBALS['abilities']['latepoint/check-slot-availability']->calls===1,'exactly one recheck');
assert_true($GLOBALS['abilities']['ishi/generate-booking-link']->calls===1,'generate after check');
assert_true(!str_contains(json_encode($ok),'PRIVATE'),'private conflict never exposed');

mock_abilities(false);
$unavailable=Ishi_LatePoint_Automation::execute($slot);
assert_true($unavailable['status']==='unavailable' && !isset($unavailable['url']),'unavailable never produces URL');
assert_true($unavailable['alternatives']===[540,600], 'only canonical-staff later alternatives');
assert_true($GLOBALS['abilities']['ishi/generate-booking-link']->calls===0,'no link for unavailable');

mock_abilities(true);
$excluded=Ishi_LatePoint_Automation::execute($slot+['excluded_start_times'=>[480,600]]);
assert_true($excluded['status']==='declined' && !isset($excluded['url']), 'never suggest customer-rejected slot');
assert_true($excluded['alternatives']===[540],'declined times removed');
assert_true($GLOBALS['abilities']['latepoint/check-slot-availability']->calls===0,'excluded time never invokes availability check');

mock_abilities(true);
$GLOBALS['abilities']['latepoint/check-slot-availability']=new FakeAbility(static fn()=>new WP_Error('network','unavailable'));
$f=Ishi_LatePoint_Automation::execute($slot);
assert_true($f['status']==='verification_unavailable' && !isset($f['url']),'fail closed when latepoint unavailable');

mock_abilities(true);
$GLOBALS['booking_settings']=['selected_service'=>'','selected_agent'=>'15'];
$bad=Ishi_LatePoint_Automation::execute($slot);
assert_true(is_wp_error($bad) && $bad->get_error_code()==='ishi_booking_context_missing','invalid technical service rejected');
echo "PASS 5 booking safety scenarios (native availability, unavailability, rejected slot, provider failure, missing context).\n";
