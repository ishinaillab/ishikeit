import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {
  WorkspaceWhatsAppEmbeddedV4Connections
} from "../src/auth/workspace-whatsapp-embedded-v4.js";
import {
  WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES,
  type VerifiedWhatsAppEmbeddedV4Grant
} from "../src/auth/whatsapp-embedded-v4-proof.js";

const appId="1042452472116584",configId="123456789012345";
const origin="https://apps.ishinaillab.com/";
const workspaceId=randomUUID(),sessionId=randomUUID();
const actor={issuer:"https://supabase.test/auth/v1",subject:randomUUID()};
const state="S".repeat(43),browserNonce="N".repeat(43);
const accessToken="u".repeat(96),businessToken="b".repeat(128);
const phoneNumberId="123456789012345",messagingAccountId="987654321098765";
const now=new Date("2026-11-14T12:00:00Z");
const expiration=new Date("2026-12-14T12:00:00Z");
const applicationKey="meta-wa-v4-"+appId+"-"+configId;
function fixture(){
  const intents={
    begin:vi.fn(()=>Promise.resolve({
      state,browserNonce,codeChallenge:"C".repeat(43),
      expiresAt:"2026-11-14T12:10:00Z"
    })),
    consume:vi.fn(()=>Promise.resolve({
      intentId:randomUUID(),sessionId,workspaceId,actor,provider:"whatsapp",
      providerApplicationKey:applicationKey,
      redirectUri:"https://apps.ishinaillab.com/app/auth/connect/whatsapp/embedded-v4",
      codeVerifier:"V".repeat(43)
    }))
  };
  const reader={
    exchangeAndVerify:vi.fn(():Promise<VerifiedWhatsAppEmbeddedV4Grant>=>Promise.resolve({
      businessToken,messagingAccountId,phoneNumberId,
      scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],
      accessExpiresAt:expiration
    })),
    verifyExisting:vi.fn(():Promise<{scopes:readonly string[];accessExpiresAt:Date}>=>Promise.resolve({
      scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],
      accessExpiresAt:expiration
    }))
  };
  const registry={
    linkVerified:vi.fn(async(
      p:{connectionId:string;workspaceId:string;proof:{accountId:string}},
      writer:(tx:unknown)=>Promise<void>
    )=>{
      await writer({query:vi.fn()});
      return {connectionId:p.connectionId,workspaceId:p.workspaceId,
        accountId:p.proof.accountId,status:"verifying" as const};
    }),
    findBindingForAdministrator:vi.fn(()=>Promise.resolve({
      status:"verifying" as const,provider:"whatsapp",accountId:phoneNumberId,
      providerApplicationKey:applicationKey,
      providerConnectionId:messagingAccountId,
      credentialAccountId:undefined as string|null|undefined
    })),
    activateVerified:vi.fn((args:unknown)=>{
      expect(args).toBeDefined();
      return Promise.resolve({
        connectionId:randomUUID(),status:"connected" as const,generation:2
      });
    })
  };
  const vault={
    putInTransaction:vi.fn(()=>Promise.resolve()),
    get:vi.fn(()=>Promise.resolve({
      accessToken:businessToken,scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],
      accessExpiresAt:expiration
    }))
  };
  const service=new WorkspaceWhatsAppEmbeddedV4Connections({
    appId,configId,origin,graphVersion:"v26.0",
    intents,reader,registry:registry as never,vault:vault as never,now:()=>now
  });
  return {service,intents,reader,registry,vault};
}
const input={accessToken,workspaceId,state,browserNonce,
  authorizationCode:"test-code-12345678",messagingAccountId,phoneNumberId};
describe("WhatsApp owner-native JS SDK server BFF proof",()=>{
  it("binds signup initiation to AAL2 session, workspace and exact app/config, not provider-returned state",async()=>{
    const x=fixture();
    const initiated=await x.service.begin(accessToken,workspaceId);
    expect(initiated).toMatchObject({state,browserNonce,appId,configId,graphVersion:"v26.0"});
    expect(x.intents.begin).toHaveBeenCalledWith({
      accessToken,workspaceId,provider:"whatsapp",
      providerApplicationKey:applicationKey,
      redirectUri:"https://apps.ishinaillab.com/app/auth/connect/whatsapp/embedded-v4"
    });
    expect(JSON.stringify(initiated)).not.toContain(businessToken);
  });
  it("consumes exact protected intent before token exchange and encrypts phone grant in same transaction",async()=>{
    const x=fixture();
    const r=await x.service.complete(input);
    expect(r).toMatchObject({workspaceId,accountId:phoneNumberId,status:"verifying"});
    expect(x.intents.consume).toHaveBeenCalledWith(expect.objectContaining({
      state,browserNonce,providerApplicationKey:applicationKey,
      provider:"whatsapp",workspaceId
    }));
    expect(x.reader.exchangeAndVerify).toHaveBeenCalledWith({
      authorizationCode:input.authorizationCode,
      messagingAccountId,phoneNumberId
    });
    expect(x.registry.linkVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConnectionId:messagingAccountId,
        credentialAccountId:r.connectionId,workspaceId,sessionId
      }),expect.any(Function)
    );
    const linked=x.registry.linkVerified.mock.calls[0]?.[0];
    expect(linked?.proof.accountId).toBe(phoneNumberId);
    expect(x.vault.putInTransaction).toHaveBeenCalledWith(
      expect.anything(),expect.objectContaining({
        provider:"workspace-whatsapp",accountId:r.connectionId,
        accessToken:businessToken
      })
    );
    expect(JSON.stringify(r)).not.toContain(businessToken);
  });
  it("rejects consumed/replayed or mismatched AAL2 intent without calling provider",async()=>{
    const x=fixture();
    x.intents.consume.mockResolvedValueOnce(undefined as never);
    await expect(x.service.complete(input)).rejects.toThrow();
    expect(x.reader.exchangeAndVerify).not.toHaveBeenCalled();
    x.intents.consume.mockResolvedValueOnce({
      intentId:randomUUID(),sessionId,workspaceId:randomUUID(),actor,
      provider:"whatsapp",providerApplicationKey:applicationKey,
      redirectUri:"https://apps.ishinaillab.com/app/auth/connect/whatsapp/embedded-v4",
      codeVerifier:"V".repeat(43)
    });
    await expect(x.service.complete(input)).rejects.toThrow();
    expect(x.reader.exchangeAndVerify).not.toHaveBeenCalled();
  });
  it("refuses provider mismatched phone/Messaging account and missing scope or expired grant",async()=>{
    for(const badGrant of [
      {businessToken,phoneNumberId:"111111111111111",messagingAccountId,
        scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],accessExpiresAt:expiration},
      {businessToken,phoneNumberId,messagingAccountId:"111111111111111",
        scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],accessExpiresAt:expiration},
      {businessToken,phoneNumberId,messagingAccountId,
        scopes:["whatsapp_business_management"],accessExpiresAt:expiration},
      {businessToken,phoneNumberId,messagingAccountId,
        scopes:[...WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES],
        accessExpiresAt:new Date("2026-11-14T12:00:01Z")}
    ]){
      const x=fixture();
      x.reader.exchangeAndVerify.mockResolvedValueOnce(badGrant);
      await expect(x.service.complete(input)).rejects.toThrow();
      expect(x.registry.linkVerified).not.toHaveBeenCalled();
    }
  });
  it("requires exact private Messaging-account/phone binding and fresh provider API readback for confirmation",async()=>{
    const x=fixture(),connectionId=randomUUID();
    x.registry.findBindingForAdministrator.mockResolvedValueOnce({
      status:"verifying",provider:"whatsapp",accountId:phoneNumberId,
      providerApplicationKey:applicationKey,
      providerConnectionId:messagingAccountId,credentialAccountId:connectionId
    });
    const r=await x.service.confirm({workspaceId,connectionId,actor});
    expect(r.status).toBe("connected");
    expect(x.reader.verifyExisting).toHaveBeenCalledWith({
      businessToken,messagingAccountId,phoneNumberId
    });
    const args=x.registry.activateVerified.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      providerApplicationKey:applicationKey,connectionId,workspaceId,
      providerConnectionId:messagingAccountId,
      credentialAccountId:connectionId,
      proof:{provider:"whatsapp",accountId:phoneNumberId}
    });
  });
  it("rejects a different app/account, missing credential and revoked permissions on confirmation",async()=>{
    const connectionId=randomUUID();
    const base={status:"verifying" as const,provider:"whatsapp",
      accountId:phoneNumberId,providerConnectionId:messagingAccountId,
      credentialAccountId:connectionId,
      providerApplicationKey:applicationKey};
    const x=fixture();
    x.registry.findBindingForAdministrator.mockResolvedValueOnce({
      ...base,providerApplicationKey:"another-app"
    });
    await expect(x.service.confirm({workspaceId,connectionId,actor})).rejects.toThrow();
    expect(x.reader.verifyExisting).not.toHaveBeenCalled();
    const y=fixture();
    y.registry.findBindingForAdministrator.mockResolvedValueOnce(base);
    y.vault.get.mockResolvedValueOnce(undefined as never);
    await expect(y.service.confirm({workspaceId,connectionId,actor})).rejects.toThrow();
    const z=fixture();
    z.registry.findBindingForAdministrator.mockResolvedValueOnce(base);
    z.reader.verifyExisting.mockResolvedValueOnce({
      scopes:["whatsapp_business_management"],accessExpiresAt:expiration
    });
    await expect(z.service.confirm({workspaceId,connectionId,actor})).rejects.toThrow();
    expect(z.registry.activateVerified).not.toHaveBeenCalled();
  });
});
