/**
 * Account-aware entitlement registry for future Channel Settings UI.
 * Never infer official external API privileges from a paid plan or badge.
 * Only source-backed provider/account type, OAuth grants, business permissions,
 * and live authorization proofs can enable automated operations.
 */
export type CapabilityStatus = "available" | "needs_permission" | "unsupported" | "unverified";
export interface CapabilityDetail {
  status: CapabilityStatus;
  reason: string;
}
export type CapabilityReport = Record<string, CapabilityDetail>;

type AccountEvidence =
  | {
      provider: "telegram";
      botWebhookVerified: boolean;
      businessConnectionVerified: boolean;
      businessReplyRightGranted: boolean;
      /** Optional UI label only: Telegram Premium is not a requirement for free Chat Automation. */
      observedSubscription?: "free" | "premium";
    }
  | {
      provider: "instagram";
      accountType: "personal" | "creator" | "business" | "unknown";
      oauthVerified: boolean;
      appAccess: "standard_managed" | "advanced" | "standard_unmanaged" | "unknown";
      grantedPermissions: readonly string[];
      /** Subscription is orthogonal to professional type and developer API permissions. */
      observedSubscription?: string;
    }
  | {
      provider: "messenger";
      pageVerified: boolean;
      messagingAuthorizationVerified: boolean;
    }
  | {
      provider: "whatsapp";
      businessAccountVerified: boolean;
      messagingAuthorizationVerified: boolean;
      appointmentConsentVerified: boolean;
    }
  | {
      provider: "tiktok";
      businessAccountVerified: boolean;
      messagingApiAuthorizationVerified: boolean;
    };

const available: CapabilityDetail = { status: "available", reason: "Official provider authorization verified" };
const unverified: CapabilityDetail = { status: "unverified", reason: "No reliable provider proof available" };
const missing: CapabilityDetail = { status: "needs_permission", reason: "Required provider authorization is missing" };
const unsupported: CapabilityDetail = { status: "unsupported", reason: "Official provider API does not support this account type" };

export function accountCapabilities(evidence: AccountEvidence): CapabilityReport {
  switch (evidence.provider) {
    case "telegram":
      return {
        bot_replies: evidence.botWebhookVerified ? available : unverified,
        official_account_replies: evidence.businessConnectionVerified
          ? evidence.businessReplyRightGranted ? available : missing
          : unverified
      };
    case "instagram": {
      if (evidence.accountType === "personal") {
        return { direct_messages: unsupported, comment_notifications: unsupported };
      }
      if (evidence.accountType === "unknown" || evidence.appAccess === "unknown") {
        return { direct_messages: unverified, comment_notifications: unverified };
      }
      const qualified = evidence.accountType === "creator" || evidence.accountType === "business";
      const authorized = qualified && evidence.oauthVerified
        && evidence.appAccess !== "standard_unmanaged";
      return {
        direct_messages: authorized && evidence.grantedPermissions.includes("instagram_business_manage_messages")
          ? available : missing,
        comment_notifications: authorized && evidence.grantedPermissions.includes("instagram_business_manage_comments")
          ? available : missing
      };
    }
    case "messenger":
      return { page_replies: evidence.pageVerified && evidence.messagingAuthorizationVerified
        ? available : unverified };
    case "whatsapp":
      return {
        customer_replies: evidence.businessAccountVerified && evidence.messagingAuthorizationVerified
          ? available : unverified,
        appointment_reminders: evidence.businessAccountVerified && evidence.messagingAuthorizationVerified
          && evidence.appointmentConsentVerified ? available : missing
      };
    case "tiktok":
      return { business_messaging: evidence.businessAccountVerified && evidence.messagingApiAuthorizationVerified
        ? available : missing };
  }
}
