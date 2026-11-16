import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(new URL("../.github/workflows/priority3-protected-database-backup.yml",import.meta.url),"utf8").replace(/\r\n/gu,"\n");
const recipient=readFileSync(new URL("../docs/ISHIKEIT_PRIORITY3_BACKUP_PUBLIC_RECIPIENT.txt",import.meta.url),"utf8").trim();

function verify(s){
  s=s.replace(/\r\n/gu,"\n");
  const must=[
    "\non:\n  workflow_dispatch:\n",
    "\npermissions:\n  contents: read\n  actions: read\n",
    "group: ishikeit-priority3-privileged-release",
    "cancel-in-progress: false",
    "github.actor == 'ishinaillab' && github.ref == 'refs/heads/main'",
    "environment: ishikeit-priority3-production",
    "environment: ishikeit-provisioning",
    "needs: owner-approval",
    "DATABASE_URL: $"+"{{ secrets.ISHIKEIT_DATABASE_URL }}",
    "ref: $"+"{{ inputs.db_sha }}",
    "ref=\"vhmrliqemkfxblzsoyaz\"",
    "supabase db dump --remote=\"$DATABASE_URL\" --role-only",
    "supabase db dump --remote=\"$DATABASE_URL\" --file",
    "supabase db dump --remote=\"$DATABASE_URL\" --data-only --use-copy",
    "-x storage.buckets_vectors -x storage.vector_indexes",
    "version: '3.1.0'",
    "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10",
    "age-v1.3.2-linux-amd64.tar.gz",
    "docs/ISHIKEIT_PRIORITY3_BACKUP_PUBLIC_RECIPIENT.txt",
    "\"$agebin\" --encrypt",
    "-o \"$d/backup.age\"",
    "stat -c %s \"$d/backup.age\"",
    "test \"$bytes\" -lt 104857600",
    "uses: actions/upload-artifact@v4",
    "path: $"+"{{ steps.encrypt.outputs.artifact_path }}",
    "retention-days: 7",
    "shred --remove",
    "if: always()"
  ];
  for(const part of must)assert.ok(s.includes(part),"Required backup protection absent: "+part.slice(0,74));
  assert.equal(s.split("node scripts/verify-priority3-github-release.mjs").length-1,2);
  assert.equal(s.split("ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}").length-1,2);
  assert.equal(s.split("environment: ishikeit-provisioning").length-1,1);
  assert.equal(s.split("uses: actions/upload-artifact@v4").length-1,1);
  const stages=s.split("\n  encrypted-logical-backup:\n");
  assert.equal(stages.length,2);
  assert.doesNotMatch(stages[0],/DATABASE_URL|secrets\./u);
  assert.doesNotMatch(s,/^\s+(?:push|pull_request|schedule|repository_dispatch):\s*$/mu);
  assert.doesNotMatch(s,/\bdb reset\b|db push|migration repair|--include-seed|--include-roles/u);
  assert.doesNotMatch(s,/path:.*(?:data\.sql|schema\.sql|roles\.sql|backup\.tar\.gz)/u);
  assert.equal((s.match(/supabase db dump /gu)||[]).length,3);
  assert.match(recipient,/^age1pq1[a-z0-9]{200,}$/u);
  assert.doesNotMatch(recipient,/AGE-SECRET|PRIVATE KEY|[\s]/u);
}
test("encrypted backup source passes protected owner and ciphertext-only controls",()=>verify(workflow));
const modifications=[
  ["remove initial owner approval",s=>s.replace("github.actor == 'ishinaillab'","github.actor != 'ishinaillab'")],
  ["expose database URL before first approval",s=>s.replace("    environment: ishikeit-priority3-production\n","    environment: ishikeit-priority3-production\n    env:\n      DATABASE_URL: $"+"{{ secrets.ISHIKEIT_DATABASE_URL }}\n")],
  ["remove second approval",s=>s.replace("environment: ishikeit-provisioning","environment: unprotected")],
  ["allow other DB project",s=>s.replace('ref="vhmrliqemkfxblzsoyaz"','ref="wrong"')],
  ["enable automatic execution",s=>s.replace("\non:\n","\non:\n  push:\n")],
  ["cancel in-flight backup",s=>s.replace("cancel-in-progress: false","cancel-in-progress: true")],
  ["remove authenticated release readback",s=>s.replace("ISHIKEIT_GITHUB_READBACK_TOKEN: $"+"{{ github.token }}","ISHIKEIT_GITHUB_READBACK_TOKEN: missing")],
  ["remove actions read permission",s=>s.replace("  actions: read\n","")],
  ["remove current rules recheck",s=>s.replace("node scripts/verify-priority3-github-release.mjs","echo skipped")],
  ["drop role export",s=>s.replace('supabase db dump --remote="$DATABASE_URL" --role-only','supabase db dump --remote="$DATABASE_URL" --no-role')],
  ["drop archive encryption",s=>s.replace('"$agebin" --encrypt','echo unencrypted')],
  ["upload plaintext data",s=>s.replace("path: $"+"{{ steps.encrypt.outputs.artifact_path }}","path: $RUNNER_TEMP/ishikeit-priority3-db-backup/data.sql")],
  ["extend encrypted artifact retention",s=>s.replace("retention-days: 7","retention-days: 90")],
  ["remove age pin",s=>s.replace("cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10","unknown")],
  ["remove size limit",s=>s.replace('test "$bytes" -lt 104857600',"true")],
  ["remove cleanup",s=>s.replace("shred --remove","echo keep-plaintext")]
];
for(const [name,edit] of modifications)test("reject "+name,()=>{
  const changed=edit(workflow);
  assert.notEqual(changed,workflow);
  assert.throws(()=>verify(changed));
});
