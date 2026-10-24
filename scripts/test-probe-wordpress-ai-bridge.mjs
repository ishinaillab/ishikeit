import test from "node:test";
import assert from "node:assert/strict";
import { probeWordPressAiBridge } from "./probe-wordpress-ai-bridge.mjs";

const baseUrl = "https://www.ishinaillab.com/wp-json/ishi-ai/v1";
const token = "sensitive-dedicated-bridge-token-" + "a".repeat(40);
const ready = {
  ok: true,
  version: "0.3.1",
  schemaVersion: "1.1.1",
  tokenReady: true,
  aiEngineReady: true,
  fileApiReady: true,
  audioApiReady: true,
  botId: "private-internal-bot-id",
  secret: "must-not-be-emitted"
};

test("probe uses only the exact bearer-authenticated read-only health route", async () => {
  let requests = 0;
  const result = await probeWordPressAiBridge({
    baseUrl,
    token,
    fetchImpl: async (url, init) => {
      requests++;
      assert.equal(url.href, baseUrl + "/health");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.authorization, "Bearer " + token);
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      return new Response(JSON.stringify(ready), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(requests, 1);
  assert.equal(result.ok, true);
  assert.equal(result.bridgeVersion, "0.3.1");
  assert.equal(result.aiEngineReady, true);
  assert.ok(!JSON.stringify(result).includes("private-internal-bot-id"));
  assert.ok(!JSON.stringify(result).includes("must-not-be-emitted"));
  assert.ok(!JSON.stringify(result).includes(token));
});

test("missing credentials or unexpected hosts fail before any request", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response(); };
  const missing = await probeWordPressAiBridge({ baseUrl, fetchImpl });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_dedicated_credential");

  const unsafe = await probeWordPressAiBridge({
    baseUrl: "https://evil.example/wp-json/ishi-ai/v1",
    token,
    fetchImpl
  });
  assert.equal(unsafe.reason, "invalid_bridge_configuration");
  assert.equal(requests, 0);
});

test("rejects bridge errors without reflecting error response or token", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ error: "sensitive-token", customer: "PRIVATE MESSAGE" }),
    { status: 502, headers: { "content-type": "application/json" } }
  );
  const result = await probeWordPressAiBridge({ baseUrl, token, fetchImpl });
  assert.deepEqual(result, { ok: false, status: 502, reason: "bridge_http_failure" });
  assert.ok(!JSON.stringify(result).includes("PRIVATE MESSAGE"));
});

test("fails closed on unready AI Engine and unavailable token", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ ...ready, aiEngineReady: false, tokenReady: false }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const result = await probeWordPressAiBridge({ baseUrl, token, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge_not_ready");
  assert.equal(result.tokenReady, false);
  assert.equal(result.aiEngineReady, false);
});

test("rejects invalid and excessive response bodies without returning them", async () => {
  const samples = [
    new Response("not JSON", { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ...ready, secret: "X".repeat(6000) }), {
      status: 200, headers: { "content-type": "application/json" }
    }),
    new Response(JSON.stringify(ready), { status: 200, headers: { "content-type": "text/plain" } })
  ];

  for (const response of samples) {
    const result = await probeWordPressAiBridge({
      baseUrl, token, fetchImpl: async () => response
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_health_response");
  }
});

test("network failures never expose exception contents", async () => {
  const result = await probeWordPressAiBridge({
    baseUrl, token,
    fetchImpl: async () => {
      throw new Error("access_token=PRIVATE-MESSAGE-CONTENT");
    }
  });
  assert.deepEqual(result, { ok: false, status: null, reason: "transport_failure" });
});
