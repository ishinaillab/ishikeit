import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {PostgresWorkspaceConnectionRegistry} from "../src/persistence/workspace-connections.js";
import {
  TikTokAccountPermissionClient,WorkspaceTikTokOwnerConnections
} from "../src/auth/workspace-tiktok-connect.js";

const workspaceId=randomUUID(),sessionId=randomUUID();
const actor={issuer:"https://supabase.example.test/auth/v1",subject:randomUUID()};
const state="S".repeat(43),browserNonce="N".repeat(43);
const appId="987654321",accountId="mock-tiktok-owner-001";
const redirectUri="https://apps.ishinaillab.com/app/auth/connect/tiktok/callback/";
const authorizationUrl="https://ads.tiktok.com/marketing_api/auth?client_id="+appId+
  "&redirect_uri="+encodeURIComponent(redirectUri);
const input={accessToken:"a".repeat(140),workspaceId,state,browserNonce,
  authorizationCode:"code-12345678"};
const tokens={
  accessToken:"private-access-token",refreshToken:"private-refresh-token",
  openId:accountId,accessExpiresInSeconds:86400,
  refreshExpiresInSeconds:31536000,scopes:["biz.manage","tt_business.messaging"]
};
function setup(){
  const intents={
    begin:vi.fn(()=>Promise.resolve({
      state,browserNonce,codeChallenge:"K".repeat(43),
      expiresAt:"2026-11-15T08:00:00.000Z"
    })),
    consume:vi.fn(()=>Promise.resolve({
      intentId:randomUUID(),sessionId,workspaceId,actor,
      provider:"tiktok",providerApplicationKey:"tiktok-holder-"+appId,
      redirectUri,codeVerifier:"V".repeat(43)
    }))
  };
  const oauth={
    exchangeAuthorizationCode:vi.fn(()=>Promise.resolve(tokens))
  };
  const accountReader={
    read:vi.fn(()=>Promise.resolve({
      openId:accountId,advancedAccess:true,messagingPermitted:false,
      observedScopes:["biz.manage"]
    }))
  };
  const registry={
    linkVerified:vi.fn(async(p:{connectionId:string;workspaceId:string;
      proof:{accountId:string};credentialAccountId?:string},
      writer?:(tx:unknown)=>Promise<void>)=>{
      if(writer!==undefined)await writer({query:vi.fn()});
      return {connectionId:p.connectionId,workspaceId:p.workspaceId,
        accountId:p.proof.accountId,status:"verifying" as const};
    }),
    findForAdministrator:vi.fn(()=>Promise.resolve({
      connectionId:randomUUID(),workspaceId,provider:"tiktok",accountId,
      status:"verifying" as const,generation:1
    })),
    activateVerified:vi.fn((p:unknown)=>{
      expect(p).toBeDefined();
      return Promise.resolve({connectionId:randomUUID(),status:"connected" as const,
        generation:2});
    })
  };
  const vault={
    putInTransaction:vi.fn(()=>Promise.resolve(undefined)),
    get:vi.fn(()=>Promise.resolve({
      provider:"workspace-tiktok",accountId:randomUUID(),
      accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,
      scopes:tokens.scopes,tokenVersion:1,
      accessExpiresAt:new Date(Date.now()+86400000)
    }))
  };
  const service=new WorkspaceTikTokOwnerConnections({
    appId,redirectUri,authorizationUrl,
    intents,oauth,accountReader,
    registry:registry as unknown as Pick<PostgresWorkspaceConnectionRegistry,
      "linkVerified"|"activateVerified"|"findForAdministrator">,vault
  });
  return {service,intents,oauth,accountReader,registry,vault};
}

describe("tenant TikTok account-holder native grant",()=>{
  it("constructs authorization from trusted portal URL with random one-use state and no leaked bearer or nonce",async()=>{
    const t=setup();
    const result=await t.service.begin(input.accessToken,workspaceId);
    const url=new URL(result.authorizationUrl);
    expect(url.origin).toBe("https://ads.tiktok.com");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.toString()).not.toContain(browserNonce);
    expect(url.toString()).not.toContain(input.accessToken);
    expect(t.intents.begin).toHaveBeenCalledWith({
      accessToken:input.accessToken,workspaceId,provider:"tiktok",
      providerApplicationKey:"tiktok-holder-"+appId,redirectUri
    });
  });
  it("rejects untrusted redirect, wrong registered callback and malicious authorization host",()=>{
    for(const url of [
      "https://evil.test/?redirect_uri="+encodeURIComponent(redirectUri),
      "https://ads.tiktok.com.evil.test/auth",
      "http://ads.tiktok.com/auth",
      "https://ads.tiktok.com/auth?redirect_uri=https%3A%2F%2Fwrong.test%2F"
    ]){
      const t=setup();
      expect(()=>new WorkspaceTikTokOwnerConnections({
        appId,redirectUri,authorizationUrl:url,
        intents:t.intents,oauth:t.oauth,accountReader:t.accountReader,
        registry:t.registry as unknown as Pick<PostgresWorkspaceConnectionRegistry,
          "linkVerified"|"activateVerified"|"findForAdministrator">,vault:t.vault
      })).toThrow();
    }
  });
  it("rejects expired/replayed or swapped browser nonce before provider exchange",async()=>{
    const t=setup();
    t.intents.consume.mockResolvedValueOnce(undefined as never);
    await expect(t.service.complete(input)).rejects.toThrow(/expired|replayed/i);
    expect(t.oauth.exchangeAuthorizationCode).not.toHaveBeenCalled();
    await expect(t.service.complete({...input,browserNonce:"bad"})).rejects.toThrow();
    expect(t.oauth.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
  it("atomically links the immutable open_id to a separate encrypted tenant credential writer",async()=>{
    const t=setup();
    const result=await t.service.complete(input);
    expect(result).toMatchObject({workspaceId,accountId,status:"verifying"});
    expect(t.oauth.exchangeAuthorizationCode).toHaveBeenCalledWith(
      input.authorizationCode,redirectUri
    );
    expect(t.registry.linkVerified).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,sessionId,actor,credentialAccountId:result.connectionId,
      providerApplicationKey:"tiktok-holder-"+appId
    }),expect.any(Function));
    expect(t.registry.linkVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{provider:"tiktok",accountId,source:"oauth_grant",
        sourceReference:"tiktok-holder-"+appId}
    });
    expect(t.vault.putInTransaction).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({
        provider:"workspace-tiktok",accountId:result.connectionId,
        refreshToken:tokens.refreshToken,accessToken:tokens.accessToken
      })
    );
    expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
    expect(JSON.stringify(result)).not.toContain(tokens.refreshToken);
  });
  it("refuses a grant without identity, refresh token or scopes",async()=>{
    const t=setup();
    t.oauth.exchangeAuthorizationCode.mockResolvedValueOnce({...tokens,openId:undefined} as unknown as typeof tokens);
    await expect(t.service.complete(input)).rejects.toThrow();
    t.oauth.exchangeAuthorizationCode.mockResolvedValueOnce({...tokens,refreshToken:undefined} as unknown as typeof tokens);
    await expect(t.service.complete(input)).rejects.toThrow(/grant incomplete/);
    t.oauth.exchangeAuthorizationCode.mockResolvedValueOnce({...tokens,scopes:[]});
    await expect(t.service.complete(input)).rejects.toThrow(/grant incomplete/);
    expect(t.registry.linkVerified).not.toHaveBeenCalled();
  });
  it("requires a fresh exact account readback, not generic send eligibility, before activation",async()=>{
    const t=setup();
    const connectionId=randomUUID();
    const result=await t.service.confirm({workspaceId,connectionId,actor});
    expect(result.status).toBe("connected");
    expect(t.accountReader.read).toHaveBeenCalledWith(tokens.accessToken,accountId);
    expect(t.registry.activateVerified).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,connectionId,credentialAccountId:connectionId,
      providerApplicationKey:"tiktok-holder-"+appId
    }));
    expect(t.registry.activateVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{provider:"tiktok",accountId,source:"provider_api",
        sourceReference:"tiktok-business-get"}
    });
    t.accountReader.read.mockResolvedValueOnce({
      openId:"foreign",advancedAccess:true,messagingPermitted:false,observedScopes:[]
    });
    await expect(t.service.confirm({workspaceId,connectionId,actor}))
      .rejects.toThrow(/unverified/);
  });
  it("denies expired credential and foreign workspace before provider call",async()=>{
    const t=setup(),connectionId=randomUUID();
    t.registry.findForAdministrator.mockResolvedValueOnce(undefined as never);
    await expect(t.service.confirm({workspaceId,connectionId,actor}))
      .rejects.toThrow(/activation not permitted/);
    expect(t.accountReader.read).not.toHaveBeenCalled();
    t.vault.get.mockResolvedValueOnce({...await t.vault.get(),
      accessExpiresAt:new Date(Date.now()-3000)});
    await expect(t.service.confirm({workspaceId,connectionId,actor}))
      .rejects.toThrow(/expired/);
    expect(t.accountReader.read).not.toHaveBeenCalled();
  });
});
function response(data:unknown,status=200):Response{
  return new Response(JSON.stringify(data),{
    status,headers:{"content-type":"application/json"}
  });
}
describe("TikTok exact account-holder token introspection and account eligibility",()=>{
  const token="x".repeat(140);
  const grantScopes="biz.manage,user.account.type,tt_business.messaging";
  const tokenInfo={code:0,data:{
    app_id:appId,creator_id:accountId,scope:grantScopes
  }};
  const accountProfile={code:0,data:{has_advanced_access:true}};
  function client(fetcher:typeof fetch){
    return new TikTokAccountPermissionClient({
      version:"v1.3",appId,fetchImpl:fetcher
    });
  }

  it("POSTs app-bound token inspection and GETs explicitly requested advanced-access field",async()=>{
    const fetcher=vi.fn((url:string)=>Promise.resolve(
      response(url.includes("token_info")?tokenInfo:accountProfile)
    )) as unknown as typeof fetch;
    const result=await client(fetcher).read(token,accountId);
    expect(result).toMatchObject({
      openId:accountId,advancedAccess:true,messagingPermitted:false
    });
    expect(result.observedScopes).toContain("user.account.type");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls=vi.mocked(fetcher).mock.calls;
    const [inspectorUrl,inspectorInit]=calls[0]!;
    const [profileUrl,profileInit]=calls[1]!;
    if(typeof inspectorUrl!=="string"||typeof profileUrl!=="string"||
      typeof inspectorInit?.body!=="string")
      throw new Error("Expected exact string URL and JSON request body");
    expect(inspectorUrl).toBe("https://business-api.tiktok.com/open_api/v1.3/tt_user/token_info/get/");
    expect(inspectorInit?.method).toBe("POST");
    expect(JSON.parse(inspectorInit.body)).toEqual({
      app_id:appId,access_token:token
    });
    expect(inspectorInit?.headers).not.toHaveProperty("Access-Token");
    expect(profileInit?.method).toBe("GET");
    expect(profileInit?.headers).toHaveProperty("Access-Token",token);
    const url=new URL(profileUrl);
    expect(url.pathname).toBe("/open_api/v1.3/business/get/");
    expect(url.searchParams.get("business_id")).toBe(accountId);
    expect(JSON.parse(url.searchParams.get("fields")??"null")).toEqual([
      "has_advanced_access"
    ]);
    expect(inspectorUrl+profileUrl).not.toContain(token);
  });

  it("refuses mismatched token app, creator account, insufficient scope or provider error",async()=>{
    const invalid=[
      {code:0,data:{app_id:appId,creator_id:"foreign",scope:grantScopes}},
      {code:0,data:{app_id:"foreign-app",creator_id:accountId,scope:grantScopes}},
      {code:0,data:{app_id:appId,creator_id:accountId,scope:"biz.manage"}},
      {code:0,data:{app_id:appId,creator_id:accountId}},
      {code:200,data:{app_id:appId,creator_id:accountId,scope:grantScopes}}
    ];
    for(const bad of invalid){
      const fetcher=vi.fn(()=>Promise.resolve(response(bad))) as unknown as typeof fetch;
      await expect(client(fetcher).read(token,accountId)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses provider downgrade, absent eligibility and mismatched optional profile identity",async()=>{
    for(const profile of [
      {code:0,data:{has_advanced_access:false}},
      {code:0,data:{open_id:"foreign",has_advanced_access:true}},
      {code:0,data:{}}
    ]){
      const fetcher=vi.fn((url:string)=>Promise.resolve(
        response(url.includes("token_info")?tokenInfo:profile)
      )) as unknown as typeof fetch;
      await expect(client(fetcher).read(token,accountId)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
});
