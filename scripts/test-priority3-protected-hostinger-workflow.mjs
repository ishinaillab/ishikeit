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
    "github.actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
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
