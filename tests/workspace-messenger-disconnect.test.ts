import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {MetaMessengerPageClient} from "../src/auth/workspace-messenger-connect.js";
import {MessengerPageDisconnectVerifier} from
  "../src/auth/workspace-messenger-disconnect.js";
import type {ProviderDisconnectBinding} from
  "../src/persistence/active-disconnect-finalizer.js";

const appId="1042452472116584";
const pageId="987654321098765";
const token="p".repeat(145);
const connectionId=randomUUID();
const base:ProviderDisconnectBinding={
  workspaceId:randomUUID(),connectionId,frozenGeneration:3,
  provider:"messenger",providerAccountId:pageId,
  providerApplicationKey:"meta-messenger-"+appId,
  providerConnectionId:null
};
const scopes=["pages_show_list","pages_manage_metadata","pages_messaging"];
function fakeGraph(subscription:unknown){
  const seen:{path:string;method:string;auth:unknown;url:string}[]=[];
  const client=new MetaMessengerPageClient({
    appId,appSecret:"private-test-secret-never-production",
    graphVersion:"v26.0",configId:"123456789012345",
    fetchImpl:(input,init)=>{
      const url=typeof input==="string"?new URL(input):
        input instanceof URL?input:new URL(input.url);
      seen.push({path:url.pathname,method:init?.method??"none",
        auth:init?.headers&&"authorization" in init.headers?
          init.headers.authorization:undefined,url:url.toString()});
      if(url.pathname.endsWith("/debug_token"))
        return Promise.resolve(new Response(JSON.stringify({data:{
          is_valid:true,app_id:appId,type:"PAGE",profile_id:pageId,expires_at:0
        }}),{status:200}));
      if(url.pathname.endsWith("/me"))
        return Promise.resolve(new Response(JSON.stringify({id:pageId}),{status:200}));
      if(url.pathname.endsWith("/subscribed_apps"))
        return Promise.resolve(new Response(JSON.stringify(subscription),{status:200}));
      throw Error("Unexpected Meta API call");
    }
  });
  return {client,seen};
}
describe("Messenger Page provider-native read-only unsubscribe readback",()=>{
  it("proves current app absence only from exact 3 GETs and no provider mutation",async()=>{
    const p=fakeGraph({data:[]});
    expect(await p.client.isAppUnsubscribed(token,pageId)).toBe(true);
    expect(p.seen.map(x=>x.path)).toEqual([
      "/v26.0/debug_token","/v26.0/me","/v26.0/"+pageId+"/subscribed_apps"
    ]);
    expect(p.seen.every(x=>x.method==="GET")).toBe(true);
    expect(p.seen[2]?.auth).toBe("Bearer "+token);
    expect(new URL(p.seen[2]!.url).searchParams.get("appsecret_proof"))
      .toMatch(/^[0-9a-f]{64}$/);
    expect(p.seen[2]?.url).not.toContain(token);
  });
  it("never infers unsubscription from current app still present",async()=>{
    const p=fakeGraph({data:[{id:appId,name:"ISHIKEIT"}]});
    expect(await p.client.isAppUnsubscribed(token,pageId)).toBe(false);
    expect(p.seen).toHaveLength(3);
  });
  it("refuses incomplete, malformed or foreign-app provider readbacks",async()=>{
    for(const reply of [
      {},{data:null},{data:[{id:"11111111111"}]},
      {data:[{id:appId},{id:appId}]},
      {data:[],paging:{next:"untrusted"}},
      {data:Array.from({length:101},()=>({id:appId}))}
    ]){
      const p=fakeGraph(reply);
      await expect(p.client.isAppUnsubscribed(token,pageId))
        .rejects.toThrow(/subscription/);
    }
  });
  it("rejects unsupported Page identifier before any HTTP",async()=>{
    const p=fakeGraph({data:[]});
    await expect(p.client.isAppUnsubscribed(token,"foreign-page"))
      .rejects.toThrow();
    expect(p.seen).toHaveLength(0);
  });
});
function setup(opts:{shared?:boolean;subscribed?:boolean;expired?:boolean;
  wrongScope?:boolean;missing?:boolean}={}){
  const assertNotSharedWithLegacyOrOtherTenants=vi.fn(
    ()=>opts.shared?Promise.reject(Error("Shared legacy Page")):Promise.resolve()
  );
  const get=vi.fn(()=>Promise.resolve(opts.missing?undefined:{
    provider:"workspace-messenger",accountId:connectionId,
    accessToken:token,scopes:opts.wrongScope?["pages_show_list"]:scopes,
    accessExpiresAt:new Date(Date.now()+(opts.expired?1000:3600000))
  }));
  const isAppUnsubscribed=vi.fn(()=>Promise.resolve(!opts.subscribed));
  const verifier=new MessengerPageDisconnectVerifier({
    appId,vault:{get} as never,client:{isAppUnsubscribed},
    sharingGuard:{assertNotSharedWithLegacyOrOtherTenants}
  });
  return {verifier,get,isAppUnsubscribed,
    assertNotSharedWithLegacyOrOtherTenants};
}
describe("Messenger frozen disconnect readback verifies private Page scope and sharing guard",()=>{
  it("yields fresh finalizer-compatible proof only after all exact checks",async()=>{
    const p=setup();
    const proof=await p.verifier.verifyDisconnected(base);
    expect(proof).toMatchObject({
      disconnected:true,provider:"messenger",providerAccountId:pageId,
      providerApplicationKey:"meta-messenger-"+appId,
      providerConnectionId:null,method:"meta_page_app_unsubscribed"
    });
    expect(p.assertNotSharedWithLegacyOrOtherTenants)
      .toHaveBeenCalledExactlyOnceWith(base);
    expect(p.get).toHaveBeenCalledExactlyOnceWith(
      "workspace-messenger",connectionId);
    expect(p.isAppUnsubscribed)
      .toHaveBeenCalledExactlyOnceWith(token,pageId);
    expect(JSON.stringify(proof)).not.toContain(token);
    expect(Date.now()-Date.parse(proof.observedAt)).toBeLessThan(5000);
  });
  it("refuses shared legacy Page before credential read or Graph",async()=>{
    const p=setup({shared:true});
    await expect(p.verifier.verifyDisconnected(base)).rejects.toThrow(/Shared/);
    expect(p.get).not.toHaveBeenCalled();
    expect(p.isAppUnsubscribed).not.toHaveBeenCalled();
  });
  it("refuses still subscribed, absent, expired or incomplete credential",async()=>{
    for(const variation of [
      {subscribed:true},{missing:true},{expired:true},{wrongScope:true}
    ]){
      const p=setup(variation);
      await expect(p.verifier.verifyDisconnected(base)).rejects.toThrow();
      if(!variation.subscribed)expect(p.isAppUnsubscribed).not.toHaveBeenCalled();
    }
  });
  it("rejects wrong Page, app, provider, connection generation without any readback",async()=>{
    for(const variant of [
      {...base,provider:"instagram"},
      {...base,providerApplicationKey:"meta-messenger-11111111111"},
      {...base,providerAccountId:"not-page-id"},
      {...base,connectionId:"foreign"},
      {...base,workspaceId:"foreign"},
      {...base,providerConnectionId:"unexpected-app-connection"},
      {...base,frozenGeneration:1}
    ]){
      const p=setup();
      await expect(p.verifier.verifyDisconnected(variant)).rejects.toThrow(/bound/);
      expect(p.get).not.toHaveBeenCalled();
      expect(p.isAppUnsubscribed).not.toHaveBeenCalled();
    }
  });
});
