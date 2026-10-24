import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestCompiledJavaScript, digestInstalledFastUriMetadata, FAST_URI_PACKAGE_PATHS } from "../src/observability/build-identity.js";

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
  it("hashes only installed fast-uri names and versions, never lockfile or secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "ishikeit-dependency-build-"));
    try {
      const versions = ["3.1.9", "3.1.9", "3.1.9", "4.2.3"];
      for (let i = 0; i < FAST_URI_PACKAGE_PATHS.length; i++) {
        const folder = join(root, FAST_URI_PACKAGE_PATHS[i]!);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "package.json"), JSON.stringify({
          name: "fast-uri", version: versions[i]
        }));
      }
      const first = digestInstalledFastUriMetadata(root);
      expect(first).toMatch(/^[0-9a-f]{64}$/);

      writeFileSync(join(root, ".env"), "PASSWORD=private");
      writeFileSync(join(root, "package-lock.json"), '{"version":"fake"}');
      expect(digestInstalledFastUriMetadata(root)).toBe(first);

      const changed = join(root, FAST_URI_PACKAGE_PATHS[3]!, "package.json");
      writeFileSync(changed, JSON.stringify({ name: "fast-uri", version: "4.2.1" }));
      expect(digestInstalledFastUriMetadata(root)).not.toBe(first);

      writeFileSync(changed, JSON.stringify({ name: "different-package", version: "4.2.3" }));
      expect(digestInstalledFastUriMetadata(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when any installed nested dependency is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ishikeit-dependency-absent-"));
    try {
      expect(digestInstalledFastUriMetadata(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
