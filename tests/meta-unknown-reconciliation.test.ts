import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import {
  PostgresMetaUnknownReconciler,
  type MetaUnknownReconciler
} from "../src/persistence/meta-unknown-reconciliation.js";
import type { PostgresDatabase } from "../src/persistence/postgres.js";

const outboxId = "11111111-1111-4111-8111-111111111111";
const token = "x".repeat(32);
const reviewBody = {
  disposition: "followup_required" as const,
  evidence: "manual_thread_review" as const,
  operatorTag: "operator-7"
};

describe("Meta unknown-outcome operator review", () => {
  function serverWith(stub: MetaUnknownReconciler) {
    return buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest: vi.fn() },
      appSecret: "secret",
      verifyToken: "verify",
      opsMetricsToken: token,
      metaUnknown: stub
    });
  }

  it("fails closed without ops bearer and never exposes customer payloads", async () => {
    const list = vi.fn().mockResolvedValue({
      total: 1, unreviewed: 1, reviewed: 0,
      cases: [{
        outboxId, channel: "whatsapp", operation: "message.send",
        armedAt: null, deadLetteredAt: "2026-10-29T00:00:00.000Z",
        disposition: null, reviewedAt: null
      }]
    });
    const review = vi.fn().mockResolvedValue("recorded");
    const server = serverWith({ list, review });
    try {
      const unauthenticated = await server.inject({method: "GET", url: "/ops/meta/unknown-outcomes"});
      expect(unauthenticated.statusCode).toBe(401);
      expect(list).not.toHaveBeenCalled();
      const invalid = await server.inject({
        method: "GET", url: "/ops/meta/unknown-outcomes?limit=55",
        headers: { authorization: `Bearer ${token}` }
      });
      expect(invalid.statusCode).toBe(400);
      const ok = await server.inject({
        method: "GET", url: "/ops/meta/unknown-outcomes?limit=12",
        headers: { authorization: `Bearer ${token}` }
      });
      expect(ok.statusCode).toBe(200);
      expect(list).toHaveBeenCalledExactlyOnceWith(12);
      const body = ok.json<{ cases: Array<Record<string, unknown>> }>();
      expect(body.cases[0]).not.toHaveProperty("target");
      expect(body.cases[0]).not.toHaveProperty("payload");
      expect(ok.headers["cache-control"]).toBe("private, no-store");
    } finally { await server.close(); }
  });

  it("rejects malformed and conflicting reviews and never sends a message", async () => {
    const list = vi.fn().mockResolvedValue({ total: 0, reviewed: 0, unreviewed: 0, cases: [] });
    const review = vi.fn().mockResolvedValueOnce("recorded")
      .mockResolvedValueOnce("already_recorded")
      .mockResolvedValueOnce("conflict");
    const server = serverWith({ list, review });
    const path = `/ops/meta/unknown-outcomes/${outboxId}/review`;
    try {
      const noAuth = await server.inject({method:"POST", url:path, payload:reviewBody});
      expect(noAuth.statusCode).toBe(401);
      const invalid = await server.inject({
        method:"POST",url:path,headers:{authorization:`Bearer ${token}`},
        payload:{...reviewBody, replay:true}
      });
      expect(invalid.statusCode).toBe(400);
      expect(review).not.toHaveBeenCalled();
      for(const [expectedStatus, expectedBody] of [[200,"recorded"],[200,"already_recorded"],[409,"conflict"]] as const){
        const result = await server.inject({
          method:"POST",url:path,headers:{authorization:`Bearer ${token}`},payload:reviewBody
        });
        expect(result.statusCode).toBe(expectedStatus);
        expect(result.json<{ status: string }>().status).toBe(expectedBody);
        expect(result.headers["cache-control"]).toBe("private, no-store");
      }
      expect(review).toHaveBeenCalledTimes(3);
    } finally {await server.close();}
  });

  it("only persists reviews for terminal ambiguous Meta messages", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({rowCount:1,rows:[{outbox_id:outboxId}]})
      .mockResolvedValueOnce({rowCount:0,rows:[]})
      .mockResolvedValueOnce({rows:[{
        exists:true,disposition:"followup_required",evidence:"manual_thread_review",
        reviewer_hash:"80cf542bed2a9ad82587a04e5359b17fcc86d04f80fd958bcae20418cd3aab4f"
      }]});
    const store = new PostgresMetaUnknownReconciler({query} as unknown as PostgresDatabase);
    expect(await store.review({outboxId,...reviewBody})).toBe("recorded");
    const [sql,params] = query.mock.calls[0] as [string,unknown[]];
    expect(sql).toContain("ON CONFLICT (outbox_id) DO NOTHING");
    expect(sql).toContain("o.dead_lettered_at IS NOT NULL");
    expect(sql).toContain("o.dead_letter_reason LIKE 'provider_outcome_unknown;%'");
    expect(sql).toContain("o.payload->>'provider'='meta'");
    expect(sql).not.toContain("UPDATE outbox");
    expect(params).not.toContain("operator-7");
    expect(params).toHaveLength(4);
    expect((params[3] as string)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns bounded lists with no recipient ID or message content", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows:[{total:"2",reviewed:"1"}] })
      .mockResolvedValueOnce({ rows:[{
        outbox_id:outboxId,channel:"instagram",operation:"message.send",
        armed_at:null, dead_lettered_at:"2026-10-29T01:00:00.000Z",
        disposition:null, reviewed_at:null, recipientId:"sensitive-do-not-return"
      }] });
    const store = new PostgresMetaUnknownReconciler({query} as unknown as PostgresDatabase);
    const list=await store.list(25);
    expect(list.total).toBe(2);
    expect(list.unreviewed).toBe(1);
    expect(list.cases[0]).not.toHaveProperty("recipientId");
    expect(JSON.stringify(list)).not.toContain("sensitive-do-not-return");
    expect(String(query.mock.calls[1]?.[0])).toContain("LIMIT $1");
    expect(query.mock.calls[1]?.[1]).toEqual([25]);
    await expect(store.list(51)).rejects.toThrow();
  });
});
