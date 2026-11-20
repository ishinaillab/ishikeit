import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const yaml=readFileSync(
  new URL("../.github/workflows/priority3-protected-schema-release.yml",import.meta.url),
  "utf8"
).replace(/\r\n/gu,"\n");
const blocks=[...yaml.matchAll(/^( {10})python3 - <<'PY'\n([\s\S]*?)^ {10}PY[ \t]*$/gmu)]
  .map(m=>m[2].split("\n").map(line=>line.startsWith(m[1])
    ?line.slice(m[1].length):line).join("\n"));
const python=process.platform==="win32"?"python":"python3";
function execPython(code,env={},input){
  const result=spawnSync(python,["-c",code],{
    env:{...process.env,...env},input,encoding:"utf8",timeout:12000
  });
  assert.equal(result.error,undefined,"Python 3 syntax validator unavailable");
  return result;
}
test("both owner-protected SQL workflows have syntactically valid embedded Python",()=>{
  assert.equal(blocks.length,2,"Expected preflight and postmigration Python blocks");
  for(const block of blocks){
    const result=execPython("import ast,sys; ast.parse(sys.stdin.read())",{},block);
    assert.equal(result.status,0,result.stderr);
  }
});
test("protected migration shell must not use Python asserts that vanish under optimization",()=>{
  for(const block of blocks){
    const result=execPython(
      "import ast,sys; t=ast.parse(sys.stdin.read()); "+ 
      "n=sum(isinstance(v,ast.Assert) for v in ast.walk(t)); "+ 
      "print(n); sys.exit(1 if n else 0)",{},block);
    assert.equal(result.status,0,
      "Python -O/PYTHONOPTIMIZE would disable "+result.stdout.trim()+" release checks");
  }
});
test("production PostgreSQL URL identity rejects foreign hosts even with PYTHONOPTIMIZE=1",()=>{
  assert.equal(blocks.length,2);
  const cut=blocks[0].indexOf("versions=[]");
  assert.ok(cut>0,"Expected distinct URL identity gate");
  const prefix=blocks[0].slice(0,cut)+"\nprint('ACCEPTED')\n";
  const good=[
    "postgresql://postgres:fake@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/postgres",
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
  ];
  for(const url of good){
    const r=execPython(prefix,{PYTHONOPTIMIZE:"1",DATABASE_URL:url});
    assert.equal(r.status,0,"Expected exact production identity: "+r.stderr);
    assert.match(r.stdout,/ACCEPTED/u);
  }
  const bad=[
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:fake@other.supabase.com:5432/postgres",
    "postgresql://postgres:fake@db.other.supabase.co:5432/postgres",
    "postgresql://postgres:fake@db.vhmrliqemkfxblzsoyaz.supabase.co.evil.invalid:5432/postgres",
    "postgresql://postgres:fake@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/otherdb",
    "postgresql://postgres:fake@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/postgres?sslmode=disable",
    "postgresql://postgres:fake@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.wrong:fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
  ];
  for(const url of bad){
    const r=execPython(prefix,{PYTHONOPTIMIZE:"1",DATABASE_URL:url});
    assert.notEqual(r.status,0,"Unsafe foreign database URL was accepted");
    assert.doesNotMatch(r.stdout,/ACCEPTED/u);
  }
});
