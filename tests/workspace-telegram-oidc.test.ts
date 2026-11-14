import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {SignJWT,createLocalJWKSet,exportJWK,generateKeyPair} from "jose";
import {
  TelegramOIDCClient,TelegramNativeBusinessReader,
  WorkspaceTelegramOIDCConnections,verifyTelegramOIDCIdToken
} from "../src/auth/workspace-telegram-oidc.js";

const workspaceId=randomUUID(),sessionId=randomUUID(),clientId="1122334455";
const accountId="987654321",state="S".repeat(43),nonce="N".repeat(43);
const callback="https://apps.ishinaillab.com/app/auth/connect/telegram/callback";
const accessToken="a".repeat(145);
const actor={issuer:"https://example.test",subject:randomUUID()};
const intent={
  intentId:randomUUID(),workspaceId,sessionId,actor,
  provider:"telegram",providerApplicationKey:"telegram-oidc-"+clientId,
  redirectUri:callback,codeVerifier:"V".repeat(43)
};
const input={accessToken,workspaceId,state,browserNonce:nonce,authorizationCode:"code-Telegram-12345"};
function harness(){
  const intents={
    begin:vi.fn(()=>Promise.resolve({
      state,browserNonce:nonce,codeChallenge:"C".repeat(43),
      expiresAt:"2030-01-01T00:00:00Z"
    })),
    consume:vi.fn(()=>Promise.resolve(intent))
  };
  const oidc={
    exchange:vi.fn(()=>Promise.resolve("signed-token-test")),
    verify:vi.fn(()=>Promise.resolve(accountId))
  };
  const business={
    inspect:vi.fn(()=>Promise.resolve({
      connectionId:"business-conn-A",ownerId:accountId,
      enabled:true,canReply:true
    }))
  };
  const connection={
    connectionId:randomUUID(),workspaceId,provider:"telegram",accountId,
    status:"verifying" as const,generation:1
  };
  const registry={
    linkVerified:vi.fn((actual:unknown)=>{
      expect(actual).toBeDefined();return Promise.resolve(connection);
    }),
    findForAdministrator:vi.fn((actual:unknown)=>{
      expect(actual).toBeDefined();return Promise.resolve(connection);
    }),
    activateTelegramBusiness:vi.fn((actual:unknown)=>{
      expect(actual).toBeDefined();
      return Promise.resolve({...connection,status:"connected" as const,generation:2});
    })
  };
  const coordinator=new WorkspaceTelegramOIDCConnections({
    clientId,redirectUri:callback,intents,oidc,business,
    registry
  });
  return {intents,oidc,business,registry,coordinator,connection};
}
describe("Telegram native owner OIDC and Business evidence",()=>{
  it("uses provider fixed OIDC endpoint, S256 PKCE, unique state and nonce",async()=>{
    const {coordinator,intents}=harness();
    const start=await coordinator.begin(accessToken,workspaceId);
    const u=new URL(start.authorizationUrl);
    expect(u.origin).toBe("https://oauth.telegram.org");
    expect(u.pathname).toBe("/auth");
    expect(u.searchParams.get("client_id")).toBe(clientId);
    expect(u.searchParams.get("scope")).toBe("openid profile");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge")).toBe("C".repeat(43));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("nonce")).toBe(state);
    expect(u.searchParams.has("browserNonce")).toBe(false);
    expect(start.authorizationUrl).not.toContain(nonce);
    expect(start.authorizationUrl).not.toContain(accessToken);
    expect(intents.begin).toHaveBeenCalledWith({
      accessToken,workspaceId,provider:"telegram",
      providerApplicationKey:"telegram-oidc-"+clientId,
      redirectUri:callback
    });
  });

  it("claims only server-verified signed OIDC user and session-bound intent; never stores OIDC token",async()=>{
    const {coordinator,intents,oidc,registry}=harness();
    const created=await coordinator.complete(input);
    expect(created).toMatchObject({workspaceId,accountId,status:"verifying"});
    expect(oidc.exchange).toHaveBeenCalledWith(
      input.authorizationCode,intent.codeVerifier
    );
    expect(oidc.verify).toHaveBeenCalledWith("signed-token-test",state);
    expect(intents.consume).toHaveBeenCalledWith({
      accessToken,workspaceId,provider:"telegram",
      providerApplicationKey:"telegram-oidc-"+clientId,
      redirectUri:callback,state,browserNonce:nonce
    });
    expect(registry.linkVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,intentId:intent.intentId,actor,
        providerApplicationKey:"telegram-oidc-"+clientId
      })
    );
    expect(registry.linkVerified.mock.calls[0]?.[0]).toMatchObject({
      proof:{provider:"telegram",accountId,source:"oauth_grant"}
    });
    expect(JSON.stringify(created)).not.toContain("signed-token-test");
  });

  it("rejects replay before token exchange, rejects forged JWT identity",async()=>{
    const {coordinator,intents,oidc,registry}=harness();
    intents.consume.mockResolvedValueOnce(undefined as never);
    await expect(coordinator.complete(input)).rejects.toThrow(/denied\/replayed/);
    expect(oidc.exchange).not.toHaveBeenCalled();
    oidc.verify.mockResolvedValueOnce("some-user");
    await expect(coordinator.complete(input)).rejects.toThrow();
    expect(registry.linkVerified).not.toHaveBeenCalled();
  });

  it("does not activate a mismatched or disabled Bot API owner even with a valid OIDC connection",async()=>{
    const {coordinator,business,registry,connection}=harness();
    const a={workspaceId,connectionId:connection.connectionId,actor,
      businessConnectionId:"business-conn-A"};
    business.inspect.mockResolvedValueOnce({
      connectionId:"business-conn-A",ownerId:"12345",enabled:true,canReply:true
    });
    await expect(coordinator.confirm(a)).rejects.toThrow(/do not match/);
    business.inspect.mockResolvedValueOnce({
      connectionId:"business-conn-A",ownerId:accountId,enabled:false,canReply:true
    });
    await expect(coordinator.confirm(a)).rejects.toThrow(/do not match/);
    business.inspect.mockResolvedValueOnce({
      connectionId:"business-conn-A",ownerId:accountId,enabled:true,canReply:false
    });
    await expect(coordinator.confirm(a)).rejects.toThrow(/do not match/);
    expect(registry.activateTelegramBusiness).not.toHaveBeenCalled();
    const ok=await coordinator.confirm(a);
    expect(ok).toMatchObject({status:"connected",generation:2});
    expect(registry.activateTelegramBusiness).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId:accountId,connectionId:connection.connectionId,
        businessConnectionId:"business-conn-A",
        providerApplicationKey:"telegram-oidc-"+clientId
      })
    );
  });

  it("checks real JOSE signature, audience, issuer, exp, nonce, id and alg",async()=>{
    const {publicKey,privateKey}=await generateKeyPair("RS256",{modulusLength:2048});
    const publicJwk=await exportJWK(publicKey);
    publicJwk.kid="test-rsa";publicJwk.alg="RS256";
    const resolver=createLocalJWKSet({keys:[publicJwk]});
    const make=async(p:{
      audience?:string;issuer?:string;nonce?:string;expiresIn?:number;
      claimId?:number;subject?:string;omitId?:boolean
    }={})=>{
      const now=Math.floor(Date.now()/1000);
      return new SignJWT({
        nonce:p.nonce??state,
        ...(p.omitId===true?{}:{id:p.claimId??Number(accountId)})
      })
        .setProtectedHeader({alg:"RS256",kid:"test-rsa"})
        .setIssuer(p.issuer??"https://oauth.telegram.org")
        .setAudience(p.audience??clientId)
        .setSubject(p.subject??accountId)
        .setIssuedAt(now).setExpirationTime(now+(p.expiresIn??600))
        .sign(privateKey);
    };
    expect(await verifyTelegramOIDCIdToken(await make(),state,clientId,resolver))
      .toBe(accountId);
    await expect(verifyTelegramOIDCIdToken(await make(),nonce,clientId,resolver))
      .rejects.toThrow(/nonce/i);
    await expect(verifyTelegramOIDCIdToken(
      await make({audience:"foreign-client"}),state,clientId,resolver
    )).rejects.toThrow(/signature\/claims/i);
    await expect(verifyTelegramOIDCIdToken(
      await make({issuer:"https://attacker.example"}),state,clientId,resolver
    )).rejects.toThrow(/signature\/claims/i);
    await expect(verifyTelegramOIDCIdToken(
      await make({expiresIn:-600}),state,clientId,resolver
    )).rejects.toThrow(/signature\/claims/i);
    // Official Telegram docs show OIDC sub can differ from numeric signed id.
    // Never force the OIDC subject to equal Bot API User.id.
    expect(await verifyTelegramOIDCIdToken(
      await make({subject:"opaque-telegram-app-subject"}),state,clientId,resolver
    )).toBe(accountId);
    expect(await verifyTelegramOIDCIdToken(
      await make({claimId:123}),state,clientId,resolver
    )).toBe("123");
    await expect(verifyTelegramOIDCIdToken(
      await make({omitId:true}),state,clientId,resolver
    )).rejects.toThrow(/identity/i);
    await expect(verifyTelegramOIDCIdToken(
      await make({claimId:0}),state,clientId,resolver
    )).rejects.toThrow(/identity/i);
    const other=await generateKeyPair("RS256",{modulusLength:2048});
    const forged=await new SignJWT({nonce:state})
      .setProtectedHeader({alg:"RS256",kid:"test-rsa"})
      .setIssuer("https://oauth.telegram.org").setAudience(clientId)
      .setSubject(accountId).setIssuedAt().setExpirationTime("10m")
      .sign(other.privateKey);
    await expect(verifyTelegramOIDCIdToken(forged,state,clientId,resolver))
      .rejects.toThrow(/signature\/claims/i);
  });

  it("exchanges only through fixed Telegram token endpoint using secret and server PKCE",async()=>{
    const calls:RequestInit[]=[];
    const fakeFetch=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>{
      if(init!==undefined)calls.push(init);
      return Promise.resolve(new Response(JSON.stringify({
        token_type:"Bearer",id_token:"J".repeat(100),expires_in:3600
      }),{status:200,headers:{"content-type":"application/json"}}));
    });
    const client=new TelegramOIDCClient({
      clientId,clientSecret:"test-client-secret-long",
      redirectUri:callback,fetchImpl:fakeFetch
    });
    expect(await client.exchange("telegram-code-123","V".repeat(43)))
      .toBe("J".repeat(100));
    expect(fakeFetch.mock.calls[0]?.[0]).toBe("https://oauth.telegram.org/token");
    const body=calls[0]?.body;
    if(typeof body!=="string")throw Error("Missing token body");
    const params=new URLSearchParams(body);
    expect(params.get("code_verifier")).toBe("V".repeat(43));
    expect(params.get("redirect_uri")).toBe(callback);
    expect(params.get("client_id")).toBe(clientId);
    const headers=calls[0]?.headers as Record<string,string>|undefined;
    expect(headers?.authorization?.startsWith("Basic ")).toBe(true);
    expect(body).not.toContain("signed-token-test");
  });

  it("trusts only exact Bot API Business connection and never username/text claims",async()=>{
    const fakeFetch=vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
      expect(url).toContain("/getBusinessConnection");
      expect(init?.method).toBe("POST");
      return Promise.resolve(new Response(JSON.stringify({
        ok:true,result:{
          id:"business-conn-A",user:{id:987654321,username:"a_user"},
          is_enabled:true,rights:{can_reply:true}
        }
      }),{status:200}));
    });
    const reader=new TelegramNativeBusinessReader({
      botToken:"1122334455:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      fetchImpl:fakeFetch
    });
    expect(await reader.inspect("business-conn-A")).toEqual({
      connectionId:"business-conn-A",ownerId:accountId,
      enabled:true,canReply:true
    });
    expect(fakeFetch.mock.calls[0]?.[0]).toContain("/getBusinessConnection");
    await expect(reader.inspect("bad\nvalue")).rejects.toThrow();
    await expect(reader.inspect("")).rejects.toThrow();
  });
});
