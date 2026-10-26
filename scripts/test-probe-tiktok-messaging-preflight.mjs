import test from "node:test";
import assert from "node:assert/strict";
import { probeTikTokMessagingPreflight } from "./probe-tiktok-messaging-preflight.mjs";

const opsToken = "test-ops-bearer-" + "a".repeat(40);
const statuses = {
  "/health/ready": [200, { status: "ready" }],
  "/ops/tiktok/oauth/status": [200, {
    authorized: true,
    businessId: "do-not-display",
    scopes: ["user.info.basic", "comment.list"],
    accessExpiresAt: "2026-10-27T10:00:00Z",
    refreshAvailable: true,
    accessToken: "NEVER-PRINT-ME"
  }],
  "/ops/tiktok/messaging/capabilities": [404, { status: "not_found" }],
  "/ops/tiktok/messaging/webhook/status": [401, { status: "unauthorized" }],
  "/ops/tiktok/messaging/comment-to-message/status": [404, { status: "not_found" }]
};

function fixtureFetch(overrides = {}, seen = []) {
  return async (url, options) => {
    assert.equal(url.origin, "https://apps.ishinaillab.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    seen.push({ path: url.pathname, headers: options.headers });
    const [status, body] = overrides[url.pathname] ?? statuses[url.pathname];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
}

test("preflight reads only five fixed, safe Ishikeit routes", async () => {
  const seen = [];
  const result = await probeTikTokMessagingPreflight({
    opsToken, fetchImpl: fixtureFetch({}, seen)
  });
  assert.deepEqual(seen.map((entry) => entry.path), [
    "/health/ready",
    "/ops/tiktok/oauth/status",
    "/ops/tiktok/messaging/capabilities",
    "/ops/tiktok/messaging/webhook/status",
    "/ops/tiktok/messaging/comment-to-message/status"
  ]);
  assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[1].headers.authorization, "Bearer " + opsToken);
  assert.equal(seen[2].headers.authorization, "Bearer " + opsToken);
  assert.equal(seen[3].headers.authorization, undefined);
  assert.equal(seen[4].headers.authorization, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.appReady, true);
  assert.equal(result.storedOAuthPresent, true);
  assert.equal(result.storedScopeCount, 2);
  assert.equal(result.refreshCredentialPresent, true);
  assert.equal(result.conversationReaderRegistered, false);
  assert.equal(result.webhookStatusRouteRegistered, true);
  assert.equal(result.commentToMessageRouteRegistered, false);
  assert.equal(result.businessMessagingScopeGrant, "not_verified");
  assert.equal(result.developerProductApproval, "not_checked");
  assert.equal(result.outboundMessagingAuthorizedByPreflight, false);
  for (const privateValue of [opsToken, "do-not-display", "NEVER-PRINT-ME", "comment.list"]) {
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test("registered TikTok reader and comment routes do not imply approved API grants", async () => {
  const result = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: fixtureFetch({
      "/ops/tiktok/messaging/capabilities": [400, { status: "invalid_request" }],
      "/ops/tiktok/messaging/comment-to-message/status": [401, { status: "unauthorized" }]
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.conversationReaderRegistered, true);
  assert.equal(result.commentToMessageRouteRegistered, true);
  assert.equal(result.outboundMessagingAuthorizedByPreflight, false);
});

test("missing or malformed ops credential prevents all requests", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response("{}"); };
  for (const bad of [undefined, "short", "x".repeat(1025), "a".repeat(40) + "\n"]) {
    const result = await probeTikTokMessagingPreflight({ opsToken: bad, fetchImpl });
    assert.deepEqual(result, { ok: false, reason: "missing_ops_credential" });
  }
  assert.equal(requests, 0);
});

test("wrong ops token fails without querying capability or webhook routes", async () => {
  const seen = [];
  const result = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: fixtureFetch({
      "/ops/tiktok/oauth/status": [401, { status: "unauthorized", token: "SECRET" }]
    }, seen)
  });
  assert.deepEqual(result, { ok: false, reason: "oauth_status_unavailable", httpStatus: 401 });
  assert.deepEqual(seen.map((item) => item.path), [
    "/health/ready", "/ops/tiktok/oauth/status"
  ]);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("app readiness failure ends the probe without touching operational routes", async () => {
  const seen = [];
  const result = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: fixtureFetch({
      "/health/ready": [503, { status: "not_ready" }]
    }, seen)
  });
  assert.deepEqual(result, { ok: false, reason: "app_not_ready", httpStatus: 503 });
  assert.equal(seen.length, 1);
});

test("unexpected route responses and network failures fail closed", async () => {
  const unusual = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: fixtureFetch({
      "/ops/tiktok/messaging/capabilities": [200, { secret: "NOT-ALLOWED" }]
    })
  });
  assert.deepEqual(unusual, { ok: false, reason: "unexpected_route_response" });
  const error = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: async () => { throw new Error("access_token=DO-NOT-LOG"); }
  });
  assert.deepEqual(error, { ok: false, reason: "app_not_ready", httpStatus: null });
});

test("bad OAuth response schema and oversized payload cannot leak fields", async () => {
  const wrong = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: fixtureFetch({
      "/ops/tiktok/oauth/status": [200, { scopes: ["sensitive-scope"], token: "private" }]
    })
  });
  assert.equal(wrong.reason, "oauth_status_unavailable");

  const large = await probeTikTokMessagingPreflight({
    opsToken,
    fetchImpl: async (url, options) => {
      if (url.pathname !== "/ops/tiktok/oauth/status") {
        return fixtureFetch()(url, options);
      }
      return new Response(JSON.stringify({ authorized: true, secret: "z".repeat(5000) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(large.reason, "oauth_status_unavailable");
  assert.equal(JSON.stringify(large).includes("z".repeat(100)), false);
});
