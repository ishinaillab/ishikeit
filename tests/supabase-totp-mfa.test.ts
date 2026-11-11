import { describe, expect, it } from "vitest";
import { SupabaseTotpMfaClient } from "../src/auth/supabase-totp-mfa.js";

const project="https://abcdefghijklmnopqrst.supabase.co";
const key="sb_publishable_mfa_isolated_faketest123";
const bearer="synthetic_authenticated_bearer_only_for_test";
const factorId="123e4567-e89b-42d3-a456-426614174000";
const challengeId="223e4567-e89b-42d3-a456-426614174000";
const access="mfa_access_"+"x".repeat(60);
const refresh="mfa_refresh_"+"y".repeat(60);
function json(o:unknown,status=200){
  return new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json"}});
}
function mockClient(responder:(url:string,options:RequestInit)=>Response|Promise<Response>){
  const calls:Array<{url:string;options:RequestInit}>=[];
  const fetchImpl:typeof fetch=(input,options)=>{
    if(options===undefined)return Promise.reject(new Error("Missing options"));
    const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    calls.push({url,options});
    return Promise.resolve(responder(url,options));
  };
  return {
    client:new SupabaseTotpMfaClient({projectUrl:project,publishableKey:key,fetchImpl}),
    calls
  };
}
describe("Supabase Auth MFA server transport",()=>{
  it("enrolls only TOTP and returns one-use factor ID and setup secret",async()=>{
    const {client,calls}=mockClient(()=>json({
      id:factorId,type:"totp",totp:{secret:"JBSWY3DPEHPK3PXP",uri:"otpauth://totp/test"}
    }));
    expect(await client.enroll(bearer)).toEqual({factorId,secret:"JBSWY3DPEHPK3PXP"});
    expect(calls[0]?.url).toBe(project+"/auth/v1/factors");
    expect(calls[0]?.options).toMatchObject({
      method:"POST",cache:"no-store",redirect:"error",
      headers:{apikey:key,authorization:"Bearer "+bearer}
    });
    const body=calls[0]?.options.body;
        if(typeof body!=="string")throw new Error("Expected JSON body");
    const parsed:unknown=JSON.parse(body) as unknown;
    expect(parsed).toMatchObject({factor_type:"totp"});
    if(!parsed||typeof parsed!=="object"||!("friendly_name" in parsed))
      throw new Error("Missing friendly name");
    expect(parsed.friendly_name).toMatch(/^Ishikeit Authenticator [0-9a-f]{16}$/u);
  });
  it("uses a distinct friendly name on each enrollment to avoid GoTrue conflicts",async()=>{
    const {client,calls}=mockClient(()=>json({
      id:factorId,type:"totp",totp:{secret:"JBSWY3DPEHPK3PXP",uri:"otpauth://totp/test"}
    }));
    await client.enroll(bearer);
    await client.enroll(bearer);
    const names=calls.map(x=>{
      if(typeof x.options.body!=="string")throw new Error("Expected JSON body");
      const parsed:unknown=JSON.parse(x.options.body) as unknown;
      if(!parsed||typeof parsed!=="object"||!("friendly_name" in parsed)
        || typeof parsed.friendly_name!=="string")throw new Error("Missing friendly name");
      return parsed.friendly_name;
    });
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });
  it("un-enrolls only by verified factor UUID using official DELETE and returns no secret",async()=>{
    const {client,calls}=mockClient(()=>json({id:factorId}));
    await client.unenroll(bearer,factorId);
    expect(calls[0]?.url).toBe(project+"/auth/v1/factors/"+factorId);
    expect(calls[0]?.options.method).toBe("DELETE");
    expect(calls[0]?.options.headers).toMatchObject({
      authorization:"Bearer "+bearer,apikey:key
    });
    await expect(client.unenroll(bearer,"not-uuid")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it("cleans up only a provider-created unverified factor after malformed enrollment response",async()=>{
    const {client,calls}=mockClient((url,options)=>{
      if(options.method==="DELETE")return json({id:factorId});
      return json({id:factorId,type:"totp",totp:{secret:"invalid secret"}});
    });
    await expect(client.enroll(bearer)).rejects.toThrow("Invalid MFA provider response");
    expect(calls.map(x=>x.options.method)).toEqual(["POST","DELETE"]);
    expect(calls[1]?.url).toBe(project+"/auth/v1/factors/"+factorId);
  });
  it("accepts official MFA AAL2 token exchange with opaque short refresh token",async()=>{
    const {client}=mockClient(url=>url.endsWith("/challenge")
      ? json({id:challengeId})
      : json({
        access_token:access,refresh_token:"abcd1234wxyz",expires_in:3600,
        token_type:"bearer",user:{id:factorId}
      })
    );
    const tokens=await client.challengeAndVerify(bearer,factorId,"123456");
    expect(tokens.refresh_token).toBe("abcd1234wxyz");
  });

  it("accepts large official QR SVG responses and returns a safe image data URI",async()=>{
    // Official GoTrue emits an SVG rectangle per QR module. This 100 KiB QR
    // payload was rejected by the legacy generic 32 KiB response budget.
    const qr="<svg>"+'<rect fill="black"/>'.repeat(5000)+"</svg>";
    expect(qr.length).toBeGreaterThan(32768);
    const {client}=mockClient(()=>json({
      id:factorId,type:"totp",
      friendly_name:"Ishikeit Authenticator",
      totp:{qr_code:qr,secret:"JBSWY3DPEHPK3PXP",uri:"otpauth://totp/test"}
    }));
    const enrollment=await client.enroll(bearer);
    expect(enrollment.factorId).toBe(factorId);
    expect(enrollment.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/svg\+xml;base64,/u);
    const encoded=enrollment.qrCodeDataUrl?.split(",")[1];
    expect(Buffer.from(encoded??"","base64").toString("utf8")).toBe(qr);
  });
  it("rejects active SVG payloads instead of injecting scripts or external references",async()=>{
    for(const code of [
      '<svg onload="alert(1)"><rect/></svg>',
      '<svg><script>alert(1)</script></svg>',
      '<svg><image href="https://evil.test/a"/></svg>',
      '<svg><rect style="fill:url(https://evil.test/a)"/></svg>'
    ]){
      const {client,calls}=mockClient((url,options)=>
        options.method==="DELETE"?json({id:factorId})
          :json({id:factorId,type:"totp",totp:{
            secret:"JBSWY3DPEHPK3PXP",qr_code:code
          }})
      );
      await expect(client.enroll(bearer)).rejects.toThrow("Invalid MFA provider response");
      expect(calls.map(x=>x.options.method)).toEqual(["POST","DELETE"]);
    }
  });
  it("retains a hard 1 MiB enrollment bound even when responses are chunked",async()=>{
    const {client}=mockClient(()=>new Response(
      new ReadableStream<Uint8Array>({
        start(controller){
          controller.enqueue(new Uint8Array(600000));
          controller.enqueue(new Uint8Array(600000));
        }
      }),{status:200}
    ));
    await expect(client.enroll(bearer)).rejects.toThrow("Invalid MFA provider response");
  });

  it("creates challenge and exchanges six-digit OTP for rotated provider tokens only internally",async()=>{
    const {client,calls}=mockClient((url)=>{
      if(url.endsWith("/challenge"))return json({id:challengeId});
      return json({
        access_token:access,refresh_token:refresh,
        token_type:"bearer",expires_in:3600
      });
    });
    const tokens=await client.challengeAndVerify(bearer,factorId,"125678");
    expect(tokens.access_token).toBe(access);
    expect(tokens.refresh_token).toBe(refresh);
    expect(calls.map(x=>x.url)).toEqual([
      project+"/auth/v1/factors/"+factorId+"/challenge",
      project+"/auth/v1/factors/"+factorId+"/verify"
    ]);
    const challengeBody=calls[0]?.options.body;
    expect(typeof challengeBody==="string"?JSON.parse(challengeBody):null).toEqual({});
    const verifyBody=calls[1]?.options.body;
    expect(typeof verifyBody==="string"?JSON.parse(verifyBody):null).toEqual({
      challenge_id:challengeId,code:"125678"
    });
  });
  it("rejects invalid factor ID and OTP before contacting provider",async()=>{
    const {client,calls}=mockClient(()=>json({id:challengeId}));
    await expect(client.challengeAndVerify(bearer,"not-a-uuid","123456")).rejects.toThrow();
    await expect(client.challengeAndVerify(bearer,factorId,"not-a-otp")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("rejects wrong HTTPS project, secret keys, unverified data and provider errors",async()=>{
    for(const invalid of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.test",
      "https://abcdefghijklmnopqrst.supabase.co/a",
      "https://abcdefghijklmnopqrst.supabase.co?q=unsafe"
    ]){
      expect(()=>new SupabaseTotpMfaClient({
        projectUrl:invalid,publishableKey:key
      })).toThrow();
    }
    expect(()=>new SupabaseTotpMfaClient({
      projectUrl:project,publishableKey:"sb_secret_not_allowed"
    })).toThrow();
    const bad=mockClient(()=>json({id:factorId,type:"totp",totp:{
      secret:"bad",uri:"https://attacker.test"
    }}));
    await expect(bad.client.enroll(bearer)).rejects.toThrow(/invalid/i);
    const failure=mockClient(()=>new Response("secret_should_not_leak",{status:401}));
    await expect(failure.client.enroll(bearer))
      .rejects.toThrow("MFA provider rejected the request");
  });
  it("bounds unknown-length streams before allocating and decoding response",async()=>{
    const {client}=mockClient(()=>new Response(new ReadableStream<Uint8Array>({
      start(controller){
        controller.enqueue(new Uint8Array(19000));
        controller.enqueue(new Uint8Array(19000));
      }
    })));
    // Challenge/verify still use 32 KiB; only enrollment allows a large QR SVG.
    await expect(client.challengeAndVerify(bearer,factorId,"123456"))
      .rejects.toThrow("Invalid MFA provider response");
  });
  it("rejects ambiguous or malformed verification result instead of claiming AAL2",async()=>{
    const {client}=mockClient(url=>url.endsWith("/challenge")
      ? json({id:challengeId})
      : json({access_token:access,refresh_token:refresh,token_type:"unknown",expires_in:3600})
    );
    await expect(client.challengeAndVerify(bearer,factorId,"012345"))
      .rejects.toThrow("Invalid MFA provider response");
  });
});
