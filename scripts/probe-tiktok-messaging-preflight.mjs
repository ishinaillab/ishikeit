import { pathToFileURL } from "node:url";

const ORIGIN = "https://apps.ishinaillab.com";
const MAX_BYTES = 4096;
const TIMEOUT_MS = 10000;

/**
 * Read-only Stage 1 TikTok Business Messaging preflight.
 *
 * This does not call TikTok, begin OAuth, reconcile webhooks, inspect
 * conversations or change runtime configuration. It checks only Ishikeit's
 * health, stored OAuth status and whether protected routes are registered.
 *
 * TikTok developer-product approval and account-level messaging entitlement
 * CANNOT be established by this preflight. Never use it to authorize sending.
 */
export async function probeTikTokMessagingPreflight({
  opsToken,
  fetchImpl = fetch
} = {}) {
  if (
    typeof opsToken !== "string"
    || opsToken.length < 32
    || opsToken.length > 1024
    || !/^[\x21-\x7e]+$/u.test(opsToken)
  ) {
    return { ok: false, reason: "missing_ops_credential" };
  }

  async function read(path, authorization = true, parseJson = false) {
    let response;
    try {
      response = await fetchImpl(new URL(path, ORIGIN), {
        method: "GET",
        headers: authorization
          ? { authorization: "Bearer " + opsToken, accept: "application/json" }
          : { accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch {
      return { status: null, failed: true };
    }

    if (!Number.isInteger(response.status)) {
      return { status: null, failed: true };
    }
    if (!parseJson || response.status !== 200) {
      return { status: response.status, failed: false };
    }

    if (!(response.headers.get("content-type") ?? "").toLowerCase()
      .includes("application/json")) {
      return { status: response.status, failed: true };
    }

    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BYTES) {
      return { status: response.status, failed: true };
    }

    let reader;
    try {
      reader = response.body?.getReader();
      if (!reader) return { status: response.status, failed: true };
      const decoder = new TextDecoder();
      let text = "";
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) {
          return { status: response.status, failed: true };
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const data = JSON.parse(text);
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return { status: response.status, failed: true };
      }
      return { status: response.status, failed: false, data };
    } catch {
      return { status: response.status, failed: true };
    } finally {
      if (reader) void reader.cancel().catch(() => undefined);
    }
  }

  const health = await read("/health/ready", false, true);
  if (health.failed || health.status !== 200 || health.data?.status !== "ready") {
    return { ok: false, reason: "app_not_ready", httpStatus: health.status };
  }

  const oauth = await read("/ops/tiktok/oauth/status", true, true);
  if (oauth.failed || oauth.status !== 200 || typeof oauth.data?.authorized !== "boolean") {
    return { ok: false, reason: "oauth_status_unavailable", httpStatus: oauth.status };
  }

  const scopeCount = Array.isArray(oauth.data.scopes)
    && oauth.data.scopes.every((scope) => typeof scope === "string")
    && oauth.data.scopes.length <= 200
    ? oauth.data.scopes.length
    : null;

  // Missing required query parameters must return 400 when this guarded
  // route is registered. It never invokes the underlying TikTok API.
  const capability = await read("/ops/tiktok/messaging/capabilities");
  // Unauthenticated requests return 401 before any provider read or mutation.
  const webhook = await read("/ops/tiktok/messaging/webhook/status", false);
  const comment = await read("/ops/tiktok/messaging/comment-to-message/status", false);

  const statusCodes = [capability, webhook, comment];
  if (statusCodes.some((item) => item.failed)) {
    return { ok: false, reason: "route_inspection_failed" };
  }
  if (
    ![400, 404].includes(capability.status)
    || ![401, 404].includes(webhook.status)
    || ![401, 404].includes(comment.status)
  ) {
    return { ok: false, reason: "unexpected_route_response" };
  }

  return {
    ok: true,
    appReady: true,
    storedOAuthPresent: oauth.data.authorized,
    storedScopeCount: scopeCount,
    refreshCredentialPresent: oauth.data.refreshAvailable === true,
    conversationReaderRegistered: capability.status === 400,
    webhookStatusRouteRegistered: webhook.status === 401,
    commentToMessageRouteRegistered: comment.status === 401,
    developerProductApproval: "not_checked",
    businessMessagingScopeGrant: "not_verified",
    outboundMessagingAuthorizedByPreflight: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probeTikTokMessagingPreflight({
    opsToken: process.env.OPS_METRICS_TOKEN
  });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
