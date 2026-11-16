import {describe,expect,it} from "vitest";
import {loadEnvironment} from "../src/config/env.js";

const root={
  NODE_ENV:"production",
  DATABASE_URL:"postgresql://example",
  META_APP_SECRET:"a".repeat(32),
  META_WEBHOOK_VERIFY_TOKEN:"verify-token-1234",
  BROWSER_AUTH_ENABLED:"true",
  BROWSER_AUTH_ORIGIN:"https://apps.ishinaillab.com/",
  SUPABASE_AUTH_PROJECT_URL:"https://example.supabase.co",
  SUPABASE_AUTH_PUBLISHABLE_KEY:"sb_publishable_"+"a".repeat(32),
  BROWSER_AUTH_ENCRYPTION_KEY_B64:Buffer.alloc(32,1).toString("base64"),
  BROWSER_AUTH_CSRF_KEY_B64:Buffer.alloc(32,2).toString("base64"),
  OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64:Buffer.alloc(32,3).toString("base64")
};
describe("WhatsApp Embedded Signup v4 owner activation safety",()=>{
  it("defaults OFF with no Meta SDK or provider keys required",()=>{
    const env=loadEnvironment({
      NODE_ENV:"production",DATABASE_URL:"postgresql://example",
      META_APP_SECRET:"a".repeat(32),
      META_WEBHOOK_VERIFY_TOKEN:"verify-token-1234"
    });
    expect(env.BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED).toBe(false);
  });
  it("rejects v4 feature enablement without AAL2 BFF, Meta config, encryption custody",()=>{
    expect(()=>loadEnvironment({
      NODE_ENV:"production",DATABASE_URL:"postgresql://example",
      META_APP_SECRET:"a".repeat(32),
      META_WEBHOOK_VERIFY_TOKEN:"verify-token-1234",
      BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED:"true"
    })).toThrow();
    expect(()=>loadEnvironment({
      ...root,BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED:"true"
    })).toThrow(/META_WHATSAPP_EMBEDDED_V4_CONFIG_ID/);
    expect(()=>loadEnvironment({
      ...root,BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED:"true",
      META_WHATSAPP_EMBEDDED_V4_CONFIG_ID:"bad"
    })).toThrow();
  });
  it("accepts exact off-by-default owner-approved app config without enabling messaging dispatcher",()=>{
    const env=loadEnvironment({
      ...root,BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED:"true",
      META_WHATSAPP_EMBEDDED_V4_CONFIG_ID:"123456789012345"
    });
    expect(env.BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED).toBe(true);
    expect(env.ACTION_DISPATCH_ENABLED_EFFECTIVE).toBe(false);
    expect(env.PROCESSOR_ENABLED).toBe(false);
  });
});
