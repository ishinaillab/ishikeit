import { describe, expect, it } from "vitest";
import { accountCapabilities } from "../src/channels/account-capabilities.js";
import type { ObservedAccountFact } from "../src/policy/provider-contract.js";

const now = new Date("2026-11-02T04:00:00Z");
const granted = (key: string): ObservedAccountFact => ({
  provider: key.split(".")[0]!, accountId: "acct-a", key, state: "granted", source: "provider_api", sourceReference: "live-readback",
  observedAt: "2026-11-02T03:00:00Z", validUntil: "2026-11-02T05:00:00Z"
});

describe("manifest-derived account capability projection", () => {
  it("enables free Telegram bot and official-account replies with verified live rights", () => {
    const result = accountCapabilities({
      provider: "telegram", accountId: "acct-a", facts: [
        granted("telegram.bot_webhook"), granted("telegram.business_connection"),
        granted("telegram.rights.can_reply")
      ], installedFeatures: ["bot_replies", "official_account_replies"]
    }, now);
    expect(result.bot_replies?.status).toBe("available");
    expect(result.official_account_replies?.status).toBe("available");
  });
  it("does not use Premium or Business labels as substitute authorization", () => {
    const result = accountCapabilities({
      provider: "telegram", accountId: "acct-a", accountKind: "premium",
      facts: [granted("telegram.bot_webhook")],
      installedFeatures: ["bot_replies", "official_account_replies"]
    }, now);
    expect(result.bot_replies?.status).toBe("available");
    expect(result.official_account_replies?.status).toBe("unverified");
  });
  it.each(["creator", "business"])(
    "supports %s Instagram professional accounts with fresh OAuth grants", (accountKind) => {
      const result = accountCapabilities({
        provider: "instagram", accountId: "acct-a", accountKind,
        facts: [granted("instagram.oauth"), granted("instagram.app_access"),
          granted("instagram.scope.instagram_business_manage_messages")],
        installedFeatures: ["direct_messages", "comment_notifications"]
      }, now);
      expect(result.direct_messages?.status).toBe("available");
      expect(result.comment_notifications?.status).toBe("unverified");
    }
  );
  it("fails closed for Instagram personal accounts even with received grants", () => {
    const result = accountCapabilities({
      provider: "instagram", accountId: "acct-a", accountKind: "personal",
      facts: [granted("instagram.oauth"), granted("instagram.app_access"),
        granted("instagram.scope.instagram_business_manage_messages")],
      installedFeatures: ["direct_messages"]
    }, now);
    expect(result.direct_messages?.status).toBe("unsupported");
  });
  it("does not grant capability solely because a source rule exists", () => {
    const result = accountCapabilities({
      provider: "instagram", accountId: "acct-a", accountKind: "business",
      facts: [granted("instagram.oauth"), granted("instagram.app_access"),
        granted("instagram.scope.instagram_business_manage_messages")],
      installedFeatures: []
    }, now);
    expect(result.direct_messages?.status).toBe("unverified");
  });
  it("requires both account and consent proof for a WhatsApp appointment reminder", () => {
    const base = {
      provider: "whatsapp", accountId: "acct-a", facts: [
        granted("whatsapp.business_account"), granted("whatsapp.messaging_authorization")
      ], installedFeatures: ["customer_replies", "appointment_reminders"]
    };
    expect(accountCapabilities(base, now).customer_replies?.status).toBe("available");
    expect(accountCapabilities(base, now).appointment_reminders?.status).toBe("unverified");
    expect(accountCapabilities({
      ...base, facts: [...base.facts, granted("whatsapp.recipient_appointment_consent")]
    }, now).appointment_reminders?.status).toBe("available");
  });
  it("keeps TikTok Messaging pending without separately approved API access", () => {
    const result = accountCapabilities({
      provider: "tiktok", accountId: "acct-a", facts: [granted("tiktok.business_account")],
      installedFeatures: ["business_messaging"]
    }, now);
    expect(result.business_messaging?.status).toBe("unverified");
  });
  it("returns no invented features for an unknown provider", () => {
    expect(accountCapabilities({
      provider: "brand_new_provider", accountId: "acct-a", facts: [], installedFeatures: []
    }, now)).toEqual({});
  });
});
