import { describe, expect, it } from "vitest";
import { SupabaseEmailOtpClient } from "../src/auth/supabase-email-otp.js";

const origin="https://abcdefghijklmnopqrst.supabase.co";
const key="sb_publishable_test_private_bff_123456789";
const access="access_"+"a".repeat(65);
const refreshOne="refresh_"+"r".repeat(60);
const refreshTwo="refresh_"+"s".repeat(60);

function issued(refresh=refreshOne): Response {
  return new Response(JSON.stringify({
    access_token:access,refresh_token:refresh,
    token_type:"bearer",expires_in:3600
  }),{status:200,headers:{"content-type":"application/json"}});
}
function setup(reply:(url:string,init:RequestInit)=>Response|Promise<Response>){
  const calls:{url:string;init:RequestInit}[]=[];
  const fetchImpl:typeof fetch=(input,init)=>{
    const url=typeof input==="string" ? input : input instanceof URL ? input.toString() : input.url;
    if(init===undefined)return Promise.reject(new Error("missing request config"));
    calls.push({url,init});
    return Promise.resolve(reply(url,init));
  };
  return {client:new SupabaseEmailOtpClient({
    projectUrl:origin,publishableKey:key,fetchImpl,timeoutMs:2000
  }),calls};
}

describe("official Supabase Auth REST BFF transport",()=>{
  it("requests email OTP with create_user=false and no account creation or bearer",async()=>{
    const {client,calls}=setup(()=>new Response("{}",{status:200}));
    await client.sendOtp("invited@example.com");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(origin+"/auth/v1/otp");
    expect(calls[0]?.init).toMatchObject({
      method:"POST",redirect:"error",cache:"no-store",
      headers:{"content-type":"application/json",accept:"application/json",apikey:key}
    });
    expect(JSON.parse(typeof calls[0]?.init.body==="string" ? calls[0].init.body : "null")).toEqual({
      email:"invited@example.com",create_user:false
    });
    expect(calls[0]?.init.headers).not.toHaveProperty("authorization");
  });

  it("exchanges the email OTP and reads both server-side tokens, never changing caller origin",async()=>{
    const {client,calls}=setup(()=>issued());
    const result=await client.verifyOtp("invited@example.com","654321");
    expect(result).toMatchObject({
      access_token:access,refresh_token:refreshOne,expires_in:3600
    });
    expect(calls[0]?.url).toBe(origin+"/auth/v1/verify");
    expect(JSON.parse(typeof calls[0]?.init.body==="string" ? calls[0].init.body : "null")).toEqual({
      email:"invited@example.com",token:"654321",type:"email"
    });
  });

  it("uses documented refresh_token grant and the exact one-time token",async()=>{
    const {client,calls}=setup(()=>issued(refreshTwo));
    const result=await client.refresh(refreshOne);
    expect(result.refresh_token).toBe(refreshTwo);
    expect(calls[0]?.url).toBe(origin+"/auth/v1/token?grant_type=refresh_token");
    expect(JSON.parse(typeof calls[0]?.init.body==="string" ? calls[0].init.body : "null")).toEqual({
      refresh_token:refreshOne
    });
  });

  it("requests local provider signout with the exact server-side bearer",async()=>{
    const {client,calls}=setup(()=>new Response(null,{status:204}));
    await client.revoke(access);
    expect(calls[0]?.url).toBe(origin+"/auth/v1/logout?scope=local");
    expect(calls[0]?.init.headers).toMatchObject({authorization:"Bearer "+access});
  });

  it("rejects wrong project host, HTTP URLs and secret/service-role keys",()=>{
    const fetchImpl:typeof fetch=()=>Promise.resolve(issued());
    for(const base of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.test",
      "https://abcdefghijklmnopqrst.supabase.co/foreign",
      "https://abcdefghijklmnopqrst.supabase.co?destination=other"
    ]){
      expect(()=>new SupabaseEmailOtpClient({
        projectUrl:base,publishableKey:key,fetchImpl
      })).toThrow();
    }
    for(const wrongKey of ["sb_secret_private","service_role","anon_legacy"]){
      expect(()=>new SupabaseEmailOtpClient({
        projectUrl:origin,publishableKey:wrongKey,fetchImpl
      })).toThrow(/publishable/i);
    }
  });

  it("rejects hostile or malformed provider token responses without echoing body",async()=>{
    for(const result of [
      new Response("secret_provider_error_456",{status:401}),
      new Response("not JSON",{status:200}),
      new Response(JSON.stringify({
        access_token:access,refresh_token:refreshOne,expires_in:3600,token_type:"unsupported"
      }),{status:200}),
      new Response(JSON.stringify({
        access_token:access,refresh_token:refreshOne,expires_in:9000000,token_type:"bearer"
      }),{status:200})
    ]){
      const {client}=setup(()=>result);
      await expect(client.verifyOtp("invited@example.com","654321"))
        .rejects.toThrow(/authentication (rejected|response invalid)/i);
    }
  });

  it("bounds streamed chunked token response bodies before large allocation",async()=>{
    const stream=new ReadableStream<Uint8Array>({
      start(controller){
        controller.enqueue(new Uint8Array(9000));
        controller.enqueue(new Uint8Array(9000));
      }
    });
    const {client}=setup(()=>new Response(stream,{status:200}));
    await expect(client.verifyOtp("invited@example.com","654321"))
      .rejects.toThrow("Supabase authentication response invalid");
  });

  it("honors declared response-size limit even if body does not match",async()=>{
    const {client}=setup(()=>new Response(JSON.stringify({
      access_token:access,refresh_token:refreshOne,expires_in:3600,token_type:"bearer"
    }),{status:200,headers:{"content-length":"10000000"}}));
    await expect(client.refresh(refreshOne)).rejects.toThrow(
      "Supabase authentication response invalid"
    );
  });

  it("does not expose upstream network errors or allow uncontrolled redirects",async()=>{
    const fetchImpl:typeof fetch=()=>Promise.reject(
      new Error("secret_auth_provider_token_please_do_not_log")
    );
    const client=new SupabaseEmailOtpClient({
      projectUrl:origin,publishableKey:key,fetchImpl
    });
    await expect(client.sendOtp("invited@example.com"))
      .rejects.toThrow("Supabase authentication service unavailable");

    const {client:redirected}=setup(()=>Response.redirect("https://attacker.test",302));
    await expect(redirected.verifyOtp("invited@example.com","654321"))
      .rejects.toThrow("Supabase authentication rejected");
  });
});
