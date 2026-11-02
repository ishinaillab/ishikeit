import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SupabaseAdminInviteClient } from "../src/auth/supabase-admin-invite.js";

const project="https://abcdefghijklmnopqrst.supabase.co";
const key="sb_secret_test_authorized_server_only_key_123";
const email="admin@ishinaillab.com";
const id=randomUUID();
function response(status=200,body:unknown={id,email}){
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
}
function fake(fetchResponse:(url:string,options:RequestInit)=>Response|Promise<Response>){
  const calls:{url:string;opts:RequestInit}[]=[];
  const fetchImpl:typeof fetch=(input,options)=>{
    const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    if(options===undefined)throw new Error("options missing");
    calls.push({url,opts:options});
    return Promise.resolve(fetchResponse(url,options));
  };
  return {client:new SupabaseAdminInviteClient({
    projectUrl:project,secretKey:key,fetchImpl
  }),calls};
}
describe("private Supabase Auth Admin invitation transport",()=>{
  it("uses official trusted-server endpoint and authenticated admin headers",async()=>{
    const {client,calls}=fake(()=>response());
    expect(await client.inviteUserByEmail(email)).toEqual({userId:id,email});
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(project+"/auth/v1/invite?redirect_to="+
      encodeURIComponent("https://apps.ishinaillab.com/app/login"));
    expect(new Headers(calls[0]?.opts.headers).has("Authorization")).toBe(false);
    expect(calls[0]?.opts).toMatchObject({
      method:"POST",redirect:"error",cache:"no-store",
      headers:{apikey:key,"content-type":"application/json"}
    });
    const body=calls[0]?.opts.body;
    expect(typeof body==="string"?JSON.parse(body):undefined).toEqual({email});
  });
  it("refuses wrong project origin, publishable key and legacy anon credential",()=>{
    for(const bad of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.example",
      "https://abcdefghijklmnopqrst.supabase.co/other",
      "https://abcdefghijklmnopqrst.supabase.co/?redirect=evil"
    ]){
      expect(()=>new SupabaseAdminInviteClient({projectUrl:bad,secretKey:key})).toThrow();
    }
    for(const bad of ["sb_publishable_not_admin","service_role_legacy","abc"]){
      expect(()=>new SupabaseAdminInviteClient({projectUrl:project,secretKey:bad})).toThrow();
    }
  });
  it("rejects mismatched user identity and malformed provider response",async()=>{
    await expect(fake(()=>response(200,{id,email:"attacker@example.com"}))
      .client.inviteUserByEmail(email)).rejects.toThrow(/identity mismatch/i);
    await expect(fake(()=>response(200,{id:"bad-id",email}))
      .client.inviteUserByEmail(email)).rejects.toThrow(/response rejected/i);
  });
  it("does not leak upstream error payloads or network errors",async()=>{
    const provider=fake(()=>response(500,{message:"do not log secret"}));
    await expect(provider.client.inviteUserByEmail(email)).rejects.toThrow("Auth Admin invitation rejected");
    const offline=fake(()=>Promise.reject(new Error("do not leak network password")));
    await expect(offline.client.inviteUserByEmail(email)).rejects.toThrow("Auth Admin invitation transport unavailable");
  });
  it("limits response length even for chunked streams",async()=>{
    const {client}=fake(()=>new Response(new ReadableStream<Uint8Array>({
      start(controller){controller.enqueue(new Uint8Array(12000));controller.enqueue(new Uint8Array(8000));}
    })));
    await expect(client.inviteUserByEmail(email)).rejects.toThrow("Auth Admin response rejected");
  });
  it("does not follow redirects to untrusted hosts",async()=>{
    const {client,calls}=fake(()=>response(302));
    await expect(client.inviteUserByEmail(email)).rejects.toThrow();
    expect(calls[0]?.opts.redirect).toBe("error");
  });
});
