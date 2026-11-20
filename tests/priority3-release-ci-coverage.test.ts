import {readFile} from "node:fs/promises";
import {describe,expect,it} from "vitest";

describe("Priority 3 protected main integration test coverage",()=>{
  it("runs native app-scoped rights and PostgreSQL atomic release fencing in the protected PG17 CI job",async()=>{
    const ci=await readFile(".github/workflows/ci.yml","utf8");
    expect(ci).toContain("outbox-postgres-integration:");
    expect(ci).toContain("image: postgres:17");
    expect(ci).toContain(
      "run: npx vitest run tests/workspace-account-capabilities-postgres.integration.test.ts "+
      "tests/priority3-release-fence-postgres.integration.test.ts --no-file-parallelism"
    );
    expect(ci).toContain("tests/account-capability-facts-postgres.integration.test.ts");
    expect(ci).toContain("tests/workspace-connections-postgres.integration.test.ts");
    expect(ci).toContain("node --test scripts/test-verify-priority3-github-release.mjs");
    expect(ci).toContain("node --test scripts/test-priority3-protected-hostinger-release.mjs scripts/test-priority3-protected-hostinger-workflow.mjs");
    expect(ci).toContain("tests/priority3-native-outbox-write-fence-postgres.integration.test.ts --no-file-parallelism");
    expect(ci).toContain("node --test scripts/test-priority3-protected-schema-workflow.mjs scripts/test-priority3-protected-schema-python.mjs scripts/test-priority3-protected-schema-lease.mjs");
    expect(ci).toContain("node --test scripts/test-priority3-protected-schema-lease-postgres.mjs");
    expect(ci).toContain("node --test scripts/test-priority3-protected-schema-release-e2e-postgres.mjs");
    expect(ci).toContain("run: node --test scripts/test-priority3-protected-schema-postgres.mjs");
  });
});
