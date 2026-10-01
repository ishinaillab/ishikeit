import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";
import { createLogger, sanitizeRequestForLog } from "../src/observability/logger.js";

describe("logger", () => {
  it("accepts secret-safe redaction paths", () => {
    const env = loadEnvironment({
      NODE_ENV: "test",
      LOG_LEVEL: "fatal"
    });

    expect(() => createLogger(env)).not.toThrow();
  });

  it("strips query strings from serialized request URLs", () => {
    expect(sanitizeRequestForLog({
      id: "req-1",
      method: "GET",
      url: "/ishikeit/oauth/tiktok/callback/?state=secret-state&auth_code=secret-code",
      headers: { authorization: "Bearer secret" }
    })).toEqual({
      id: "req-1",
      method: "GET",
      url: "/ishikeit/oauth/tiktok/callback/"
    });
  });
});
