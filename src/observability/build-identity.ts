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

export function runtimeBuildIdentity(): BuildIdentity {
  const revision = process.env.SOURCE_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
  const distRoot = fileURLToPath(new URL("../", import.meta.url));

  return {
    artifactSha256: digestCompiledJavaScript(distRoot),
    sourceRevision: /^[0-9a-f]{40}$/i.test(revision)
      ? revision.toLowerCase()
      : null
  };
}
