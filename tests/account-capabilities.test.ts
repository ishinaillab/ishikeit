import { describe, expect, it } from "vitest";
import { accountCapabilities } from "../src/channels/account-capabilities.js";

describe("evidence-backed account capabilities", () => {
  it("supports Free Telegram Chat Automation without any Premium subscription", () => {
    const result = accountCapabilities({
      provider: "telegram", botWebhookVerified: true,
      businessConnectionVerified: true, businessReplyRightGranted: true,
      observedSubscription: "free"
    });
    expect(result.official_account_replies?.status).toBe("available");
    expect(result.bot_replies?.status).toBe("available");
  });
  it("does not grant Telegram connected-account replies based on subscription alone", () => {
    const result = accountCapabilities({
      provider: "telegram", botWebhookVerified: true,
      businessConnectionVerified: true, businessReplyRightGranted: false,
      observedSubscription: "premium"
    });
    expect(result.official_account_replies?.status).toBe("needs_permission");
  });
  it("keeps ordinary Personal Instagram account unsupported by the official API", () => {
    const result = accountCapabilities({
      provider: "instagram", accountType: "personal", oauthVerified: true,
      appAccess: "advanced", grantedPermissions: ["instagram_business_manage_messages"],
      observedSubscription: "premium"
    });
    expect(result.direct_messages?.status).toBe("unsupported");
  });
  it.each(["creator", "business"] as const)(
    "allows eligible free Instagram %s professional accounts with required access", (accountType) => {
      const result = accountCapabilities({
        provider: "instagram", accountType, oauthVerified: true,
        appAccess: "standard_managed",
        grantedPermissions: ["instagram_business_manage_messages", "instagram_business_manage_comments"]
      });
      expect(result.direct_messages?.status).toBe("available");
      expect(result.comment_notifications?.status).toBe("available");
    }
  );
  it("does not confuse paid Instagram plans with API permissions", () => {
    const result = accountCapabilities({
      provider: "instagram", accountType: "business", oauthVerified: true,
      appAccess: "standard_unmanaged", grantedPermissions: [],
      observedSubscription: "Meta One Premium"
    });
    expect(result.direct_messages?.status).toBe("needs_permission");
  });
  it("keeps unverified plan, role, and API permissions from enabling messages", () => {
    const result = accountCapabilities({
      provider: "instagram", accountType: "unknown", oauthVerified: false,
      appAccess: "unknown", grantedPermissions: []
    });
    expect(result.direct_messages?.status).toBe("unverified");
  });
  it("does not permit WhatsApp reminders solely because the template was approved", () => {
    const result = accountCapabilities({
      provider: "whatsapp", businessAccountVerified: true,
      messagingAuthorizationVerified: true, appointmentConsentVerified: false
    });
    expect(result.customer_replies?.status).toBe("available");
    expect(result.appointment_reminders?.status).toBe("needs_permission");
  });
  it("does not conflate approved TikTok Business API with pending Messaging API approval", () => {
    const result = accountCapabilities({
      provider: "tiktok", businessAccountVerified: true,
      messagingApiAuthorizationVerified: false
    });
    expect(result.business_messaging?.status).toBe("needs_permission");
  });
});
