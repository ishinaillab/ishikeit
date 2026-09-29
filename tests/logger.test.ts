import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";
import { createLogger } from "../src/observability/logger.js";

describe("logger", () => {
  it("accepts secret-safe redaction paths", () => {
    const env = loadEnvironment({
      NODE_ENV: "test",
      LOG_LEVEL: "fatal"
    });

    expect(() => createLogger(env)).not.toThrow();
  });
});
