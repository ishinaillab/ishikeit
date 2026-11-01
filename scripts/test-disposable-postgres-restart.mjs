// CI-only fault injection: restarts exactly the ephemeral PostgreSQL 17 GitHub
// service container, NEVER a named or production database.
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresDatabase } from "../dist/persistence/postgres.js";

const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
const containerId = process.env.DISPOSABLE_PG_CONTAINER_ID;
if (!connectionString || !containerId || !/^[a-f0-9]{12,64}$/u.test(containerId)) {
  throw new Error("Disposable PostgreSQL service ID and test database URI are required");
}
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol)
  || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)
  || target.pathname !== "/ishikeit_outbox_test" || target.port !== "5432") {
  throw new Error("Refusing database restart outside the disposable localhost test DB");
}
const image = execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", containerId], {
  encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"]
}).trim();
if (image !== "postgres:17") {
  throw new Error("Refusing to restart any service except the isolated PostgreSQL 17 image");
}
let seenIdleErrors = 0;
const db = new PostgresDatabase(connectionString, () => { seenIdleErrors++; });
try {
  const initial = await db.query("SELECT 1");
  if (initial.rowCount !== 1) throw new Error("Initial disposable database query failed");
  execFileSync("docker", ["restart", containerId], { timeout: 90_000, stdio: "ignore" });
  let recovered = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const next = await db.query("SELECT 1");
      if (next.rowCount === 1) { recovered = true; break; }
    } catch {
      // Expected until PostgreSQL is ready after its explicit test-only restart.
    }
    await delay(500);
  }
  if (!recovered) throw new Error("PostgreSQL pool did not reconnect after restart");
  if (seenIdleErrors === 0) {
    // Pool may retire the old connection between queries, so this is diagnostic,
    // not a necessary correctness requirement for restored connectivity.
    process.stdout.write("No idle-client error observed; connection restored.\n");
  }
  process.stdout.write("Disposable PostgreSQL restart/reconnect verified.\n");
} finally {
  await db.close();
}
