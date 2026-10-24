import { pathToFileURL } from "node:url";

const BRIDGE_ORIGIN = "https://www.ishinaillab.com";
const BRIDGE_BASE_PATH = "/wp-json/ishi-ai/v1";
const MAX_HEALTH_BYTES = 4096;

/**
 * Strictly read-only probe of the private WordPress AI Bridge health route.
 * Never invokes /turn, /files, /transcribe, AI generation, or provider APIs.
 * Returns only allowlisted status fields; never logs raw response or token.
 */
export async function probeWordPressAiBridge({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 12000
} = {}) {
  if (typeof token !== "string"
    || token.length < 32
    || token.length > 1024
    || !/^[\x21-\x7e]+$/.test(token)) {
    return { ok: false, status: null, reason: "missing_dedicated_credential" };
  }

  let url;
  try {
    const base = new URL(baseUrl);
    if (
      base.origin !== BRIDGE_ORIGIN
      || base.pathname.replace(/\/+$/, "") !== BRIDGE_BASE_PATH
      || base.search !== ""
      || base.hash !== ""
    ) {
      return { ok: false, status: null, reason: "invalid_bridge_configuration" };
    }
    url = new URL(BRIDGE_BASE_PATH + "/health", BRIDGE_ORIGIN);
  } catch {
    return { ok: false, status: null, reason: "invalid_bridge_configuration" };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(
        Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000
          ? timeoutMs
          : 12000
      )
    });
  } catch {
    return { ok: false, status: null, reason: "transport_failure" };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: Number.isInteger(response.status) ? response.status : null,
      reason: "bridge_http_failure"
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!contentType.includes("application/json")
    || (length > MAX_HEALTH_BYTES && Number.isFinite(length))) {
    return { ok: false, status: response.status, reason: "invalid_health_response" };
  }

  let raw = "";
  let reader;
  try {
    reader = response.body?.getReader();
    if (reader === undefined) {
      return { ok: false, status: response.status, reason: "invalid_health_response" };
    }
    const decoder = new TextDecoder();
    let bytesRead = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_HEALTH_BYTES) {
        return { ok: false, status: response.status, reason: "invalid_health_response" };
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return { ok: false, status: response.status, reason: "invalid_health_response" };
  } finally {
    if (reader !== undefined) void reader.cancel().catch(() => undefined);
  }

  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, status: response.status, reason: "invalid_health_response" };
    }
    const version = typeof data.version === "string" && /^\d+\.\d+\.\d+$/.test(data.version)
      ? data.version
      : null;
    const schemaVersion = data.schemaVersion === "1.1.1" ? "1.1.1" : null;
    const result = {
      status: response.status,
      bridgeVersion: version,
      schemaVersion,
      tokenReady: data.tokenReady === true,
      aiEngineReady: data.aiEngineReady === true,
      fileApiReady: data.fileApiReady === true,
      audioApiReady: data.audioApiReady === true
    };
    const ok = data.ok === true && version !== null && schemaVersion === "1.1.1"
      && result.tokenReady && result.aiEngineReady;
    return ok
      ? { ok: true, ...result }
      : { ok: false, reason: "bridge_not_ready", ...result };
  } catch {
    return { ok: false, status: response.status, reason: "invalid_health_response" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probeWordPressAiBridge({
    baseUrl: process.env.WORDPRESS_AI_BRIDGE_URL,
    token: process.env.ISHI_AI_BRIDGE_TOKEN
  });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
