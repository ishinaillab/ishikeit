import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {X509Certificate} from "node:crypto";
import {verifiedSupabaseSsl,validateSupabaseRootCa} from "./priority3-supabase-tls.mjs";

const FINGERPRINT="80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

test("official project CA is pinned and preserves Node certificate/hostname verification",()=>{
  const cfg=verifiedSupabaseSsl();
  assert.equal(cfg.rejectUnauthorized,true);
  assert.equal(typeof cfg.ca,"string");
  const root=new X509Certificate(cfg.ca);
  assert.equal(root.fingerprint256,FINGERPRINT);
  assert.equal(root.ca,true);
  assert.match(root.subject,/CN=Supabase Root 2021 CA/u);
  assert.ok(Date.parse(root.validTo)>Date.now(),"Root CA expired");
});
test("reject forged, untrusted or malformed Supabase root CA",()=>{
  for(const candidate of [
    "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----",
    "",undefined
  ])assert.throws(()=>validateSupabaseRootCa(candidate),/root|certificate|trust|invalid/i);
});
test("both protected live release controllers use exactly the pinned CA",()=>{
  for(const name of ["priority3-protected-schema-lease.mjs",
    "priority3-protected-hostinger-release.mjs"]){
    const source=readFileSync(new URL("./"+name,import.meta.url),"utf8");
    assert.match(source,/verifiedSupabaseSsl\(\)/u,name+" must configure actual pg.Client");
    assert.doesNotMatch(source,/rejectUnauthorized:\s*false/u);
  }
});
