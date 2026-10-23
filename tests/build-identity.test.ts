import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestCompiledJavaScript } from "../src/observability/build-identity.js";

describe("compiled build identity", () => {
  it("is stable across path order and CRLF/LF, and excludes files that could contain secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "ishikeit-build-identity-"));
    try {
      mkdirSync(join(root, "processes"));
      writeFileSync(join(root, "processes", "http.js"), "export const v = 1;\r\n");
      writeFileSync(join(root, "version.js"), "export const schema = 3;\n");
      const before = digestCompiledJavaScript(root);
      expect(before).toMatch(/^[0-9a-f]{64}$/);

      writeFileSync(join(root, "processes", "http.js"), "export const v = 1;\n");
      writeFileSync(join(root, ".env"), "SECRET_DO_NOT_READ=foo");
      writeFileSync(join(root, "private-message.json"), "{\"private\":true}");
      writeFileSync(join(root, "ignored.js.map"), "not a compiled runtime JavaScript file");
      expect(digestCompiledJavaScript(root)).toBe(before);

      writeFileSync(join(root, "version.js"), "export const schema = 4;\n");
      expect(digestCompiledJavaScript(root)).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for missing or empty runtime builds without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "ishikeit-empty-build-"));
    try {
      expect(digestCompiledJavaScript(root)).toBeNull();
      expect(digestCompiledJavaScript(join(root, "missing"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
