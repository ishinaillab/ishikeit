import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {
  MetaMessengerPageClient,WorkspaceMessengerPageConnections,
  MESSENGER_REQUIRED_SCOPES
} from "../src/auth/workspace-messenger-connect.js";

const appId="1042452472116584";
const secret="private-test-app-secret-never-production";
const configId="123456789012345";
const pageId="987654321098765";
const userToken="u".repeat(145),pageToken="p".repeat(145);
const state="S".repeat(43),nonce="N".repeat(43);
const code="code-12345678";
const redirect="https://apps.ishinaillab.com/app/auth/connect/messenger/callback";
const workspaceId=randomUUID(),sessionId=randomUUID();
const actor={issuer:"https://supabase.test/auth/v1",subject:randomUUID()};
const now=new Date("2026-11-14T12:00:00.000Z");
function response(body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}
function provider(overrides:{
  userApp?:string;scopes?:string[];userType?:string;userExpiry?:number;
  pageTasks?:string[];pageType?:string;pageIdentity?:string;pageRows?:unknown[];
  pageApp?:string;granularScopes?:unknown[]
}={}){
  const fetcher=vi.fn((rawUrl:string)=>{
    const url=new URL(rawUrl);
    if(url.pathname.endsWith("/oauth/access_token"))
      return Promise.resolve(response({access_token:userToken,token_type:"bearer"}));
    if(url.pathname.endsWith("/debug_token")){
      const input=url.searchParams.get("input_token");
      return Promise.resolve(response({data:input===userToken
        ?{is_valid:true,app_id:overrides.userApp??appId,type:overrides.userType??"USER",
          scopes:overrides.scopes??[...MESSENGER_REQUIRED_SCOPES],
          granular_scopes:overrides.granularScopes,
          expires_at:overrides.userExpiry??2000000000}
        :{is_valid:true,app_id:overrides.pageApp??appId,type:overrides.pageType??"PAGE",
          profile_id:pageId,expires_at:0}}));
    }
    if(url.pathname.endsWith("/me/accounts"))
      return Promise.resolve(response({data:overrides.pageRows??[{
        id:pageId,access_token:pageToken,
        tasks:overrides.pageTasks??["MESSAGING","MODERATE","MANAGE"]
      }]}));
    if(url.pathname.endsWith("/me"))
      return Promise.resolve(response({id:overrides.pageIdentity??pageId}));
    return Promise.resolve(response({error:{message:"unexpected request"}},400));
  }) as unknown as typeof fetch;
  const client=new MetaMessengerPageClient({
    appId,appSecret:secret,configId,graphVersion:"v26.0",
    fetchImpl:fetcher,now:()=>now
  });
  return {fetcher,client};
}
describe("Messenger real Meta user-to-Page ownership proof, read-only",()=>{
  it("constructs fixed Facebook Login for Business code URL with opaque state and registered redirect",()=>{
    const {client}=provider();
    const url=new URL(client.authorizationUrl(state,redirect));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v26.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe(configId);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    expect(url.toString()).not.toContain(secret);
    expect(()=>client.authorizationUrl(state,"http://apps.ishinaillab.com/callback")).toThrow();
  });
  it("exchanges user code, verifies app/user permissions, Page tasks, Page identity and never subscribes",async()=>{
    const {client,fetcher}=provider();
    const grant=await client.exchangeAndProve(code,redirect,pageId);
    expect(grant).toMatchObject({pageId,accessToken:pageToken});
    expect(grant.scopes).toEqual([...MESSENGER_REQUIRED_SCOPES]);
    expect(grant.accessExpiresAt.getTime()).toBeGreaterThan(now.getTime());
    const calls=vi.mocked(fetcher).mock.calls;
    expect(calls).toHaveLength(5);
    function urlOf(value:RequestInfo|URL):URL{
      if(typeof value==="string")return new URL(value);
      if(value instanceof URL)return value;
      throw Error("Unexpected request type in Meta test");
    }
    expect(calls.map(c=>urlOf(c[0]).pathname)).toEqual([
      "/v26.0/oauth/access_token","/v26.0/debug_token",
      "/v26.0/me/accounts","/v26.0/debug_token","/v26.0/me"
    ]);
    for(const call of calls){
      const path=urlOf(call[0]).pathname;
      expect(call[1]?.method).toBe("GET");
      expect(path).not.toContain("subscribed_apps");
      if(path.endsWith("me/accounts")||path.endsWith("/me")){
        expect(call[1]?.headers).toHaveProperty("authorization");
        expect(urlOf(call[0]).searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
  it("rejects a different Meta issuer, wrong User token type and missing messaging permissions",async()=>{
    for(const options of [
      {userApp:"other-app"}, {userType:"PAGE"},
      {scopes:["pages_show_list","pages_manage_metadata"]}
    ]){
      const {client}=provider(options);
      await expect(client.exchangeAndProve(code,redirect,pageId)).rejects.toThrow();
    }
  });
  it("rejects foreign Page selection, absent messaging tasks and mismatched Page identity",async()=>{
    for(const overrides of [
      {pageRows:[]},{pageTasks:["ANALYZE"]},{pageType:"USER"},
      {pageIdentity:"1111111111111"},{pageApp:"different"}
    ]){
      const {client}=provider(overrides);
      await expect(client.exchangeAndProve(code,redirect,pageId)).rejects.toThrow();
    }
  });
  it("rejects a Page where a granted granular messaging scope targets another Page",async()=>{
    const providerPage=provider({granularScopes:[
      {scope:"pages_messaging",target_ids:["111111111111111"]}
    ]});
    await expect(providerPage.client.exchangeAndProve(code,redirect,pageId))
      .rejects.toThrow(/permission does not cover/);
    const accepted=provider({granularScopes:[
      {scope:"pages_messaging",target_ids:[pageId]}
    ]});
    await expect(accepted.client.exchangeAndProve(code,redirect,pageId))
      .resolves.toMatchObject({pageId});
  });
  it("rejects expired original grant and invalid code before sending a provider request",async()=>{
    const {client}=provider({userExpiry:1});
    await expect(client.exchangeAndProve(code,redirect,pageId)).rejects.toThrow();
    const invalid=provider();
    await expect(invalid.client.exchangeAndProve("bad",redirect,pageId)).rejects.toThrow();
    expect(invalid.fetcher).not.toHaveBeenCalled();
  });
  it("rejects changed provider Page on fresh activation readback",async()=>{
    const {client}=provider({pageIdentity:"1111111111111"});
    await expect(client.verifyPage(pageToken,pageId)).rejects.toThrow();
  });
});

function coordinator(){
  const started={state,browserNonce:nonce,codeChallenge:"C".repeat(43),
    expiresAt:"2026-11-14T12:10:00.000Z"};
  const intents={
    begin:vi.fn(()=>Promise.resolve(started)),
    consume:vi.fn(()=>Promise.resolve({
      intentId:randomUUID(),sessionId,workspaceId,actor,provider:"messenger",
      providerApplicationKey:"meta-messenger-"+appId,redirectUri:redirect,
      codeVerifier:"V".repeat(43)
    }))
  };
  const meta={
    authorizationUrl:vi.fn((s:string)=>"https://www.facebook.com/v26.0/dialog/oauth?state="+s),
    exchangeAndProve:vi.fn(()=>Promise.resolve({
      pageId,accessToken:pageToken,scopes:[...MESSENGER_REQUIRED_SCOPES],
      accessExpiresAt:new Date("2027-11-14T12:00:00Z")
    })),
    verifyPage:vi.fn(()=>Promise.resolve())
  };
  const registry={
    linkVerified:vi.fn(async(p:{connectionId:string;workspaceId:string;
      proof:{accountId:string}},writer?:(tx:unknown)=>Promise<void>)=>{
      if(writer)await writer({query:vi.fn()});
      return {connectionId:p.connectionId,workspaceId:p.workspaceId,
        accountId:p.proof.accountId,status:"verifying" as const};
    }),
    findForAdministrator:vi.fn(()=>Promise.resolve({
      provider:"messenger",accountId:pageId,status:"verifying" as const
    })),
    activateVerified:vi.fn((input:unknown)=>{
      expect(input).toBeDefined();
      return Promise.resolve({
        connectionId:randomUUID(),generation:2,status:"connected" as const
      });
    })
  };
  const vault={
    putInTransaction:vi.fn(()=>Promise.resolve()),
    get:vi.fn(()=>Promise.resolve({
      accessToken:pageToken,scopes:[...MESSENGER_REQUIRED_SCOPES],
      accessExpiresAt:new Date("2027-11-14T12:00:00Z")
    }))
  };
  const service=new WorkspaceMessengerPageConnections({
    appId,redirectUri:redirect,intents,client:meta,
    registry:registry as never,vault:vault as never,now:()=>now
  });
  return {service,intents,meta,registry,vault};
}
describe("Messenger tenant-bound account claim and activation",()=>{
  const bearer="b".repeat(140);
  const input={accessToken:bearer,workspaceId,state,browserNonce:nonce,
    authorizationCode:code,pageId};
  it("binds initiation to live workspace and app, never exposing nonce in Meta URL",async()=>{
    const p=coordinator();
    const started=await p.service.begin(bearer,workspaceId);
    expect(started.authorizationUrl).toContain(state);
    expect(started.authorizationUrl).not.toContain(nonce);
    expect(p.intents.begin).toHaveBeenCalledWith({
      accessToken:bearer,workspaceId,provider:"messenger",
      providerApplicationKey:"meta-messenger-"+appId,redirectUri:redirect
    });
  });
  it("links immutable Page with per-connection private encrypted credential in same registry transaction",async()=>{
    const p=coordinator();
    const result=await p.service.complete(input);
    expect(result).toMatchObject({accountId:pageId,status:"verifying",workspaceId});
    expect(p.intents.consume).toHaveBeenCalledWith(expect.objectContaining({
      state,browserNonce:nonce,providerApplicationKey:"meta-messenger-"+appId
    }));
    expect(p.registry.linkVerified).toHaveBeenCalledWith(expect.objectContaining({
      credentialAccountId:result.connectionId,sessionId,workspaceId
    }),expect.any(Function));
    expect(p.registry.linkVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{accountId:pageId,provider:"messenger"}
    });
    expect(p.vault.putInTransaction).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({
        provider:"workspace-messenger",accountId:result.connectionId,
        accessToken:pageToken
      }));
    expect(JSON.stringify(result)).not.toContain(pageToken);
  });
  it("rejects replay/mismatched browser proof without exchange and foreign provider Page",async()=>{
    const p=coordinator();
    p.intents.consume.mockResolvedValueOnce(undefined as never);
    await expect(p.service.complete(input)).rejects.toThrow();
    expect(p.meta.exchangeAndProve).not.toHaveBeenCalled();
    p.meta.exchangeAndProve.mockResolvedValueOnce({
      pageId:"foreign",accessToken:pageToken,scopes:[...MESSENGER_REQUIRED_SCOPES],
      accessExpiresAt:new Date("2027-11-14T12:00:00Z")
    });
    await expect(p.service.complete(input)).rejects.toThrow();
    expect(p.registry.linkVerified).not.toHaveBeenCalled();
  });
  it("demands fresh Page token and owner-scoped registry check for manual activation",async()=>{
    const p=coordinator(),connectionId=randomUUID();
    const result=await p.service.confirm({
      workspaceId,connectionId,actor
    });
    expect(result.status).toBe("connected");
    expect(p.meta.verifyPage).toHaveBeenCalledWith(pageToken,pageId);
    expect(p.registry.activateVerified).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,connectionId,providerApplicationKey:"meta-messenger-"+appId
    }));
    expect(p.registry.activateVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{provider:"messenger",accountId:pageId}
    });
    p.registry.findForAdministrator.mockResolvedValueOnce(undefined as never);
    await expect(p.service.confirm({workspaceId,connectionId,actor})).rejects.toThrow();
  });
});
