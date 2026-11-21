import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=new URL("../.github/workflows/priority3-protected-schema-release.yml",import.meta.url);
const workflow=readFileSync(file,"utf8").replace(/\r\n/gu,"\n");

function check(source){
  const s=source.replace(/\r\n/gu,"\n");
  const fragments=[
    "\non:\n  workflow_dispatch:\n",
    "\npermissions:\n  contents: read\n  actions: read\n",
    "group: ishikeit-priority3-privileged-release",
    "cancel-in-progress: false",
    "github.event_name == 'workflow_dispatch' && github.run_attempt == 1 && github.actor == 'ishinaillab' && github.triggering_actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
    "environment: ishikeit-priority3-production",
    "environment: ishikeit-provisioning",
    "needs: owner-approval",
    "ref: $"+ "{{ inputs.db_sha }}",
    "DATABASE_URL: $"+ "{{ secrets.ISHIKEIT_DATABASE_URL }}",
    "ref=\"vhmrliqemkfxblzsoyaz\"",
    "version: '3.2.0'",
    '[[ "$(git -C db-release rev-parse HEAD)" == "$ISHIKEIT_RELEASE_DB_SHA" ]]',
    "supabase db push --dry-run --skip-vault --remote=",
    "run: node scripts/priority3-protected-schema-lease.mjs",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm run build",
    "options: [preflight, apply, verify, reconcile]",
    "A protected release lease or unresolved hosted step blocks new migration",
    "if: inputs.operation == 'apply'",
    'require(len(versions)==45 and len(set(versions))==45, "Unexpected migration history")',
    'require(len(remote)==(45 if mode in ("verify","reconcile") else 44),',
    'require(len(remote)==45 and remote==versions, "Live migration acceptance failed")',
    "Native outbox write fence missing or disabled",
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
  ];
  for(const fragment of fragments)
    assert.ok(s.includes(fragment),"Missing schema release control: "+fragment.slice(0,65));
  assert.equal(s.split("node scripts/verify-priority3-github-release.mjs").length-1,2);
  assert.equal(s.split("ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}").length-1,4);
  const stages=s.split("\n  production-migration:\n");
  assert.equal(stages.length,2);
  const identity="github.event_name == 'workflow_dispatch' && github.run_attempt == 1 && github.actor == 'ishinaillab' && github.triggering_actor == 'ishinaillab' && github.ref == 'refs/heads/main'";
  assert.ok(stages[0].includes("  owner-approval:\n    if: "+identity+"\n"),
    "First owner environment must reject reruns and foreign initiators");
  assert.ok(stages[1].includes(
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success' && "+identity+"\n"),
    "Privileged database environment must independently deny owner reruns");
  for(const guard of [
    '[[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]',
    '[[ "$GITHUB_ACTOR" == "ishinaillab" ]]',
    '[[ "$GITHUB_TRIGGERING_ACTOR" == "ishinaillab" ]]',
    '[[ "$GITHUB_RUN_ATTEMPT" == "1" ]]',
    '[[ "$GITHUB_REF" == "refs/heads/main" ]]'
  ]){
    assert.equal(stages[0].split(guard).length-1,1,"Initial job guard missing: "+guard);
    assert.equal(stages[1].split(guard).length-1,1,"Migration job guard missing: "+guard);
  }
  assert.doesNotMatch(stages[0],/secrets\.[A-Za-z_]+|DATABASE_URL\s*:/u);
  assert.doesNotMatch(s,/^\s+(?:push|pull_request|schedule|repository_dispatch):\s*$/mu);
  assert.doesNotMatch(s,/\bdb reset\b|migration repair|--include-roles|--include-seed/u);
  const versions=["20261115013500","20261115021500","20261115030147",
    "20261115040000","20261115040500","20261118222000"];
  for(const v of versions)assert.ok(s.includes(v));
  assert.equal((s.match(/supabase db push /gu)||[]).length,1);
  assert.equal((s.match(/run: node scripts\/priority3-protected-schema-lease\.mjs/gu)||[]).length,2);
  assert.ok(s.includes('require(busy in ("false","f"),'),
    "Must fail closed on a pending or active existing release lease");
  assert.ok(s.includes(
    "      - name: Apply migration only under durable exclusive lease and external-step hold\n"+
    "        if: inputs.operation == 'apply'\n"+
    "        env:\n          ISHIKEIT_GITHUB_READBACK_TOKEN:"),
    "Only exact apply operation may invoke privileged SQL mutation");
  assert.ok(s.includes(
    "      - name: Reconcile an expired schema-migration hold only after exact live readback\n"+
    "        if: inputs.operation == 'reconcile'\n"+
    "        env:\n          ISHIKEIT_GITHUB_READBACK_TOKEN:"),
    "Only exact reconcile operation may resolve pending hosted schema mutation");
}
test("owner-approved migration workflow is manual, serial, and SQL-only",()=>check(workflow));
const mutations=[
  ["accept obsolete 44-migration history",s=>s.replace(
    'require(len(versions)==45 and len(set(versions))==45, "Unexpected migration history")',
    'require(len(versions)==44 and len(set(versions))==44, "Unexpected migration history")')],
  ["omit newly required native guard version",s=>s.replace(
    '"20261115040500","20261118222000"', '"20261115040500"')],
  ["skip active native write-fence proof",s=>s.replace(
    'require(active=="true" or active=="t", "Native outbox write fence missing or disabled")',
    'print("skip the guard")')],
  ["permit original-actor rerun at first environment",s=>s.replace(
    "  owner-approval:\n    if: "+"github.event_name == 'workflow_dispatch' && github.run_attempt == 1 && github.actor == 'ishinaillab' && github.triggering_actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
    "  owner-approval:\n    if: github.actor == 'ishinaillab'")],
  ["permit rerun at privileged database environment",s=>s.replace(
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success' && "+"github.event_name == 'workflow_dispatch' && github.run_attempt == 1 && github.actor == 'ishinaillab' && github.triggering_actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success'")],
  ["remove execution runtime first-attempt check",s=>s.replace(
    '[[ "$GITHUB_RUN_ATTEMPT" == "1" ]]', 'echo skipped first-attempt check')],
  ["remove owner initiator runtime proof",s=>s.replace(
    '[[ "$GITHUB_TRIGGERING_ACTOR" == "ishinaillab" ]]', 'echo skipped initiator proof')],
  ["drop Vault suppression from dry run",s=>s.replace("--dry-run --skip-vault","--dry-run")],
  ["bypass durable schema mutation lease with direct CLI",s=>s.replace(
    "run: node scripts/priority3-protected-schema-lease.mjs",
    'run: supabase db push --yes --remote="$DATABASE_URL"')],
  ["change owner authorization",s=>s.replace("github.actor == 'ishinaillab'","github.actor != 'ishinaillab'")],
  ["replace owner deployment environment",s=>s.replace("environment: ishikeit-priority3-production","environment: unprotected")],
  ["replace database environment",s=>s.replace("environment: ishikeit-provisioning","environment: unprotected")],
  ["cancel a live migration",s=>s.replace("cancel-in-progress: false","cancel-in-progress: true")],
  ["change exclusivity group",s=>s.replace("ishikeit-priority3-privileged-release","other-release")],
  ["change Supabase project",s=>s.replace('ref="vhmrliqemkfxblzsoyaz"','ref="wrong"')],
  ["add automatic push trigger",s=>s.replace("\non:\n","\non:\n  push:\n")],
  ["remove one head preflight",s=>s.replace("node scripts/verify-priority3-github-release.mjs","echo skipped")],
  ["disable controller build",s=>s.replace("npm run build","echo skip")],
  ["disable schema lease busy admission",s=>s.replace(
    'require(busy in ("false","f"),', 'print("skip lease busy admission")')],
  ["remove schema reconcile operation",s=>s.replace(
    "options: [preflight, apply, verify, reconcile]",
    "options: [preflight, apply, verify]")],
  ["drop authenticated GitHub readback",s=>s.replace("ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}","ISHIKEIT_GITHUB_READBACK_TOKEN: missing")],
  ["remove controller apply authorization",s=>s.replace(
    "        if: inputs.operation == 'apply'\n        env:\n          ISHIKEIT_GITHUB_READBACK_TOKEN:",
    "        if: inputs.operation == 'verify'\n        env:\n          ISHIKEIT_GITHUB_READBACK_TOKEN:")],
  ["remove offline schema guard from protected workflow",s=>s.replace(
    "Native outbox write fence missing or disabled",
    "Unverified native outbox write fence")],
  ["drop GitHub Actions read permission",s=>s.replace("  actions: read\n","")],
  ["drop DB checkout SHA check",s=>s.replace('[[ "$(git -C db-release rev-parse HEAD)" == "$ISHIKEIT_RELEASE_DB_SHA" ]]',"echo skipped")],
  ["expose credentials in initial job",s=>s.replace("    environment: ishikeit-priority3-production\n","    environment: ishikeit-priority3-production\n    env:\n      DATABASE_URL: $"+ "{{ secrets.ISHIKEIT_DATABASE_URL }}\n")]
];
for(const [name,mutate] of mutations){
  test("reject "+name,()=>{
    const changed=mutate(workflow);
    assert.notEqual(changed,workflow,"Mutation did not apply: "+name);
    assert.throws(()=>check(changed));
  });
}
