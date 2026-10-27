import { describe, expect, it } from "vitest";
import { standardMetaReplyEligibility } from "../src/dispatch/meta-customer-window.js";

const now = new Date("2026-10-27T08:00:00.000Z");

describe("Meta standard customer service window", () => {
  it("allows recent customer messages", () => {
    expect(standardMetaReplyEligibility("2026-10-27T07:30:00.000Z", now)).toBe("eligible");
  });
  it("rejects missing and invalid provider timestamps", () => {
    expect(standardMetaReplyEligibility(undefined, now)).toBe("missing_timestamp");
    expect(standardMetaReplyEligibility("invalid", now)).toBe("invalid_timestamp");
    expect(standardMetaReplyEligibility("2026-10-28T08:00:00.000Z", now)).toBe("invalid_timestamp");
  });
  it("rejects expired windows and a five-minute boundary margin", () => {
    expect(standardMetaReplyEligibility("2026-10-26T08:00:00.000Z", now)).toBe("outside_window");
    expect(standardMetaReplyEligibility("2026-10-26T08:04:59.000Z", now)).toBe("outside_window");
    expect(standardMetaReplyEligibility("2026-10-26T08:05:01.000Z", now)).toBe("eligible");
  });
});
