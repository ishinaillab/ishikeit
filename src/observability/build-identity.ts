import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A content identity for deployed, compiled application code.
 *
 * GitHub and Hostinger may build from different checkout layouts, and an
 * application health check alone cannot prove which deployment is running.
 * Hashing only compiled JavaScript avoids secrets, customer data, .env files,
 * timestamps, and Hostinger-managed deployment directory identifiers.
 */
export interface BuildIdentity {
  artifactSha256: string | null;
  /**
   * A digest of four installed fast-uri package names/versions, not the npm
   * lockfile. Null means dependency layout could not be independently read.
   * This does NOT fingerprint executable dependency code.
   */
  installedFastUriSha256: string | null;
  /** Informational only: the build environment may not provide a revision. */
  sourceRevision: string | null;
}

export function digestCompiledJavaScript(root: string): string | null {
  try {
    const pending = [root];
    const filePaths: string[] = [];

    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
          // Do not traverse symlinks, and never read .env, key or data files.
          filePaths.push(fullPath);
        }
      }
    }

    if (filePaths.length === 0) return null;
    filePaths.sort((a, b) =>
      relative(root, a).localeCompare(relative(root, b), "en")
    );
    const hasher = createHash("sha256");
    for (const filePath of filePaths) {
      const name = relative(root, filePath).split(sep).join("/");
      const code = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
      hasher.update(name, "utf8");
      hasher.update("\0", "utf8");
      hasher.update(code, "utf8");
      hasher.update("\0", "utf8");
    }
    return hasher.digest("hex");
  } catch {
    // Deployed health must never fail solely because a diagnostic is absent.
    return null;
  }
}

/**
 * These four locations are the production npm tree resolved from the locked
 * Fastify / Ajv dependencies as of October 24, 2026. Do NOT infer installed
 * versions from package-lock.json: runtime must read actual node_modules.
 *
 * A missing package or a different npm hoist layout returns null, not an
 * unverified success. Paths, names and versions are fixed, public metadata.
 */
export const FAST_URI_PACKAGE_PATHS = [
  "node_modules/@fastify/ajv-compiler/node_modules/ajv/node_modules/fast-uri",
  "node_modules/ajv-formats/node_modules/fast-uri",
  "node_modules/fast-json-stringify/node_modules/ajv/node_modules/fast-uri",
  "node_modules/fast-uri"
] as const;

export function digestInstalledFastUriMetadata(appRoot: string): string | null {
  try {
    const digest = createHash("sha256");
    for (const path of FAST_URI_PACKAGE_PATHS) {
      const serialized = readFileSync(join(appRoot, path, "package.json"), "utf8");
      if (Buffer.byteLength(serialized, "utf8") > 8192) return null;
      const metadata: unknown = JSON.parse(serialized);
      if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
      }
      const obj = metadata as Record<string, unknown>;
      if (
        obj["name"] !== "fast-uri"
        || typeof obj["version"] !== "string"
        || !/^\d+\.\d+\.\d+$/.test(obj["version"])
      ) {
        return null;
      }
      digest.update(path, "utf8");
      digest.update("\0", "utf8");
      digest.update(obj["version"], "utf8");
      digest.update("\0", "utf8");
    }
    return digest.digest("hex");
  } catch {
    // Missing installation metadata, alternate layout, or invalid JSON:
    // never turn this into a liveness/readiness failure or false assertion.
    return null;
  }
}

export function runtimeBuildIdentity(): BuildIdentity {
  const revision = process.env.SOURCE_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
  const distRoot = fileURLToPath(new URL("../", import.meta.url));
  const appRoot = fileURLToPath(new URL("../../", import.meta.url));

  return {
    artifactSha256: digestCompiledJavaScript(distRoot),
    installedFastUriSha256: digestInstalledFastUriMetadata(appRoot),
    sourceRevision: /^[0-9a-f]{40}$/i.test(revision)
      ? revision.toLowerCase()
      : null
  };
}
