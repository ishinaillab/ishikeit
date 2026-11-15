import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=new URL("../.github/workflows/priority3-protected-schema-release.yml",import.meta.url);
const workflow=readFileSync(file,"utf8").replace(/\r\n/gu,"\n");

function check(source){
  const s=source.replace(/\r\n/gu,"\n");
  const fragments=[
    "\non:\n  workflow_dispatch:\n",
    "\npermissions:\n  contents: read\n",
    "group: ishikeit-priority3-privileged-release",
    "cancel-in-progress: false",
    "github.actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
    "environment: ishikeit-priority3-production",
    "environment: ishikeit-provisioning",
    "needs: owner-approval",
    "ref: $"+ "{{ inputs.db_sha }}",
    "DATABASE_URL: $"+ "{{ secrets.ISHIKEIT_DATABASE_URL }}",
    "ref=\"vhmrliqemkfxblzsoyaz\"",
    "version: '3.1.0'",
    '[[ "$(git -C db-release rev-parse HEAD)" == "$ISHIKEIT_RELEASE_DB_SHA" ]]',
    "supabase db push --dry-run --skip-vault --remote=",
    "supabase db push --yes --skip-vault --remote=",
    "if: inputs.operation == 'apply'",
    "assert len(versions)==44 and len(set(versions))==44",
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
  ];
  for(const fragment of fragments)
    assert.ok(s.includes(fragment),"Missing schema release control: "+fragment.slice(0,65));
  assert.equal(s.split("node scripts/verify-priority3-github-release.mjs").length-1,2);
  const stages=s.split("\n  production-migration:\n");
  assert.equal(stages.length,2);
  assert.doesNotMatch(stages[0],/secrets\.[A-Za-z_]+|DATABASE_URL\s*:/u);
  assert.doesNotMatch(s,/^\s+(?:push|pull_request|schedule|repository_dispatch):\s*$/mu);
  assert.doesNotMatch(s,/\bdb reset\b|migration repair|--include-roles|--include-seed/u);
  const versions=["20261115013500","20261115021500","20261115030147",
    "20261115040000","20261115040500"];
  for(const v of versions)assert.ok(s.includes(v));
  assert.equal((s.match(/supabase db push /gu)||[]).length,2);
}
test("owner-approved migration workflow is manual, serial, and SQL-only",()=>check(workflow));
const mutations=[
  ["drop Vault suppression from dry run",s=>s.replace("--dry-run --skip-vault","--dry-run")],
  ["drop Vault suppression from apply",s=>s.replace("--yes --skip-vault","--yes")],
  ["change owner authorization",s=>s.replace("github.actor == 'ishinaillab'","github.actor != 'ishinaillab'")],
  ["replace owner deployment environment",s=>s.replace("environment: ishikeit-priority3-production","environment: unprotected")],
  ["replace database environment",s=>s.replace("environment: ishikeit-provisioning","environment: unprotected")],
  ["cancel a live migration",s=>s.replace("cancel-in-progress: false","cancel-in-progress: true")],
  ["change exclusivity group",s=>s.replace("ishikeit-priority3-privileged-release","other-release")],
  ["change Supabase project",s=>s.replace('ref="vhmrliqemkfxblzsoyaz"','ref="wrong"')],
  ["add automatic push trigger",s=>s.replace("\non:\n","\non:\n  push:\n")],
  ["remove one head preflight",s=>s.replace("node scripts/verify-priority3-github-release.mjs","echo skipped")],
  ["include seed",s=>s.replace("supabase db push --yes","supabase db push --include-seed --yes")],
  ["include roles",s=>s.replace("supabase db push --yes","supabase db push --include-roles --yes")],
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
