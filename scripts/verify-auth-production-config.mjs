import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Supabase Management API credential is NOT the Supabase Auth project
 * sb_secret key. Requires a separate read-only scoped personal access token
 * with auth_config_read. Never logs Auth config: it may contain SMTP secrets.
 */
export const ISHIKEIT_AUTH_REDIRECT = "https://apps.ishinaillab.com/app/login";
export async function verifyAuthProductionConfiguration({
  projectUrl,managementToken,fetchImpl=fetch
}){
  const project=new URL(projectUrl);
  if(project.protocol!=="https:" ||
    !/^[a-z0-9]{20}\.supabase\.co$/u.test(project.hostname) ||
    project.pathname!=="/" || project.search || project.hash ||
    project.username || project.password || project.port)
    throw new Error("Invalid Supabase project origin");
  if(typeof managementToken!=="string" ||
    managementToken.length<20 || managementToken.length>2048 ||
    !/^[A-Za-z0-9._-]+$/u.test(managementToken))
    throw new Error("Approved Auth configuration-read credential required");
  let r;
  try{
    r=await fetchImpl(
      "https://api.supabase.com/v1/projects/"+project.hostname.split(".")[0]+"/config/auth",
      {method:"GET",redirect:"error",cache:"no-store",
        headers:{authorization:"Bearer "+managementToken,accept:"application/json"},
        signal:AbortSignal.timeout(8000)}
    );
  }catch{throw new Error("Auth configuration verification unavailable");}
  if(!r.ok)throw new Error("Auth configuration verification unavailable");
  const chunks=[];
  let bytes=0;
  const reader=r.body?.getReader();
  if(!reader)throw new Error("Auth configuration verification unavailable");
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      if(part.value===undefined)continue;
      bytes+=part.value.byteLength;
      if(bytes>131072){
        await reader.cancel().catch(()=>undefined);
        throw new Error("Auth configuration verification unavailable");
      }
      chunks.push(part.value);
    }
  }finally{reader.releaseLock();}
  let body;
  try{body=JSON.parse(Buffer.concat(chunks,bytes).toString("utf8"));}
  catch{throw new Error("Auth configuration verification unavailable");}
  if(!body || typeof body!=="object" || Array.isArray(body))
    throw new Error("Auth configuration verification unavailable");

  // Fail closed. A configured SMTP hostname alone cannot prove delivery.
  // A later real recipient-originated email test remains mandatory.
  const configuredSmtp=typeof body.smtp_host==="string" &&
    body.smtp_host.length>=4 && typeof body.smtp_user==="string" &&
    body.smtp_user.length>=1 && typeof body.smtp_admin_email==="string" &&
    /@(?:[a-z0-9-]+\.)*ishinaillab\.com$/iu.test(body.smtp_admin_email) &&
    Number.isInteger(Number(body.smtp_port)) &&
    Number(body.smtp_port)>0 && Number(body.smtp_port)<=65535;
  const redirectAllowed=typeof body.uri_allow_list==="string" &&
    body.uri_allow_list.split(",").map(x=>x.trim())
      .includes(ISHIKEIT_AUTH_REDIRECT);
  const inviteTemplate=typeof body.mailer_templates_invite_content==="string" &&
    /\{\{\s*\.ConfirmationURL\s*\}\}/u.test(body.mailer_templates_invite_content);
  const emailOtpTemplate=typeof body.mailer_templates_magic_link_content==="string" &&
    /\{\{\s*\.Token\s*\}\}/u.test(body.mailer_templates_magic_link_content);
  const allowed=body.external_email_enabled===true &&
    body.disable_signup===true && body.mailer_autoconfirm===false &&
    body.mfa_totp_enroll_enabled===true &&
    body.mfa_totp_verify_enabled===true &&
    body.refresh_token_rotation_enabled===true &&
    configuredSmtp && redirectAllowed && inviteTemplate && emailOtpTemplate;
  if(!allowed)throw new Error("Auth configuration is not safe for verified owner invitations");
  return {ready:true,redirect:ISHIKEIT_AUTH_REDIRECT};
}
if(process.argv[1]!==undefined &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    await verifyAuthProductionConfiguration({
      projectUrl:process.env.SUPABASE_AUTH_PROJECT_URL,
      managementToken:process.env.SUPABASE_MANAGEMENT_AUTH_READ_TOKEN
    });
    process.stdout.write("Supabase Auth read-only readiness verified; invite URL allowlisted.\n");
  }catch{
    // No secrets, SMTP account names, error responses or template HTML.
    process.stderr.write("Supabase production Auth readiness blocked.\n");
    process.exitCode=1;
  }
}
