import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {ProviderNativeInstagramConsent} from "../src/auth/workspace-provider-consent.js";
import {WorkspaceInstagramConnectionCoordinator} from "../src/auth/workspace-instagram-connect.js";

const workspaceId=randomUUID();
const sessionId=randomUUID();
const actor={issuer:"https://fake-idp.test/auth/v1",subject:randomUUID()};
const state="S".repeat(43),browserNonce="N".repeat(43),appId="1042452472116584";
const callback="https://apps.ishinaillab.com/app/auth/connect/instagram/callback";
const input={
  accessToken:"a".repeat(140),workspaceId,state,browserNonce,
  authorizationCode:"code-test-123"
};
function fake(){
  const intents={
    begin:vi.fn(()=>Promise.resolve({
      state,browserNonce,codeChallenge:"C".repeat(43),
      expiresAt:"2026-11-14T10:00:00.000Z"
    })),
    consume:vi.fn(()=>Promise.resolve({
      intentId:randomUUID(),workspaceId,sessionId,actor,provider:"instagram",
      providerApplicationKey:"instagram-login-"+appId,
      redirectUri:callback,codeVerifier:"V".repeat(43)
    }))
  };
  const client={
    exchangeAuthorizationCode:vi.fn(()=>Promise.resolve({
      accessToken:"short-test-token",userId:"17841400000000001",
      scopes:["instagram_business_basic","instagram_business_manage_messages"]
    })),
    exchangeLongLived:vi.fn(()=>Promise.resolve({
      accessToken:"long-private-token",accessExpiresInSeconds:5184000
    })),
    resolveProfessionalAccountId:vi.fn(()=>Promise.resolve("17841438662359631"))
  };
  const consent=new ProviderNativeInstagramConsent({
    appId,redirectUri:callback,intents,client
  });
  return {intents,client,consent};
}

describe("native tenant Instagram connect (server-only, no provider calls in tests)",()=>{
  it("uses only trusted provider config, state, and no unsupported PKCE parameters",async()=>{
    const {consent,intents}=fake();
    const result=await consent.begin(input.accessToken,workspaceId);
    const url=new URL(result.authorizationUrl);
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(appId);
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(callback);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.get("scope")).toContain("instagram_business_manage_messages");
    expect(url.searchParams.toString()).not.toContain(browserNonce);
    expect(url.searchParams.toString()).not.toContain(input.accessToken);
    expect(intents.begin).toHaveBeenCalledWith({
      accessToken:input.accessToken,workspaceId,
      provider:"instagram",providerApplicationKey:"instagram-login-"+appId,
      redirectUri:callback
    });
  });

  it("requires exact one-use session-bound intent, provider scopes and immutable identity",async()=>{
    const {consent,intents,client}=fake();
    const grant=await consent.complete(input);
    expect(grant.sessionId).toBe(sessionId);
    expect(grant.accountId).toBe("17841438662359631");
    expect(grant.credentialSubjectId).toBe("17841400000000001");
    expect(grant.scopes).toContain("instagram_business_manage_messages");
    expect(grant.accessToken).toBe("long-private-token");
    expect(intents.consume).toHaveBeenCalledWith({
      accessToken:input.accessToken,workspaceId,
      provider:"instagram",providerApplicationKey:"instagram-login-"+appId,
      redirectUri:callback,state,browserNonce
    });
    expect(client.resolveProfessionalAccountId).toHaveBeenCalledWith("long-private-token");
  });

  it("fails before a provider token exchange on replayed/foreign/missing browser state",async()=>{
    const {consent,intents,client}=fake();
    intents.consume.mockResolvedValueOnce(undefined as never);
    await expect(consent.complete(input)).rejects.toThrow(/expired|replayed|unauthorized/i);
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    await expect(consent.complete({...input,browserNonce:"wrong"})).rejects.toThrow();
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects short token with missing messaging scope without persisting a grant",async()=>{
    const {consent,client}=fake();
    client.exchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken:"short-no-permission",userId:"17841400000000001",
      scopes:["instagram_business_basic"]
    });
    await expect(consent.complete(input)).rejects.toThrow(/required messaging scopes/i);
    expect(client.exchangeLongLived).not.toHaveBeenCalled();
  });

  it("rejects invalid identity and forged provider grant expiry",async()=>{
    const {consent,client}=fake();
    client.resolveProfessionalAccountId.mockResolvedValueOnce("untrusted_username");
    await expect(consent.complete(input)).rejects.toThrow();
    client.exchangeLongLived.mockResolvedValueOnce({
      accessToken:"long-test",accessExpiresInSeconds:0
    });
    await expect(consent.complete(input)).rejects.toThrow(/expiration invalid/);
  });

  it("creates a dormant tenant grant with an atomic server-side encrypted writer",async()=>{
    const {consent,client}=fake();
    const writer=vi.fn(()=>Promise.resolve(undefined));
    const registry={
      linkVerified:vi.fn(async(p:{
        connectionId:string;workspaceId:string;
        proof:{provider:string;accountId:string}
      },persist?:(tx:unknown)=>Promise<void>)=>{
        if(persist!==undefined)await persist({query:writer});
        return {connectionId:p.connectionId,workspaceId:p.workspaceId,
          provider:p.proof.provider,accountId:p.proof.accountId,
          status:"verifying" as const,generation:1};
      }),
      findForAdministrator:vi.fn(),
      activateVerified:vi.fn()
    };
    const oauth={
      putInTransaction:vi.fn(()=>Promise.resolve(undefined)),
      get:vi.fn()
    };
    const coordinator=new WorkspaceInstagramConnectionCoordinator({
      consent,appId,client,
      registry,oauth
    });
    const result=await coordinator.complete(input);
    expect(result).toMatchObject({
      workspaceId,accountId:"17841438662359631",status:"verifying"
    });
    expect(registry.linkVerified).toHaveBeenCalledTimes(1);
    const call=registry.linkVerified.mock.calls[0]!;
    expect(call[0]).toMatchObject({
      sessionId,workspaceId,actor,
      credentialAccountId:result.connectionId,
      proof:{provider:"instagram",accountId:"17841438662359631"}
    });
    expect(oauth.putInTransaction).toHaveBeenCalledWith(
      expect.anything(),expect.objectContaining({
        provider:"workspace-instagram",accountId:result.connectionId,
        accessToken:"long-private-token"
      })
    );
    expect(JSON.stringify(result)).not.toContain("long-private-token");
  });

  it("refuses activation when original grant expired or live identity changed",async()=>{
    const {consent,client}=fake();
    const connectionId=randomUUID();
    const connected={
      connectionId,workspaceId,provider:"instagram",
      accountId:"17841438662359631",status:"verifying" as const,generation:1
    };
    const registry={
      linkVerified:vi.fn(),findForAdministrator:vi.fn(()=>Promise.resolve(connected)),
      activateVerified:vi.fn((actual:unknown)=>{expect(actual).toBeDefined();return Promise.resolve({...connected,status:"connected" as const,generation:2});})
    };
    const oauth={
      putInTransaction:vi.fn(),
      get:vi.fn(()=>Promise.resolve({
        provider:"workspace-instagram",accountId:connectionId,
        accessToken:"private-token",
        scopes:["instagram_business_basic","instagram_business_manage_messages"],
        accessExpiresAt:new Date(Date.now()+3600000),tokenVersion:1
      }))
    };
    const coordinator=new WorkspaceInstagramConnectionCoordinator({
      consent,appId,client,
      registry,oauth
    });
    const req={workspaceId,connectionId,actor};
    client.resolveProfessionalAccountId.mockResolvedValueOnce("someone_else");
    await expect(coordinator.confirm(req)).rejects.toThrow(/identity no longer matches/i);
    expect(registry.activateVerified).not.toHaveBeenCalled();
    oauth.get.mockResolvedValueOnce({
      ...await oauth.get(),accessExpiresAt:new Date(Date.now()-1000)
    });
    await expect(coordinator.confirm(req)).rejects.toThrow(/expired/i);
    const ok=await coordinator.confirm(req);
    expect(ok).toMatchObject({status:"connected",generation:2});
    expect(registry.activateVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,connectionId,
        providerApplicationKey:"instagram-login-"+appId,
        credentialAccountId:connectionId
      })
    );
    expect(registry.activateVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{provider:"instagram",accountId:"17841438662359631",
        source:"provider_api",sourceReference:"instagram-provider-readback"}
    });
  });
});
