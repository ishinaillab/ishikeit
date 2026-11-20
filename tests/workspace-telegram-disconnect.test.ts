import {describe,expect,it,vi} from "vitest";
import {TelegramNativeBusinessReader} from
  "../src/auth/workspace-telegram-oidc.js";
import {TelegramBusinessDisconnectVerifier} from
  "../src/auth/workspace-telegram-disconnect.js";
import type {ProviderDisconnectBinding} from
  "../src/persistence/active-disconnect-finalizer.js";

const base:ProviderDisconnectBinding={
  workspaceId:"f9dbbbdc-e69c-44cb-b3c2-39c2560d0f01",
  connectionId:"96a0b8f8-6467-459a-80ab-d33a11c335f8",
  frozenGeneration:3,provider:"telegram",
  providerAccountId:"111222333",
  providerApplicationKey:"telegram-oidc-123456789",
  providerConnectionId:"bot_business_connection_123"
};
const disabled={
  connectionId:"bot_business_connection_123",
  ownerId:"111222333",enabled:false,canReply:false
};
describe("Telegram Business provider-verified active disconnect readback",()=>{
  it("requires exact disabled owner, bot and connection; returns fresh read-only proof",async()=>{
    const inspect=vi.fn().mockResolvedValue(disabled);
    const adapter=new TelegramBusinessDisconnectVerifier({inspect},"123456789");
    const evidence=await adapter.verifyDisconnected(base);
    expect(inspect).toHaveBeenCalledExactlyOnceWith(base.providerConnectionId);
    expect(evidence).toMatchObject({
      disconnected:true,provider:"telegram",
      providerAccountId:base.providerAccountId,
      providerApplicationKey:base.providerApplicationKey,
      providerConnectionId:base.providerConnectionId,
      method:"telegram_business_disabled"
    });
    expect(Date.now()-Date.parse(evidence.observedAt)).toBeLessThan(5000);
  });
  it("rejects another bot, provider and missing business session before provider HTTP",async()=>{
    const inspect=vi.fn().mockResolvedValue(disabled);
    const adapter=new TelegramBusinessDisconnectVerifier({inspect},"123456789");
    for(const bad of [
      {...base,providerApplicationKey:"telegram-oidc-987654321"},
      {...base,provider:"instagram"},
      {...base,providerConnectionId:null},
      {...base,providerConnectionId:"abc"}
    ]) await expect(adapter.verifyDisconnected(bad)).rejects.toThrow(/bound/i);
    expect(inspect).not.toHaveBeenCalled();
  });
  it("does not treat still-enabled, wrong owner or wrong connection as revoked",async()=>{
    for(const mismatch of [
      {...disabled,enabled:true},
      {...disabled,ownerId:"111222334"},
      {...disabled,connectionId:"different_business_session"}
    ]){
      const inspect=vi.fn().mockResolvedValue(mismatch);
      const adapter=new TelegramBusinessDisconnectVerifier({inspect},"123456789");
      await expect(adapter.verifyDisconnected(base)).rejects.toThrow(/still enabled|mismatch/i);
      expect(inspect).toHaveBeenCalledExactlyOnceWith(base.providerConnectionId);
    }
  });
  it("refuses unavailable, revoked-token or deleted-session provider errors without proof",async()=>{
    const inspect=vi.fn().mockRejectedValue(new Error("Telegram Business readback unavailable"));
    const adapter=new TelegramBusinessDisconnectVerifier({inspect},"123456789");
    await expect(adapter.verifyDisconnected(base)).rejects.toThrow(/unavailable/i);
  });
  it("uses the official exact Bot API getBusinessConnection readback without a send/revoke",async()=>{
    const fakeFetch=vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
      const endpoint=typeof url==="string"?url:url instanceof URL?url.href:url.url;
      expect(endpoint).toContain("/getBusinessConnection");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      if(typeof init?.body!=="string")throw Error("Missing official business ID readback");
      const request=JSON.parse(init.body) as {business_connection_id:string};
      expect(request.business_connection_id).toBe(base.providerConnectionId);
      return Promise.resolve(new Response(JSON.stringify({
        ok:true,result:{
          id:base.providerConnectionId,user:{id:111222333},
          is_enabled:false,rights:{can_reply:false}
        }
      }),{status:200}));
    });
    const reader=new TelegramNativeBusinessReader({
      botToken:"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      fetchImpl:fakeFetch
    });
    const adapter=new TelegramBusinessDisconnectVerifier(reader,"123456789");
    expect((await adapter.verifyDisconnected(base)).method).toBe("telegram_business_disabled");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
  it("requires a valid official Telegram bot numeric client identity",()=>{
    const inspect=vi.fn().mockResolvedValue(disabled);
    expect(()=>new TelegramBusinessDisconnectVerifier({inspect},"not-a-bot"))
      .toThrow();
  });
});
