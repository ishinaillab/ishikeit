import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrivateBrowserAuthService } from "../auth/private-browser-auth.js";

export interface BrowserAuthController {
  begin(email:string,networkId:string):Promise<string>;
  verify(cookie:string,code:string,networkId:string):
    Promise<{cookieValue:string;csrfToken:string}>;
  get(cookie:string):ReturnType<PrivateBrowserAuthService["get"]>;
  listWorkspaces(cookie:string,after?:string):
    ReturnType<PrivateBrowserAuthService["listWorkspaces"]>;
  refresh(cookie:string):ReturnType<PrivateBrowserAuthService["refresh"]>;
  csrf(cookie:string):Promise<string>;
  logout(cookie:string):Promise<void>;
  assertCsrf(cookie:string,submitted:string|undefined):void;
}

/** No client Authorization headers, no Supabase tokens returned to JavaScript,
 * no open redirects/CORS, no request-controlled roles, hosts or callback URLs.
 */
const sessionName="__Host-ishikeit-session";
const pendingName="__Host-ishikeit-login";
const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const requestSchema=z.object({email:z.email().max(320)}).strict();
const verifySchema=z.object({code:z.string().regex(/^[0-9]{6,8}$/u)}).strict();
const cursorSchema=z.object({after:z.string().uuid().optional()}).strict();

function parseCookie(req:FastifyRequest,name:string):string|undefined {
  const header=req.headers.cookie;
  if(header===undefined || header.length>8192)return undefined;
  let found:string|undefined;
  for(const part of header.split(";")){
    const pos=part.indexOf("=");
    if(pos<0)continue;
    if(part.slice(0,pos).trim()!==name)continue;
    if(found!==undefined)return undefined; // duplicate cookie shadowing
    const candidate=part.slice(pos+1).trim();
    if(!secret.safeParse(candidate).success)return undefined;
    found=candidate;
  }
  return found;
}
function privateResponse(reply:FastifyReply):FastifyReply {
  return reply.header("cache-control","no-store, private")
    .header("pragma","no-cache")
    .header("content-security-policy","default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    .header("x-content-type-options","nosniff")
    .header("x-frame-options","DENY")
    .header("referrer-policy","no-referrer")
    .header("vary","Cookie, Origin");
}
function cookie(name:string,value:string,age:number):string {
  return name+"="+value+"; Path=/; Max-Age="+age+"; HttpOnly; Secure; SameSite=Strict";
}
function clearCookie(name:string):string {
  return name+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function registerPrivateBrowserAuthRoutes(
  server:FastifyInstance,
  deps:{origin:string;controller:BrowserAuthController}
):void {
  const url=new URL(deps.origin);
  if(url.protocol!=="https:" || url.pathname!=="/" || url.search || url.hash
    || url.username || url.password || url.port
    || !/^[a-z0-9.-]+$/u.test(url.hostname))throw new Error("Invalid browser authentication origin");
  const expected=url.origin;
  const host=url.host;

  function sameOrigin(req:FastifyRequest,mutation:boolean):boolean {
    // Don't trust x-forwarded-host or x-forwarded-proto without verified proxy.
    if(req.headers.host!==host)return false;
    const fetchSite=req.headers["sec-fetch-site"];
    if(typeof fetchSite==="string" && fetchSite!=="same-origin"
      && fetchSite!=="none")return false;
    if(mutation){
      if(req.headers.origin!==expected)return false;
      if(req.headers["content-type"]?.split(";")[0]?.trim()!=="application/json")return false;
    }
    return true;
  }
  function deny(reply:FastifyReply,code=401):FastifyReply {
    return privateResponse(reply).code(code);
  }
  function session(req:FastifyRequest,reply:FastifyReply):string|undefined {
    const value=parseCookie(req,sessionName);
    if(value===undefined)void deny(reply);
    return value;
  }
  function mutation(req:FastifyRequest,reply:FastifyReply):boolean {
    if(sameOrigin(req,true))return true;
    void deny(reply,403).send({status:"forbidden"});
    return false;
  }
  function csrf(req:FastifyRequest,reply:FastifyReply,value:string):boolean {
    try{
      const header=req.headers["x-ishikeit-csrf"];
      deps.controller.assertCsrf(value,typeof header==="string"?header:undefined);
      return true;
    }catch{
      void deny(reply,403).send({status:"forbidden"});
      return false;
    }
  }

  server.post("/app/auth/request-otp",{bodyLimit:2048},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const parsed=requestSchema.safeParse(req.body);
    if(!parsed.success)return deny(reply,400).send({status:"invalid_request"});
    try{
      const pending=await deps.controller.begin(parsed.data.email,req.ip);
      return reply.header("set-cookie",cookie(pendingName,pending,600))
        .code(202).send({status:"if_invited_code_sent"});
    }catch{
      return reply.code(503).send({status:"temporarily_unavailable"});
    }
  });
  server.post("/app/auth/verify-otp",{bodyLimit:2048},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const pending=parseCookie(req,pendingName);
    const parsed=verifySchema.safeParse(req.body);
    if(pending===undefined || !parsed.success)
      return deny(reply,400).send({status:"invalid_request"});
    try{
      const result=await deps.controller.verify(pending,parsed.data.code,req.ip);
      return reply.header("set-cookie",[
        cookie(sessionName,result.cookieValue,43200),clearCookie(pendingName)
      ]).code(200).send({status:"authenticated"});
    }catch{
      return deny(reply).send({status:"authentication_failed"});
    }
  });
  server.get("/app/auth/csrf",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    try {
      return reply.code(200).send({csrfToken:await deps.controller.csrf(value)});
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  server.get("/app/auth/session",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    try {
      const data=await deps.controller.get(value);
      return reply.code(200).send({
        status:"authenticated",expiresAt:data.expiresAt,
        csrfToken:data.csrfToken,workspaces:data.workspaces
      });
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  server.get<{Querystring:{after?:string}}>("/app/auth/workspaces",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    const parsed=cursorSchema.safeParse(req.query);
    if(!parsed.success)return deny(reply,400).send({status:"invalid_request"});
    try {
      return reply.code(200).send(await deps.controller.listWorkspaces(value,parsed.data.after));
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  server.post("/app/auth/refresh",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    try {
      const data=await deps.controller.refresh(value);
      return reply.code(200).send({status:"authenticated",expiresAt:data.expiresAt,
        csrfToken:data.csrfToken,workspaces:data.workspaces});
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  server.post("/app/auth/logout",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    try {
      await deps.controller.logout(value);
      return reply.header("set-cookie",clearCookie(sessionName))
        .code(200).send({status:"signed_out"});
    }catch{return reply.code(503).send({status:"temporarily_unavailable"});}
  });
}
