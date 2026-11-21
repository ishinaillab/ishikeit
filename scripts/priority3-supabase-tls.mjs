// Public, project-downloaded trust anchor for the protected Supabase PostgreSQL
// release controllers. Preserve BOTH certificate chain and hostname verification.
// CA fingerprint confirmed against the owner's authenticated Supabase dashboard
// and an independent real pooler TLS 1.3 handshake on 2026-11-22.
// This is not a credential; rotate deliberately before its 2031 expiry.
import {readFileSync} from "node:fs";
import {X509Certificate} from "node:crypto";

const EXPECTED_ROOT_SHA256=
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const ROOT_URL=new URL("../certificates/supabase-root-2021-ca.crt",import.meta.url);

export function validateSupabaseRootCa(ca){
  if(typeof ca!=="string"||!ca.startsWith("-----BEGIN CERTIFICATE-----"))
    throw Error("Supabase root certificate invalid");
  let cert;
  try{cert=new X509Certificate(ca)}
  catch{throw Error("Supabase root certificate invalid")}
  if(!cert.ca||cert.fingerprint256!==EXPECTED_ROOT_SHA256||
    !cert.subject.includes("CN=Supabase Root 2021 CA")||
    Date.now()<=Date.parse(cert.validFrom)||
    Date.now()>=Date.parse(cert.validTo))
    throw Error("Supabase root certificate trust validation failed");
  return ca;
}

export function verifiedSupabaseSsl(){
  return {ca:validateSupabaseRootCa(readFileSync(ROOT_URL,"utf8")),
    rejectUnauthorized:true};
}
