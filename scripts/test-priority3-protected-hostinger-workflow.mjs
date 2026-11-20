import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(new URL("../.github/workflows/priority3-protected-hostinger-release.yml",import.meta.url),"utf8").replace(/\r\n/gu,"\n");
const source=readFileSync(new URL("priority3-protected-hostinger-release.mjs",import.meta.url),"utf8");
function check(w){
  const essential=[
    "\non:\n  workflow_dispatch:\n",
    "options: [preflight, deploy, reconcile]",
    "permissions:\n  contents: read\n  actions: read",
    "group: ishikeit-priority3-privileged-release",
    "cancel-in-progress: false",
    "github.actor == 'ishinaillab'",
    "environment: ishikeit-priority3-production",
    "environment: ishikeit-provisioning",
    "needs: owner-approval",
    "ISHIKEIT_RELEASE_APP_SHA:",
    "ISHIKEIT_RELEASE_DB_SHA:",
    "ISHIKEIT_EXPECTED_HOSTINGER_BUILD_UUID:",
    "ISHIKEIT_EXPECTED_HOSTINGER_BUILD_SHA:",
    "ISHIKEIT_RELEASE_OPERATION:",
    "ISHIKEIT_DATABASE_URL: $"+"{{ secrets.ISHIKEIT_DATABASE_URL }}",
    "ISHIKEIT_HOSTINGER_API_TOKEN: $"+"{{ secrets.ISHIKEIT_HOSTINGER_API_TOKEN }}",
    "ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}",
    "node scripts/verify-priority3-github-release.mjs",
    "node scripts/priority3-protected-hostinger-release.mjs",
    "npm ci --ignore-scripts",
    "test -n \"$ISHIKEIT_HOSTINGER_API_TOKEN\""
  ];
  for(const e of essential)assert.ok(w.includes(e),"Missing guarded workflow contract: "+e);
  const parts=w.split("\n  hostinger-runtime-release:\n");
  assert.equal(parts.length,2);
  assert.doesNotMatch(parts[0],/ISHIKEIT_HOSTINGER_API_TOKEN|ISHIKEIT_DATABASE_URL|secrets\./u);
  assert.match(parts[0],/environment: ishikeit-priority3-production/u);
  assert.match(parts[1],/environment: ishikeit-provisioning/u);
  assert.equal((w.match(/node scripts\/verify-priority3-github-release.mjs/gu)||[]).length,2);
  assert.equal((w.match(/ISHIKEIT_GITHUB_READBACK_TOKEN: \$\{\{ github.token \}\}/gu)||[]).length,2);
  assert.equal((w.match(/node scripts\/priority3-protected-hostinger-release.mjs/gu)||[]).length,1);
  assert.doesNotMatch(w,/^\s+(?:push|pull_request|schedule|repository_dispatch):/mu);
  assert.doesNotMatch(w,/uses: [^\n]*@main/u);
}
test("release controller workflow is manually triggered, exclusive and both owner-approved",()=>check(workflow));
const changes=[
  ["turn on push",s=>s.replace("  workflow_dispatch:\n","  push:\n  workflow_dispatch:\n")],
  ["remove initial approval",s=>s.replace("environment: ishikeit-priority3-production","environment: no-owner")],
  ["remove final approval",s=>s.replace("environment: ishikeit-provisioning","environment: no-secret-guard")],
  ["use another concurrency group",s=>s.replace("ishikeit-priority3-privileged-release","unrelated-group")],
  ["cancel running deployments",s=>s.replace("cancel-in-progress: false","cancel-in-progress: true")],
  ["ignore exact GitHub head",s=>s.replace("node scripts/verify-priority3-github-release.mjs","echo bypass")],
  ["expose Hostinger secret in first approval",s=>s.replace("environment: ishikeit-priority3-production",
    "environment: ishikeit-priority3-production\n    env:\n      ISHIKEIT_HOSTINGER_API_TOKEN: $"+"{{ secrets.ISHIKEIT_HOSTINGER_API_TOKEN }}")],
  ["expose database secret in first approval",s=>s.replace("environment: ishikeit-priority3-production",
    "environment: ishikeit-priority3-production\n    env:\n      ISHIKEIT_DATABASE_URL: $"+"{{ secrets.ISHIKEIT_DATABASE_URL }}")],
  ["drop GitHub token",s=>s.replace("ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}","ISHIKEIT_GITHUB_READBACK_TOKEN: absent")],
  ["drop legacy build compare",s=>s.replace("ISHIKEIT_EXPECTED_HOSTINGER_BUILD_UUID:", "UNSAFE_UUID:")],
  ["skip script",s=>s.replace("node scripts/priority3-protected-hostinger-release.mjs","echo unsafe")],
  ["skip secret gate",s=>s.replace("test -n \"$ISHIKEIT_HOSTINGER_API_TOKEN\"","true")],
  ["enable script lifecycle attacks",s=>s.replace("npm ci --ignore-scripts","npm install")],
  ["give code write permissions",s=>s.replace("contents: read","contents: write")]
];
for(const [name,change] of changes)test("reject "+name,()=>{
  const s=change(workflow);assert.notEqual(s,workflow);
  assert.throws(()=>check(s));
});
const firstAttemptOwnerGuard="github.event_name == 'workflow_dispatch' && "+
  "github.run_attempt == 1 && github.actor == 'ishinaillab' && "+
  "github.triggering_actor == 'ishinaillab' && "+
  "github.ref == 'refs/heads/main'";
const shellOwnerGuard=[
  '[[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]',
  '[[ "$GITHUB_ACTOR" == "ishinaillab" ]]',
  '[[ "$GITHUB_TRIGGERING_ACTOR" == "ishinaillab" ]]',
  '[[ "$GITHUB_RUN_ATTEMPT" == "1" ]]',
  '[[ "$GITHUB_REF" == "refs/heads/main" ]]'
];
function verifyOwnerRerunFence(w){
  const parts=w.split("\n  hostinger-runtime-release:\n");
  assert.equal(parts.length,2,"Expected the two independent release stages");
  assert.ok(parts[0].includes(
    "  owner-approval:\n    if: "+firstAttemptOwnerGuard+"\n"),
    "Initial owner environment must reject foreign/rerun authorization");
  assert.ok(parts[1].includes(
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success' && "+
    firstAttemptOwnerGuard+"\n"),
    "Privileged runtime environment must independently reject foreign/rerun authorization");
  for(const guard of shellOwnerGuard){
    assert.equal(parts[0].split(guard).length-1,1,
      "Initial owner job must re-validate at runtime: "+guard);
    assert.equal(parts[1].split(guard).length-1,1,
      "Privileged Hostinger job must re-validate at runtime: "+guard);
  }
}
test("release workflow independently denies reruns and foreign triggering actor at both stages",()=>
  verifyOwnerRerunFence(workflow));
const rerunMutations=[
  ["initial job allows original-actor rerun",s=>s.replace(
    "  owner-approval:\n    if: "+firstAttemptOwnerGuard,
    "  owner-approval:\n    if: github.actor == 'ishinaillab' && github.ref == 'refs/heads/main'")],
  ["execution job reuses prior owner approval",s=>s.replace(
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success' && "+firstAttemptOwnerGuard,
    "    needs: owner-approval\n    if: needs.owner-approval.result == 'success'")],
  ["initial job permits foreign rerun initiator",s=>s.replace(
    "  owner-approval:\n    if: "+firstAttemptOwnerGuard,
    "  owner-approval:\n    if: "+firstAttemptOwnerGuard.replace(
      " && github.triggering_actor == 'ishinaillab'",""))],
  ["runtime omits explicit first-attempt validation",s=>s.replace(
    shellOwnerGuard[3],": # omitted first-attempt shell guard")],
  ["runtime omits triggering actor validation",s=>s.replace(
    shellOwnerGuard[2],": # omitted triggering actor shell guard")]
];
for(const [label,mutate] of rerunMutations)test("reject "+label,()=>{
  const changed=mutate(workflow);
  assert.notEqual(changed,workflow);
  assert.throws(()=>verifyOwnerRerunFence(changed));
});

test("controller source arms before POST, renews lease and never unarms failed external actions",()=>{
  const phrases=[
    "await fence.arm(cfg);didArm=true;",
    "const uuid=await api.start();",
    "await fence.renew(cfg);",
    "await api.assertAutoOff();",
    "await assertGitHeads(fetcher,githubToken,cfg);",
    "await assertHealth(fetcher);",
    "await fence.resolve(cfg);finished=true;",
    "if(!didArm&&!finished&&fence.acquired)"
  ];
  for(const p of phrases)assert.ok(source.includes(p),"Missing source safety "+p);
  assert.ok(source.indexOf("await fence.arm(cfg);didArm=true;")<source.indexOf("const uuid=await api.start();"));
  assert.doesNotMatch(source,/\bDROP TABLE\b|\bDELETE FROM public\.ishikeit_release_ownership\b/iu);
});

const ciWorkflow=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8")
  .replace(/\r\n/gu,"\n");
function assertRealPgHostingerAcceptance(ci){
  const jobs=ci.split("\n  outbox-postgres-integration:\n");
  assert.equal(jobs.length,2,"Real Hostinger release SQL verification must be in PG17 CI job");
  const pgJob=jobs[1].split("\n  php-lint:\n")[0];
  const before="node --test scripts/test-priority3-protected-schema-release-e2e-postgres.mjs";
  const testCommand="node --test scripts/test-priority3-protected-hostinger-e2e-postgres.mjs";
  const after="node scripts/test-disposable-postgres-restart.mjs";
  assert.ok(pgJob.includes(before)&&pgJob.includes(testCommand)&&pgJob.includes(after),
    "Real Hostinger release controller SQL test not part of protected PG17 CI");
  assert.ok(pgJob.indexOf(before)<pgJob.indexOf(testCommand)&&
    pgJob.indexOf(testCommand)<pgJob.indexOf(after),
    "Hostinger SQL acceptance must run after schema fixture cleanup and before restart");
  assert.equal((ci.match(/node --test scripts\/test-priority3-protected-hostinger-e2e-postgres\.mjs/gu)||[]).length,1,
    "Must execute the real Hostinger PG17 fixture exactly once");
  const section=pgJob.split(testCommand)[0].split(
    "      - name: Verify real Hostinger external-step lease").at(-1);
  assert.ok(section?.includes("PG_OUTBOX_TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/ishikeit_outbox_test"),
    "Hostinger release e2e must be bound only to the disposable PG17 database");
}
test("protected CI executes real Hostinger SQL lease and recovery acceptance",()=>
  assertRealPgHostingerAcceptance(ciWorkflow));
test("protected CI rejects omission of actual Hostinger PostgreSQL acceptance",()=>{
  const changed=ciWorkflow.replace(
    "node --test scripts/test-priority3-protected-hostinger-e2e-postgres.mjs",
    "echo skip-hostinger-real-pg-acceptance");
  assert.notEqual(changed,ciWorkflow);
  assert.throws(()=>assertRealPgHostingerAcceptance(changed));
});
