import { describe, expect, it } from "vitest";
import { isApprovedFirstOwnerActionContext } from "../src/auth/provisioning-action-context.js";

const permitted = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "ishinaillab/ishikeit",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF:
    "ishinaillab/ishikeit/.github/workflows/initial-admin-provisioning.yml@refs/heads/main"
} as const;

describe("protected one-time first-owner provisioning runtime", () => {
  it("accepts only the explicitly configured manual main-branch workflow context", () => {
    expect(isApprovedFirstOwnerActionContext(permitted)).toBe(true);
    expect(isApprovedFirstOwnerActionContext({...permitted,GITHUB_JOB:"provision"}))
      .toBe(true);
  });

  it("refuses the legacy cron schedule even when all other workflow metadata matches", () => {
    expect(isApprovedFirstOwnerActionContext({
      ...permitted,GITHUB_EVENT_NAME:"schedule"
    })).toBe(false);
  });

  it("refuses unreviewed PR/push triggers and branch/repository mismatch", () => {
    for(const env of [
      {...permitted,GITHUB_EVENT_NAME:"push"},
      {...permitted,GITHUB_EVENT_NAME:"pull_request"},
      {...permitted,GITHUB_REF:"refs/heads/test"},
      {...permitted,GITHUB_REF:"refs/pull/1/merge"},
      {...permitted,GITHUB_REPOSITORY:"foreign/ishikeit"},
      {...permitted,GITHUB_WORKFLOW_REF:
        "ishinaillab/ishikeit/.github/workflows/ci.yml@refs/heads/main"},
      {...permitted,GITHUB_WORKFLOW_REF:
        "ishinaillab/ishikeit/.github/workflows/initial-admin-provisioning.yml@refs/heads/test"}
    ])expect(isApprovedFirstOwnerActionContext(env)).toBe(false);
  });

  it("refuses a local or incomplete environment, even with forged approval text", () => {
    expect(isApprovedFirstOwnerActionContext({})).toBe(false);
    for(const key of Object.keys(permitted) as Array<keyof typeof permitted>){
      const missing:Record<string,string|undefined>={...permitted};
      delete missing[key];
      expect(isApprovedFirstOwnerActionContext(missing)).toBe(false);
    }
  });
});
