import {describe,expect,it,vi} from "vitest";
import {
  WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES,
  WhatsAppEmbeddedV4BusinessGrantReader
} from "../src/auth/whatsapp-embedded-v4-proof.js";

const appId="1042452472116584";
const appSecret="some-confidential-test-app-secret-value";
const accountId="104567890123456";
const phoneId="123456789012345";
const otherPhone="987654321098765";
const code="short-lived-embedded-code-123456";
const businessToken="W".repeat(160);
const now=new Date("2026-11-14T12:00:00.000Z");
function json(body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
}
interface Settings{
  appId?:string;type?:string;isValid?:boolean;
  scopes?:string[];expires?:number;dataExpires?:number;
  account?:string;phone?:string;directPhone?:string;
  noPhone?:boolean;tooMany?:boolean;serverError?:boolean;
}
function fixture(settings:Settings={}){
  const fetchMock=vi.fn((raw:string,init?:RequestInit)=>{
    if(init?.method!=="GET")throw Error("Unexpected Meta mutation in read-only proof");
    const u=new URL(raw);
    const p=u.pathname;
    if(settings.serverError)return Promise.resolve(json({error:{code:1}},401));
    if(p.endsWith("/oauth/access_token"))
      return Promise.resolve(json({access_token:businessToken}));
    if(p.endsWith("/debug_token"))
      return Promise.resolve(json({data:{
        is_valid:settings.isValid??true,
        app_id:settings.appId??appId,
        type:settings.type??"BUSINESS_INTEGRATION_SYSTEM_USER",
        scopes:settings.scopes??[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],
        expires_at:settings.expires??0,
        data_access_expires_at:settings.dataExpires??0
      }}));
    if(p.endsWith("/"+accountId))
      return Promise.resolve(json({id:settings.account??accountId}));
    if(p.endsWith("/"+accountId+"/phone_numbers"))
      return Promise.resolve(json({data:settings.tooMany
        ?Array.from({length:101},(_,i)=>({id:String(i)}))
        :[{id:settings.noPhone?otherPhone:phoneId,
          display_phone_number:"+63 912 345 6789"}]}));
    if(p.endsWith("/"+phoneId))
      return Promise.resolve(json({id:settings.directPhone??phoneId}));
    return Promise.resolve(json({error:{code:100}},400));
  });
  const client=new WhatsAppEmbeddedV4BusinessGrantReader({
    appId,appSecret,graphVersion:"v26.0",
    fetchImpl:fetchMock as unknown as typeof fetch,
    now:()=>now
  });
  return {client,fetchMock};
}
const input={authorizationCode:code,messagingAccountId:accountId,phoneNumberId:phoneId};
describe("WhatsApp Embedded Signup v4 read-only business-token/asset proof",()=>{
  it("only exchanges code server side and independently proves app, scope, Messaging account and phone membership",async()=>{
    const {client,fetchMock}=fixture();
    const result=await client.exchangeAndVerify(input);
    expect(result).toMatchObject({
      businessToken,phoneNumberId:phoneId,messagingAccountId:accountId,
      scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES]
    });
    expect(result.accessExpiresAt.toISOString()).toBe("2027-01-13T12:00:00.000Z");
    const calls=fetchMock.mock.calls;
    expect(calls).toHaveLength(5);
    const urls=calls.map(args=>new URL(args[0]));
    expect(urls.map(u=>u.pathname)).toEqual([
      "/v26.0/oauth/access_token","/v26.0/debug_token",
      "/v26.0/"+accountId,"/v26.0/"+accountId+"/phone_numbers",
      "/v26.0/"+phoneId
    ]);
    expect(urls[0]?.searchParams.get("code")).toBe(code);
    expect(urls[0]?.searchParams.get("client_id")).toBe(appId);
    expect(urls[0]?.searchParams.get("client_secret")).toBe(appSecret);
    for(const args of calls){
      expect(args[1]?.method).toBe("GET");
      expect(args[1]?.redirect).toBe("error");
      expect(args[1]?.cache).toBe("no-store");
      const url=new URL(args[0]);
      expect(url.host).toBe("graph.facebook.com");
      expect(url.pathname).not.toContain("messages");
      expect(url.pathname).not.toContain("subscribed_apps");
      expect(url.pathname).not.toContain("register");
    }
    for(const url of urls.slice(2)){
      expect(url.searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(calls[2]?.[1]?.headers).toMatchObject({
      authorization:"Bearer "+businessToken
    });
  });
  it("rejects invalid app identity, regular User/Page tokens and missing messaging privileges",async()=>{
    for(const settings of [
      {appId:"999999999999999"}, {type:"USER"},
      {type:"PAGE"},{isValid:false},
      {scopes:["whatsapp_business_management"]},
      {scopes:["whatsapp_business_messaging"]}
    ]){
      const {client,fetchMock}=fixture(settings);
      await expect(client.exchangeAndVerify(input)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
  it("rejects expired Meta business and data access tokens",async()=>{
    for(const settings of [
      {expires:100}, {dataExpires:100}
    ]){
      const {client,fetchMock}=fixture(settings);
      await expect(client.exchangeAndVerify(input)).rejects.toThrow(/expired/u);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
  it("bounds stored custody validity by sooner actual provider grant expiry",async()=>{
    const expires=Math.floor(new Date("2026-12-14T12:00:00Z").getTime()/1000);
    const dataExpires=Math.floor(new Date("2026-12-01T12:00:00Z").getTime()/1000);
    const {client}=fixture({expires,dataExpires});
    const result=await client.exchangeAndVerify(input);
    expect(result.accessExpiresAt.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });
  it("refuses unverified Messaging account ID, missing phone, swapped direct identity and oversized inventory",async()=>{
    for(const settings of [
      {account:"111111111111111"},
      {noPhone:true},
      {directPhone:"111111111111111"},
      {tooMany:true}
    ]){
      const {client}=fixture(settings);
      await expect(client.exchangeAndVerify(input)).rejects.toThrow();
    }
  });
  it("rejects malformed or missing candidate IDs and short code before any provider request",async()=>{
    const {client,fetchMock}=fixture();
    const requests=[
      {...input,authorizationCode:"a"},
      {...input,authorizationCode:"<script>alert(1)</script>"},
      {...input,messagingAccountId:"not-id"},
      {...input,phoneNumberId:"0"},
      {...input,phoneNumberId:"123;DROP TABLE"}
    ];
    for(const p of requests)
      await expect(client.exchangeAndVerify(p)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed on provider errors without attempting mutation or sends",async()=>{
    const {client,fetchMock}=fixture({serverError:true});
    await expect(client.exchangeAndVerify(input)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never treats the browser-provided Messaging account and phone as real proof without Graph readback",async()=>{
    const {client}=fixture({noPhone:true});
    await expect(client.exchangeAndVerify(input)).rejects.toThrow(/cannot read/u);
  });
});
