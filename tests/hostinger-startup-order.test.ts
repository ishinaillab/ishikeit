import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Hostinger startup contract", () => {
  it("starts listening before any external provider subscription reconciliation", () => {
    const source = readFileSync(new URL("../src/processes/http.ts", import.meta.url), "utf8");
    const main = source.slice(source.indexOf("async function main(): Promise<void>"));
    const listen = main.indexOf("await server.listen(");
    const background = main.indexOf("void (async () => {");
    const reconcile = main.indexOf("await reconcileInstagramOAuthAccounts();", background);
    expect(listen).toBeGreaterThan(0);
    expect(background).toBeGreaterThan(listen);
    expect(reconcile).toBeGreaterThan(background);
    expect(main.slice(0, listen)).not.toMatch(/await reconcile(?:Instagram|Messenger)/u);
    expect(main.slice(listen, background)).toContain("outboundWorker.start()");
    expect(main.slice(listen, background)).toContain("processorWorker.start()");
  });
});
