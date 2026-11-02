import test from "node:test";
import assert from "node:assert/strict";
import { verifyAuthProductionConfiguration,ISHIKEIT_AUTH_REDIRECT } from "./verify-auth-production-config.mjs";

const projectUrl="https://abcdefghijklmnopqrst.supabase.co";
const managementToken="managed_config_read_only_token_123456789";
const valid={
  external_email_enabled:true,disable_signup:true,mailer_autoconfirm:false,
  smtp_host:"smtp.mail.example",smtp_port:587,smtp_user:"smtp-user",
  smtp_admin_email:"no-reply@ishinaillab.com",
  mailer_templates_invite_content:"<a href='{{ .ConfirmationURL }}'>Accept</a>",
  mailer_templates_magic_link_content:"Your code: {{ .Token }}",
  uri_allow_list:ISHIKEIT_AUTH_REDIRECT,
  mfa_totp_enroll_enabled:true,mfa_totp_verify_enabled:true,
  refresh_token_rotation_enabled:true,
  smtp_pass:"MUST NEVER EXPOSE",other_secret:"MUST NEVER EXPOSE"
};
function trusted(options={}){
  const calls=[];
  const check=verifyAuthProductionConfiguration({
    projectUrl,managementToken,
    fetchImpl:async(url,request)=>{
      calls.push({url,request});
      return new Response(JSON.stringify({...valid,...options}),{
        headers:{"content-type":"application/json"},status:200
      });
    }
  });
  return {check,calls};
}
test("checks official Management API read-only config and redacts all provider settings",async()=>{
  const {check,calls}=trusted();
  assert.deepEqual(await check,{ready:true,redirect:ISHIKEIT_AUTH_REDIRECT});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth");
  assert.equal(calls[0].request.method,"GET");
  assert.equal(calls[0].request.redirect,"error");
  assert.equal(calls[0].request.headers.authorization,"Bearer "+managementToken);
  assert.ok(!JSON.stringify(await check).includes("MUST NEVER EXPOSE"));
});
test("rejects missing redirect allowlist without relying on Site URL fallback",async()=>{
  await assert.rejects(trusted({uri_allow_list:"https://www.ishinaillab.com"}).check,/not safe/);
  await assert.rejects(trusted({uri_allow_list:ISHIKEIT_AUTH_REDIRECT+"/malicious"}).check,/not safe/);
});
test("denies insecure mail templates and automatic email confirmation",async()=>{
  const cases=[
    {mailer_templates_magic_link_content:"{{ .ConfirmationURL }}"},
    {mailer_templates_invite_content:"No official verification link"},
    {mailer_autoconfirm:true},
    {external_email_enabled:false},
    {disable_signup:false},
    {smtp_host:""},{smtp_user:""},
    {smtp_admin_email:"no-reply@other.example"},
    {mfa_totp_enroll_enabled:false},
    {mfa_totp_verify_enabled:false},
    {refresh_token_rotation_enabled:false}
  ];
  for(const bad of cases)
    await assert.rejects(trusted(bad).check,/not safe/);
});
test("rejects missing scoped token, inappropriate project domain and unsafe path",async()=>{
  for(const project of [
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.test",
    "https://abcdefghijklmnopqrst.supabase.co/path"
  ])await assert.rejects(
    verifyAuthProductionConfiguration({projectUrl:project,managementToken}),
    /origin/
  );
  await assert.rejects(
    verifyAuthProductionConfiguration({projectUrl,managementToken:"abc"}),
    /credential/
  );
});
test("rejects provider errors and transport secrets without exposing response",async()=>{
  await assert.rejects(verifyAuthProductionConfiguration({
    projectUrl,managementToken,
    fetchImpl:async()=>new Response("smtp secret PRIVATE",{status:403})
  }),/verification unavailable/);
  await assert.rejects(verifyAuthProductionConfiguration({
    projectUrl,managementToken,
    fetchImpl:async()=>{throw new Error("PRIVATE token");}
  }),/verification unavailable/);
});
test("refuses oversized or non-object config bodies",async()=>{
  await assert.rejects(verifyAuthProductionConfiguration({
    projectUrl,managementToken,
    fetchImpl:async()=>new Response(" ".repeat(150000),{status:200})
  }),/verification unavailable/);
  await assert.rejects(verifyAuthProductionConfiguration({
    projectUrl,managementToken,
    fetchImpl:async()=>new Response("[]",{status:200})
  }),/verification unavailable/);
});
