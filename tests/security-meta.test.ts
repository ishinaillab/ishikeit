import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaChallenge, verifyMetaSignature } from "../src/security/meta.js";

describe("Meta security",()=>{
  it("verifies exact raw bytes",()=>{
    const raw=Buffer.from('{  "x": 1 }\n');
    const sig="sha256="+createHmac("sha256","secret").update(raw).digest("hex");
    expect(verifyMetaSignature(raw,sig,"secret")).toBe(true);
    expect(verifyMetaSignature(Buffer.from("{}"),sig,"secret")).toBe(false);
  });
  it("verifies subscription challenge",()=>{
    expect(verifyMetaChallenge("subscribe","token","123","token")).toBe("123");
    expect(verifyMetaChallenge("subscribe","wrong","123","token")).toBeUndefined();
  });
});
