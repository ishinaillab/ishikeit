import Fastify from "fastify";
import pino from "pino";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { InboundStore } from "../src/persistence/inbound.js";

function makeServer(store:InboundStore) {
  return buildServer({logger:pino({level:"silent"}),ready:async()=>true,inbound:store,appSecret:"secret",verifyToken:"verify-token-1234"});
}

describe("Meta webhook route",()=>{
  it("answers the GET challenge",async()=>{
    const store={ingest:vi.fn()} as unknown as InboundStore;
    const server=makeServer(store);
    const res=await server.inject({method:"GET",url:"/ishikeit/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-1234&hub.challenge=abc"});
    expect(res.statusCode).toBe(200); expect(res.body).toBe("abc"); await server.close();
  });

  it("rejects bad signatures before persistence",async()=>{
    const store={ingest:vi.fn()} as unknown as InboundStore;
    const server=makeServer(store);
    const res=await server.inject({method:"POST",url:"/ishikeit/webhooks/meta",headers:{"content-type":"application/json","x-hub-signature-256":"sha256="+"0".repeat(64)},payload:'{"object":"page","entry":[]}'});
    expect(res.statusCode).toBe(401); expect(store.ingest).not.toHaveBeenCalled(); await server.close();
  });

  it("durably accepts a signed event",async()=>{
    const ingest=vi.fn().mockResolvedValue("created");
    const store={ingest} as unknown as InboundStore;
    const server=makeServer(store);
    const raw=JSON.stringify({object:"page",entry:[{id:"page-1",messaging:[{sender:{id:"user-1"},timestamp:1790000000000,message:{mid:"m-1",text:"hello"}}]}]});
    const signature="sha256="+createHmac("sha256","secret").update(raw).digest("hex");
    const res=await server.inject({method:"POST",url:"/ishikeit/webhooks/meta",headers:{"content-type":"application/json; charset=utf-8","x-hub-signature-256":signature},payload:raw});
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({status:"accepted"}); expect(ingest).toHaveBeenCalledTimes(1); await server.close();
  });
});
