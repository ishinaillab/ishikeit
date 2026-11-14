import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {privateLoginHtml,privateLoginCss,privateLoginJs} from "./private-browser-ui.js";
import {instagramConnectionReturnHtml,instagramConnectionReturnJs} from "./private-workspace-connect.js";
import {telegramOIDCReturnHtml,telegramOIDCReturnJs} from "./private-telegram-connect.js";
import {whatsappEmbeddedV4Html,whatsappEmbeddedV4Js} from "./private-whatsapp-embedded-v4.js";
import {messengerPageReturnHtml,messengerPageReturnJs} from "./private-messenger-connect.js";
import {tiktokAccountReturnHtml,tiktokAccountReturnJs} from "./private-tiktok-connect.js";
import {
  BrowserLoginSessionSetupError, BrowserMfaEnrollmentRateLimited,
  BrowserMfaPendingEnrollment, BrowserMfaLastAuthenticatorError,
  BrowserMfaPartialDeletionError,
  type PrivateBrowserAuthService
} from "../auth/private-browser-auth.js";

export interface BrowserAuthController {
  begin(email:string,networkId:string):Promise<string>;
  hasPendingEmailOtp(cookie:string):Promise<boolean>;
  resumeEmailOtp(email:string,networkId:string):Promise<string>;
  verify(cookie:string,code:string,networkId:string):
    Promise<{cookieValue:string;csrfToken:string}>;
  get(cookie:string):ReturnType<PrivateBrowserAuthService["get"]>;
  sessionStatus(cookie:string):ReturnType<PrivateBrowserAuthService["sessionStatus"]>;
  clearIncompleteTotp(cookie:string):ReturnType<PrivateBrowserAuthService["clearIncompleteTotp"]>;
  listWorkspaces(cookie:string,after?:string):
    ReturnType<PrivateBrowserAuthService["listWorkspaces"]>;
  listWorkspaceConnections?:(
    cookie:string,workspaceId:string,after?:string
  )=>ReturnType<PrivateBrowserAuthService["listWorkspaceConnections"]>;
  beginInstagramConnection?:PrivateBrowserAuthService["beginInstagramConnection"];
  beginWhatsAppEmbeddedV4?:PrivateBrowserAuthService["beginWhatsAppEmbeddedV4"];
  completeWhatsAppEmbeddedV4?:PrivateBrowserAuthService["completeWhatsAppEmbeddedV4"];
  confirmWhatsAppEmbeddedV4?:PrivateBrowserAuthService["confirmWhatsAppEmbeddedV4"];
  beginMessengerConnection?:PrivateBrowserAuthService["beginMessengerConnection"];
  completeMessengerConnection?:PrivateBrowserAuthService["completeMessengerConnection"];
  confirmMessengerConnection?:PrivateBrowserAuthService["confirmMessengerConnection"];
  completeInstagramConnection?:PrivateBrowserAuthService["completeInstagramConnection"];
  confirmInstagramConnection?:PrivateBrowserAuthService["confirmInstagramConnection"];
  beginTelegramConnection?:PrivateBrowserAuthService["beginTelegramConnection"];
  completeTelegramConnection?:PrivateBrowserAuthService["completeTelegramConnection"];
  confirmTelegramBusiness?:PrivateBrowserAuthService["confirmTelegramBusiness"];
  beginTikTokConnection?:PrivateBrowserAuthService["beginTikTokConnection"];
  completeTikTokConnection?:PrivateBrowserAuthService["completeTikTokConnection"];
  confirmTikTokConnection?:PrivateBrowserAuthService["confirmTikTokConnection"];
  refresh(cookie:string):ReturnType<PrivateBrowserAuthService["refresh"]>;
  csrf(cookie:string):Promise<string>;
  listTotpFactors(cookie:string):ReturnType<PrivateBrowserAuthService["listTotpFactors"]>;
  changeMfaSettings(cookie:string,mutation:
    Parameters<PrivateBrowserAuthService["changeMfaSettings"]>[1]):
    ReturnType<PrivateBrowserAuthService["changeMfaSettings"]>;
  enrollTotp(cookie:string,name:string):ReturnType<PrivateBrowserAuthService["enrollTotp"]>;
  verifyTotp(cookie:string,factorId:string,code:string):ReturnType<PrivateBrowserAuthService["verifyTotp"]>;
  inviteWorkspaceMember(cookie:string,input:{workspaceId:string;email:string;role:"admin"|"agent"|"viewer"}):
    ReturnType<PrivateBrowserAuthService["inviteWorkspaceMember"]>;
  logout(cookie:string):Promise<void>;
  assertCsrf(cookie:string,submitted:string|undefined):void;
}

/** No client Authorization headers, no Supabase tokens returned to JavaScript,
 * no open redirects/CORS, no request-controlled roles, hosts or callback URLs.
 */
function hasControlCharacter(value:string):boolean{
  return [...value].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127);
}
const sessionName="__Host-ishikeit-session";
const pendingName="__Host-ishikeit-login";
const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const requestSchema=z.object({email:z.email().max(320)}).strict();
const verifySchema=z.object({code:z.string().regex(/^[0-9]{6,10}$/u)}).strict();
const cursorSchema=z.object({after:z.string().uuid().optional()}).strict();
const verifyTotpSchema=z.object({factorId:z.string().uuid(),code:z.string().regex(/^[0-9]{6}$/u)}).strict();
const inviteSchema=z.object({email:z.email().max(320),role:z.enum(["admin","agent","viewer"])}).strict();

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
const connectCookieName="__Host-ishikeit-ig-connect";
const connectCookieSchema=z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/iu
);
const telegramConnectCookieName="__Host-ishikeit-tg-connect";
const whatsappV4CookieName="__Host-ishikeit-wa-v4-connect";
const messengerConnectCookieName="__Host-ishikeit-fb-page-connect";
const tiktokConnectCookieName="__Host-ishikeit-tiktok-connect";
function readConnectCookie(req:FastifyRequest,name:string=connectCookieName):{
  workspaceId:string;browserNonce:string
}|undefined {
  const raw=req.headers.cookie;
  if(raw===undefined||raw.length>8192)return undefined;
  let value:string|undefined;
  for(const part of raw.split(";")){
    const pos=part.indexOf("=");
    if(pos<0||part.slice(0,pos).trim()!==name)continue;
    if(value!==undefined)return undefined;
    value=part.slice(pos+1).trim();
  }
  if(value===undefined||!connectCookieSchema.safeParse(value).success)
    return undefined;
  const split=value.indexOf(".");
  return {workspaceId:value.slice(0,split),browserNonce:value.slice(split+1)};
}
function connectCookie(value:string,age:number,name:string=connectCookieName):string {
  return name+"="+value+"; Path=/; Max-Age="+age+
    "; HttpOnly; Secure; SameSite=Lax";
}
function clearCookie(name:string):string {
  return name+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function registerPrivateBrowserAuthRoutes(
  server:FastifyInstance,
  deps:{origin:string;controller:BrowserAuthController;allowWorkspaceInvitations?:boolean;
    allowWorkspaceConnections?:boolean;allowInstagramConnect?:boolean;
    allowWhatsAppEmbeddedV4?:boolean;allowMessengerConnect?:boolean;allowTelegramOIDC?:boolean;allowTikTokHolder?:boolean}
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

  function invitationCapability(data:{memberInvitationsEnabled?:boolean}):boolean {
    // The UI must not expose an invitation feature unless its route is enabled.
    return deps.allowWorkspaceInvitations===true && data.memberInvitationsEnabled===true;
  }
  function instagramConnectCapability():boolean {
    return deps.allowInstagramConnect===true;
  }
  function telegramConnectCapability():boolean {
    return deps.allowTelegramOIDC===true;
  }
  function whatsappV4Capability():boolean {
    return deps.allowWhatsAppEmbeddedV4===true;
  }
  function messengerConnectCapability():boolean {
    return deps.allowMessengerConnect===true;
  }
  function tiktokConnectCapability():boolean {
    return deps.allowTikTokHolder===true;
  }

  function privateUi(req:FastifyRequest,reply:FastifyReply,
    type:"html"|"css"|"js"):FastifyReply {
    privateResponse(reply);
    if(req.headers.host!==host)return deny(reply,403).send({status:"forbidden"});
    if(type==="html"){
      return reply
        .header("content-security-policy",
          "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "+
          "font-src https://fonts.gstatic.com; img-src 'self' data:; "+
          "connect-src 'self'; object-src 'none'; "+
          "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        .type("text/html; charset=utf-8").send(privateLoginHtml);
    }
    if(type==="css")return reply.type("text/css; charset=utf-8").send(privateLoginCss);
    return reply.type("text/javascript; charset=utf-8").send(privateLoginJs);
  }
  server.get("/app", (req,reply)=>privateUi(req,reply,"html"));
  server.get("/app/login", (req,reply)=>privateUi(req,reply,"html"));
  // Distinct authenticated URL: merely loading this HTML is not authorization.
  // Verify the current Supabase bearer, live session and membership on EVERY
  // navigation; never serve a private screen solely because a cookie exists.
  server.get("/app/workspaces",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const value=parseCookie(req,sessionName);
    if(value!==undefined){
      try{
        await deps.controller.get(value);
        return privateUi(req,reply,"html");
      }catch{/* Redirect without exposing private workspace content. */}
    }
    return reply.code(303).header("location","/app/login").send();
  });
  server.get("/app/auth/ui.css", (req,reply)=>privateUi(req,reply,"css"));
  server.get("/app/auth/ui.js", (req,reply)=>privateUi(req,reply,"js"));

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
  // A code-email link must resume the original browser's existing OTP
  // challenge. Never return the email address or the OTP itself.
  server.get("/app/auth/pending-otp",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const pending=parseCookie(req,pendingName);
    if(pending===undefined)return deny(reply).send({status:"unavailable"});
    try{
      if(await deps.controller.hasPendingEmailOtp(pending))
        return reply.code(200).send({status:"awaiting_code"});
    }catch{/* same non-enumerating response */}
    return deny(reply).send({status:"unavailable"});
  });
  // Email fragments never reach server logs: client POSTs only a validated
  // recipient to obtain a new, *unprivileged* challenge cookie, without
  // sending another email or consuming/verifying any code on navigation.
  server.post("/app/auth/resume-otp",{bodyLimit:2048},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const parsed=requestSchema.safeParse(req.body);
    if(!parsed.success)return deny(reply,400).send({status:"invalid_request"});
    try{
      const pending=await deps.controller.resumeEmailOtp(parsed.data.email,req.ip);
      return reply.header("set-cookie",cookie(pendingName,pending,600))
        .code(202).send({status:"if_recent_code_sent"});
    }catch{return reply.code(503).send({status:"temporarily_unavailable"});}
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
    }catch(error){
      if(error instanceof BrowserLoginSessionSetupError)
        return deny(reply,503).send({status:"session_setup_unavailable"});
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
      const data=await deps.controller.sessionStatus(value);
      if(data.status==="mfa_required")
        return reply.code(200).send({status:"mfa_required",expiresAt:data.expiresAt,
          csrfToken:data.csrfToken});
      return reply.code(200).send({
        status:"authenticated",expiresAt:data.expiresAt,
        csrfToken:data.csrfToken,workspaces:data.workspaces,
        memberInvitationsEnabled:invitationCapability(data),
        instagramConnectEnabled:instagramConnectCapability(),
        telegramConnectEnabled:telegramConnectCapability(),
        whatsappEmbeddedV4Enabled:whatsappV4Capability(),
        messengerConnectEnabled:messengerConnectCapability(),
        tiktokConnectEnabled:tiktokConnectCapability()
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
  // Private, bounded, owner/admin-only status inventory. This read-only
  // route is never an account-linking or provider authorization endpoint.
  if(deps.allowWorkspaceConnections===true
    && deps.controller.listWorkspaceConnections!==undefined){
    server.get<{Params:{workspaceId:string};Querystring:{after?:string}}>(
      "/app/auth/workspaces/:workspaceId/connections",async(req,reply)=>{
        privateResponse(reply);
        if(!sameOrigin(req,false))
          return deny(reply,403).send({status:"forbidden"});
        const value=session(req,reply);
        if(value===undefined)
          return deny(reply).send({status:"unauthenticated"});
        const params=z.object({workspaceId:z.string().uuid()}).strict().safeParse(req.params);
        const cursor=cursorSchema.safeParse(req.query);
        if(!params.success||!cursor.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const page=await deps.controller.listWorkspaceConnections!(
            value,params.data.workspaceId,cursor.data.after
          );
          return reply.code(200).send(page);
        }catch{
          return deny(reply,403).send({status:"connections_unavailable"});
        }
      }
    );
  }

  // Owner/admin native Instagram OAuth connect. Disabled by default unless
  // the exact server app and registered callback are configured. Live legacy
  // webhook routing stays untouched even when these private routes are on.
  if(deps.allowInstagramConnect===true &&
    deps.controller.beginInstagramConnection!==undefined &&
    deps.controller.completeInstagramConnection!==undefined &&
    deps.controller.confirmInstagramConnection!==undefined){
    const uuidSchema=z.string().uuid();
    const callbackSchema=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      code:z.string().regex(/^[A-Za-z0-9._~%-]{8,4096}$/u)
    }).strict();
    const finishSchema=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      authorizationCode:z.string().regex(/^[A-Za-z0-9._~%-]{8,4096}$/u)
    }).strict();
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/instagram/start",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const params=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!params.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const started=await deps.controller.beginInstagramConnection!(
            value,params.data.workspaceId
          );
          const external=new URL(started.authorizationUrl);
          if(external.origin!=="https://www.instagram.com" ||
            external.pathname!=="/oauth/authorize")
            throw Error("Provider authorization URL invalid");
          return reply.header("set-cookie",connectCookie(
            params.data.workspaceId+"."+started.browserNonce,600
          )).code(200).send({
            status:"provider_authorization_required",
            authorizationUrl:started.authorizationUrl,
            expiresAt:started.expiresAt
          });
        }catch{
          return deny(reply,403).send({status:"connection_unavailable"});
        }
      }
    );
    // OAuth provider redirects are cross-site; no Strict session cookie is
    // relied on during GET. GET is read-only, no code redemption. The returned
    // first-party document immediately removes the code from browser history
    // before POSTing with the ordinary Strict BFF cookie and session CSRF.
    server.get("/app/auth/connect/instagram/callback",async(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      const callback=callbackSchema.safeParse(req.query);
      if(!callback.success)
        return deny(reply,400).send("Authorization unavailable");
      return reply.header("content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; "+
        "img-src 'self'; connect-src 'self'; frame-ancestors 'none'; "+
        "base-uri 'none'; form-action 'none'")
        .type("text/html; charset=utf-8").code(200)
        .send(instagramConnectionReturnHtml(callback.data.state,callback.data.code));
    });
    server.get("/app/auth/instagram-return.js",(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      return reply.type("text/javascript; charset=utf-8")
        .send(instagramConnectionReturnJs);
    });
    server.post("/app/auth/connect/instagram/complete",
      {bodyLimit:8192},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const binding=readConnectCookie(req);
        const parsed=finishSchema.safeParse(req.body);
        if(binding===undefined||!parsed.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.completeInstagramConnection!(value,{
            workspaceId:binding.workspaceId,browserNonce:binding.browserNonce,
            state:parsed.data.state,authorizationCode:parsed.data.authorizationCode
          });
          return reply.header("set-cookie",connectCookie("",0))
            .code(200).send(result);
        }catch{
          return deny(reply,403).header("set-cookie",connectCookie("",0))
            .send({status:"connection_rejected"});
        }
      }
    );
    server.post<{Params:{workspaceId:string;connectionId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/:connectionId/activate",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const params=z.object({workspaceId:uuidSchema,connectionId:uuidSchema})
          .strict().safeParse(req.params);
        if(!params.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.confirmInstagramConnection!(
            value,params.data.workspaceId,params.data.connectionId
          );
          return reply.code(200).send(result);
        }catch{
          return deny(reply,403).send({status:"activation_unavailable"});
        }
      }
    );
  }

  // WhatsApp Embedded Signup v4 is an owner-only JS SDK flow, NOT a
  // redirect-based OAuth callback. Every browser asset ID is an untrusted
  // candidate until server token inspection and Graph asset readback.
  if(deps.allowWhatsAppEmbeddedV4===true &&
    deps.controller.beginWhatsAppEmbeddedV4!==undefined &&
    deps.controller.completeWhatsAppEmbeddedV4!==undefined &&
    deps.controller.confirmWhatsAppEmbeddedV4!==undefined){
    const uuidSchema=z.string().uuid();
    const numeric=z.string().regex(/^[1-9][0-9]{4,31}$/u);
    const finish=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      authorizationCode:z.string().min(8).max(4096)
        .regex(/^[A-Za-z0-9._~%-]+$/u),
      messagingAccountId:numeric,phoneNumberId:numeric
    }).strict();
    server.get<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/whatsapp/signup",
      async(req,reply)=>{
        privateResponse(reply);
        if(!sameOrigin(req,false))return deny(reply,403).send("Forbidden");
        const parsed=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!parsed.success)return deny(reply,400).send("Invalid workspace");
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send("Unauthenticated");
        if(deps.controller.listWorkspaceConnections===undefined)
          return deny(reply,403).send("Workspace authorization unavailable");
        try{
          await deps.controller.get(value);
          await deps.controller.listWorkspaceConnections(
            value,parsed.data.workspaceId);
        }catch{return deny(reply,403).send("Workspace authorization unavailable");}
        return reply.header("content-security-policy",
          "default-src 'none'; script-src 'self' https://connect.facebook.net; "+
          "style-src 'self'; img-src 'self' data: https://www.facebook.com; "+
          "connect-src 'self' https://www.facebook.com https://web.facebook.com "+
          "https://graph.facebook.com; "+
          "frame-src https://www.facebook.com https://web.facebook.com; "+
          "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; "+
          "form-action 'none'")
          .type("text/html; charset=utf-8")
          .send(whatsappEmbeddedV4Html(parsed.data.workspaceId));
      }
    );
    server.get("/app/auth/whatsapp-v4.js",async(req,reply)=>{
      privateResponse(reply);
      if(!sameOrigin(req,false))return deny(reply,403).send("Forbidden");
      const value=session(req,reply);
      if(value===undefined)return deny(reply).send("Unauthenticated");
      try{await deps.controller.get(value);}
      catch{return deny(reply).send("Unauthenticated");}
      return reply.type("text/javascript; charset=utf-8")
        .send(whatsappEmbeddedV4Js);
    });
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/whatsapp/start",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const parsed=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!parsed.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const started=await deps.controller.beginWhatsAppEmbeddedV4!(
            value,parsed.data.workspaceId);
          // Nonce always stays in Secure HttpOnly browser cookie; SDK never
          // sees it. Opaque state goes only to first-party JS ephemeral RAM.
          return reply.header("set-cookie",connectCookie(
            parsed.data.workspaceId+"."+started.browserNonce,
            600,whatsappV4CookieName
          )).code(200).send({
            status:"owner_authorization_required",
            state:started.state,expiresAt:started.expiresAt,
            appId:started.appId,configId:started.configId,
            graphVersion:started.graphVersion
          });
        }catch{return deny(reply,403).send({status:"connection_unavailable"});}
      }
    );
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/whatsapp/complete",
      {bodyLimit:8192},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const parsed=finish.safeParse(req.body);
        const workspace=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        const binding=readConnectCookie(req,whatsappV4CookieName);
        if(!parsed.success||!workspace.success||!binding||
          binding.workspaceId!==workspace.data.workspaceId)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.completeWhatsAppEmbeddedV4!(value,{
            workspaceId:binding.workspaceId,browserNonce:binding.browserNonce,
            ...parsed.data
          });
          return reply.header("set-cookie",connectCookie("",0,whatsappV4CookieName))
            .code(200).send(result);
        }catch{
          return deny(reply,403)
            .header("set-cookie",connectCookie("",0,whatsappV4CookieName))
            .send({status:"connection_rejected"});
        }
      }
    );
    server.post<{Params:{workspaceId:string;connectionId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/:connectionId/whatsapp-activate",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const parsed=z.object({workspaceId:uuidSchema,connectionId:uuidSchema})
          .strict().safeParse(req.params);
        if(!parsed.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          return reply.code(200).send(
            await deps.controller.confirmWhatsAppEmbeddedV4!(
              value,parsed.data.workspaceId,parsed.data.connectionId
            ));
        }catch{return deny(reply,403).send({status:"activation_unavailable"});}
      }
    );
  }

  // Facebook Login for Business Page linking. This only registers a
  // private owner-native tenant registry candidate. It never subscribes
  // a Page to webhooks, mutates Meta settings or authorizes a send.
  if(deps.allowMessengerConnect===true &&
    deps.controller.beginMessengerConnection!==undefined &&
    deps.controller.completeMessengerConnection!==undefined &&
    deps.controller.confirmMessengerConnection!==undefined){
    const uuidSchema=z.string().uuid();
    const stateSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
    const codeSchema=z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u);
    const callback=z.object({state:stateSchema,code:codeSchema}).strict();
    const finish=z.object({
      state:stateSchema,authorizationCode:codeSchema,
      pageId:z.string().regex(/^[1-9][0-9]{4,31}$/u)
    }).strict();
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/messenger/start",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const parsed=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!parsed.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const started=await deps.controller.beginMessengerConnection!(
            value,parsed.data.workspaceId);
          const target=new URL(started.authorizationUrl);
          if(target.origin!=="https://www.facebook.com"||
            !/^\/v[0-9]{1,2}\.[0-9]{1,2}\/dialog\/oauth$/u.test(target.pathname))
            throw Error("Unrecognized Meta login authorization host");
          return reply.header("set-cookie",connectCookie(
            parsed.data.workspaceId+"."+started.browserNonce,600,
            messengerConnectCookieName
          )).code(200).send({
            status:"provider_authorization_required",
            authorizationUrl:started.authorizationUrl,expiresAt:started.expiresAt
          });
        }catch{return deny(reply,403).send({status:"connection_unavailable"});}
      }
    );
    server.get("/app/auth/connect/messenger/callback",async(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      const parsed=callback.safeParse(req.query);
      if(!parsed.success)return deny(reply,400).send("Authorization unavailable");
      return reply.header("content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; "+
        "img-src 'self'; connect-src 'self'; frame-ancestors 'none'; "+
        "base-uri 'none'; form-action 'none'")
        .type("text/html; charset=utf-8")
        .send(messengerPageReturnHtml(parsed.data.state,parsed.data.code));
    });
    server.get("/app/auth/messenger-return.js",(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      return reply.type("text/javascript; charset=utf-8")
        .send(messengerPageReturnJs);
    });
    server.post("/app/auth/connect/messenger/complete",
      {bodyLimit:8192},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const binding=readConnectCookie(req,messengerConnectCookieName);
        const parsed=finish.safeParse(req.body);
        if(binding===undefined||!parsed.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const linked=await deps.controller.completeMessengerConnection!(value,{
            workspaceId:binding.workspaceId,browserNonce:binding.browserNonce,
            state:parsed.data.state,authorizationCode:parsed.data.authorizationCode,
            pageId:parsed.data.pageId
          });
          return reply.header("set-cookie",
            connectCookie("",0,messengerConnectCookieName)).code(200).send(linked);
        }catch{
          return deny(reply,403).header("set-cookie",
            connectCookie("",0,messengerConnectCookieName))
            .send({status:"connection_rejected"});
        }
      }
    );
    server.post<{Params:{workspaceId:string;connectionId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/:connectionId/messenger-activate",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const path=z.object({workspaceId:uuidSchema,connectionId:uuidSchema})
          .strict().safeParse(req.params);
        if(!path.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.confirmMessengerConnection!(
            value,path.data.workspaceId,path.data.connectionId);
          return reply.code(200).send(result);
        }catch{return deny(reply,403).send({status:"activation_unavailable"});}
      }
    );
  }

  // Telegram's official OIDC flow is a distinct trust domain from
  // Telegram Bot API Business. Only the signed OIDC subject can become
  // workspace owner proof; a supplied Business connection ID is NOT proof.
  if(deps.allowTelegramOIDC===true &&
    deps.controller.beginTelegramConnection!==undefined &&
    deps.controller.completeTelegramConnection!==undefined &&
    deps.controller.confirmTelegramBusiness!==undefined){
    const uuidSchema=z.string().uuid();
    const callback=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      code:z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u)
    }).strict();
    const finish=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      authorizationCode:z.string().min(8).max(4096)
        .regex(/^[A-Za-z0-9._~%-]+$/u)
    }).strict();
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/telegram/start",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const path=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!path.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const started=await deps.controller.beginTelegramConnection!(
            value,path.data.workspaceId
          );
          const target=new URL(started.authorizationUrl);
          if(target.origin!=="https://oauth.telegram.org"||
            target.pathname!=="/auth")throw Error("Unrecognized Telegram OIDC host");
          return reply.header("set-cookie",connectCookie(
            path.data.workspaceId+"."+started.browserNonce,600,
            telegramConnectCookieName
          )).code(200).send({
            status:"provider_authorization_required",
            authorizationUrl:started.authorizationUrl,expiresAt:started.expiresAt
          });
        }catch{return deny(reply,403).send({status:"connection_unavailable"});}
      }
    );
    server.get("/app/auth/connect/telegram/callback",async(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      const parsed=callback.safeParse(req.query);
      if(!parsed.success)
        return deny(reply,400).send("Authorization unavailable");
      return reply.header("content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; "+
        "img-src 'self'; connect-src 'self'; frame-ancestors 'none'; "+
        "base-uri 'none'; form-action 'none'")
        .type("text/html; charset=utf-8")
        .send(telegramOIDCReturnHtml(parsed.data.state,parsed.data.code));
    });
    server.get("/app/auth/telegram-return.js",(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      return reply.type("text/javascript; charset=utf-8")
        .send(telegramOIDCReturnJs);
    });
    server.post("/app/auth/connect/telegram/complete",
      {bodyLimit:8192},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const binding=readConnectCookie(req,telegramConnectCookieName);
        const parsed=finish.safeParse(req.body);
        if(binding===undefined||!parsed.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.completeTelegramConnection!(value,{
            workspaceId:binding.workspaceId,browserNonce:binding.browserNonce,
            state:parsed.data.state,authorizationCode:parsed.data.authorizationCode
          });
          return reply.header("set-cookie",
            connectCookie("",0,telegramConnectCookieName))
            .code(200).send(result);
        }catch{
          return deny(reply,403).header("set-cookie",
            connectCookie("",0,telegramConnectCookieName))
            .send({status:"connection_rejected"});
        }
      }
    );
    server.post<{Params:{workspaceId:string;connectionId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/:connectionId/telegram-business",
      {bodyLimit:1024},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const path=z.object({
          workspaceId:uuidSchema,connectionId:uuidSchema
        }).strict().safeParse(req.params);
        const parsed=z.object({
          businessConnectionId:z.string().min(5).max(256)
            .refine(v=>!hasControlCharacter(v))
        }).strict().safeParse(req.body);
        if(!path.success||!parsed.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.confirmTelegramBusiness!(value,{
            workspaceId:path.data.workspaceId,connectionId:path.data.connectionId,
            businessConnectionId:parsed.data.businessConnectionId
          });
          return reply.code(200).send(result);
        }catch{return deny(reply,403).send({status:"activation_unavailable"});}
      }
    );
  }

  if(deps.allowTikTokHolder===true &&
    deps.controller.beginTikTokConnection!==undefined &&
    deps.controller.completeTikTokConnection!==undefined &&
    deps.controller.confirmTikTokConnection!==undefined){
    const uuidSchema=z.string().uuid();
    const callback=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      auth_code:z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u)
    }).strict();
    const finish=z.object({
      state:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      authorizationCode:z.string().min(8).max(4096)
        .regex(/^[A-Za-z0-9._~%-]+$/u)
    }).strict();
    server.post<{Params:{workspaceId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/tiktok/start",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const path=z.object({workspaceId:uuidSchema}).strict().safeParse(req.params);
        if(!path.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const started=await deps.controller.beginTikTokConnection!(
            value,path.data.workspaceId
          );
          const target=new URL(started.authorizationUrl);
          if(target.protocol!=="https:"||
            !["ads.tiktok.com","business-api.tiktok.com","www.tiktok.com"]
              .includes(target.hostname)||
            Boolean(target.username)||Boolean(target.password))throw Error("Unrecognized TikTok account-holder host");
          return reply.header("set-cookie",connectCookie(
            path.data.workspaceId+"."+started.browserNonce,600,
            tiktokConnectCookieName
          )).code(200).send({
            status:"provider_authorization_required",
            authorizationUrl:started.authorizationUrl,expiresAt:started.expiresAt
          });
        }catch{return deny(reply,403).send({status:"connection_unavailable"});}
      }
    );
    server.get("/app/auth/connect/tiktok/callback/",async(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      const parsed=callback.safeParse(req.query);
      if(!parsed.success)
        return deny(reply,400).send("Authorization unavailable");
      return reply.header("content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; "+
        "img-src 'self'; connect-src 'self'; frame-ancestors 'none'; "+
        "base-uri 'none'; form-action 'none'")
        .type("text/html; charset=utf-8")
        .send(tiktokAccountReturnHtml(parsed.data.state,parsed.data.auth_code));
    });
    server.get("/app/auth/tiktok-return.js",(req,reply)=>{
      privateResponse(reply);
      if(req.headers.host!==host)
        return deny(reply,403).send("Authorization unavailable");
      return reply.type("text/javascript; charset=utf-8")
        .send(tiktokAccountReturnJs);
    });
    server.post("/app/auth/connect/tiktok/complete",
      {bodyLimit:8192},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const binding=readConnectCookie(req,tiktokConnectCookieName);
        const parsed=finish.safeParse(req.body);
        if(binding===undefined||!parsed.success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.completeTikTokConnection!(value,{
            workspaceId:binding.workspaceId,browserNonce:binding.browserNonce,
            state:parsed.data.state,authorizationCode:parsed.data.authorizationCode
          });
          return reply.header("set-cookie",
            connectCookie("",0,tiktokConnectCookieName))
            .code(200).send(result);
        }catch{
          return deny(reply,403).header("set-cookie",
            connectCookie("",0,tiktokConnectCookieName))
            .send({status:"connection_rejected"});
        }
      }
    );
    server.post<{Params:{workspaceId:string;connectionId:string}}>(
      "/app/auth/workspaces/:workspaceId/connections/:connectionId/tiktok-activate",
      {bodyLimit:128},async(req,reply)=>{
        privateResponse(reply);
        if(!mutation(req,reply))return reply;
        const value=session(req,reply);
        if(value===undefined)return deny(reply).send({status:"unauthenticated"});
        if(!csrf(req,reply,value))return reply;
        const path=z.object({
          workspaceId:uuidSchema,connectionId:uuidSchema
        }).strict().safeParse(req.params);
        if(!path.success||!z.object({}).strict().safeParse(req.body).success)
          return deny(reply,400).send({status:"invalid_request"});
        try{
          const result=await deps.controller.confirmTikTokConnection!(
            value,path.data.workspaceId,path.data.connectionId
          );
          return reply.code(200).send(result);
        }catch{return deny(reply,403).send({status:"activation_unavailable"});}
      }
    );
  }

  server.post("/app/auth/refresh",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    try {
      const data=await deps.controller.refresh(value);
      if(data.status==="mfa_required")
        return reply.code(200).send({status:"mfa_required",expiresAt:data.expiresAt,
          csrfToken:data.csrfToken});
      return reply.code(200).send({status:"authenticated",expiresAt:data.expiresAt,
        csrfToken:data.csrfToken,workspaces:data.workspaces,
        memberInvitationsEnabled:invitationCapability(data),
        instagramConnectEnabled:instagramConnectCapability(),
        telegramConnectEnabled:telegramConnectCapability(),
        whatsappEmbeddedV4Enabled:whatsappV4Capability(),
        messengerConnectEnabled:messengerConnectCapability(),
        tiktokConnectEnabled:tiktokConnectCapability()});
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  server.get("/app/auth/mfa/factors",async(req,reply)=>{
    privateResponse(reply);
    if(!sameOrigin(req,false))return deny(reply,403).send({status:"forbidden"});
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    try{
      return reply.code(200).send({
        ...await deps.controller.listTotpFactors(value)
      });
    }catch{return deny(reply).send({status:"unauthenticated"});}
  });
  const mfaSettingsSchema=z.discriminatedUnion("kind",[
    z.object({kind:z.literal("remove"),factorId:z.string().uuid(),
      proofFactorId:z.string().uuid(),code:z.string().regex(/^[0-9]{6}$/u)}).strict(),
    z.object({kind:z.literal("disable_app"),
      proofFactorId:z.string().uuid(),code:z.string().regex(/^[0-9]{6}$/u)}).strict(),
    z.object({kind:z.literal("rename"),factorId:z.string().uuid(),
      name:z.string().trim().min(1).max(64),
      proofFactorId:z.string().uuid(),code:z.string().regex(/^[0-9]{6}$/u)}).strict()
  ]);
  // A switch is a sensitive security mutation, not a cosmetic UI setting.
  // Confirm current TOTP through the official provider, then atomically
  // rotate the current cookie and revoke all other local browser sessions.
  server.post("/app/auth/mfa/preferences",{bodyLimit:512},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    const parsed=mfaSettingsSchema.safeParse(req.body);
    if(!parsed.success)return deny(reply,400).send({status:"invalid_request"});
    try{
      const result=await deps.controller.changeMfaSettings(value,parsed.data);
      if(result.signedOut){
        return reply.header("set-cookie",[clearCookie(sessionName),clearCookie(pendingName)])
          .code(200).send({status:"authenticator_removed_signin_required",removed:result.removed});
      }
      return reply.header("set-cookie",cookie(sessionName,result.cookieValue,43200))
        .code(200).send({status:"changed",csrfToken:result.csrfToken});
    }catch(error){
      if(error instanceof BrowserMfaPartialDeletionError)
        return deny(reply,409)
          .header("set-cookie",[clearCookie(sessionName),clearCookie(pendingName)])
          .send({status:"authenticator_state_requires_signin"});
      if(error instanceof BrowserMfaLastAuthenticatorError)
        return deny(reply,409).send({status:"last_authenticator_required"});
      if(error instanceof BrowserMfaEnrollmentRateLimited)
        return deny(reply,429).header("retry-after","900")
          .send({status:"security_change_rate_limited"});
      return deny(reply,403).send({status:"security_change_rejected"});
    }
  });
  const enrollNameSchema=z.object({name:z.string().trim().min(1).max(64)}).strict();
  server.post("/app/auth/mfa/totp/enroll",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    try{
      const parsed=enrollNameSchema.safeParse(req.body);
      if(!parsed.success)return deny(reply,400).send({status:"invalid_device_name"});
      const enrollment=await deps.controller.enrollTotp(value,parsed.data.name);
      return reply.code(200).send(enrollment);
    }catch(error){
      if(error instanceof BrowserMfaPendingEnrollment)
        return deny(reply,409).send({status:"mfa_incomplete_setup"});
      if(error instanceof BrowserMfaEnrollmentRateLimited)
        return deny(reply,429).header("retry-after","900")
          .send({status:"mfa_enrollment_rate_limited"});
      return deny(reply,403).send({status:"mfa_enrollment_unavailable"});
    }
  });
  // Reset only owner-controlled incomplete factors, never verified factors.
  // Strict host/origin, session and CSRF protections match MFA enrollment.
  server.post("/app/auth/mfa/totp/reset",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    if(!z.object({}).strict().safeParse(req.body).success)
      return deny(reply,400).send({status:"invalid_request"});
    try{
      const result=await deps.controller.clearIncompleteTotp(value);
      return reply.code(200).send({status:"incomplete_setup_cleared",cleared:result.cleared});
    }catch{
      return deny(reply,403).send({status:"mfa_reset_unavailable"});
    }
  });
  server.post("/app/auth/mfa/totp/verify",{bodyLimit:512},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    const body=verifyTotpSchema.safeParse(req.body);
    if(!body.success)return deny(reply,400).send({status:"invalid_request"});
    try{
      const data=await deps.controller.verifyTotp(value,body.data.factorId,body.data.code);
      return reply.header("set-cookie",cookie(sessionName,data.cookieValue,43200))
        .code(200).send({
          status:"authenticated",expiresAt:data.expiresAt,csrfToken:data.csrfToken,
          workspaces:data.workspaces,
          memberInvitationsEnabled:invitationCapability(data),
        instagramConnectEnabled:instagramConnectCapability(),
        telegramConnectEnabled:telegramConnectCapability(),
        whatsappEmbeddedV4Enabled:whatsappV4Capability(),
        messengerConnectEnabled:messengerConnectCapability(),
        tiktokConnectEnabled:tiktokConnectCapability()
        });
    }catch{return deny(reply,403).send({status:"mfa_verification_failed"});}
  });
  if(deps.allowWorkspaceInvitations===true){
    server.post("/app/auth/workspaces/:workspaceId/invitations",{bodyLimit:2048},async(req,reply)=>{
      privateResponse(reply);
      if(!mutation(req,reply))return reply;
      const value=session(req,reply);
      if(value===undefined)return deny(reply).send({status:"unauthenticated"});
      if(!csrf(req,reply,value))return reply;
      const params=z.object({workspaceId:z.string().uuid()}).strict().safeParse(req.params);
      const parsed=inviteSchema.safeParse(req.body);
      if(!params.success || !parsed.success)
        return deny(reply,400).send({status:"invalid_request"});
      try{
        const result=await deps.controller.inviteWorkspaceMember(value,{
          workspaceId:params.data.workspaceId,
          email:parsed.data.email,role:parsed.data.role
        });
        return reply.code(202).send({
          status:result.status,invitationId:result.invitationId
        });
      }catch{
        return deny(reply,403).send({status:"invitation_not_permitted"});
      }
    });
  }
  server.post("/app/auth/logout",{bodyLimit:256},async(req,reply)=>{
    privateResponse(reply);
    if(!mutation(req,reply))return reply;
    const value=session(req,reply);
    if(value===undefined)return deny(reply).send({status:"unauthenticated"});
    if(!csrf(req,reply,value))return reply;
    try {
      await deps.controller.logout(value);
      return reply.header("set-cookie",[
        clearCookie(sessionName),clearCookie(pendingName)
      ]).code(200).send({status:"signed_out"});
    }catch{return reply.code(503).send({status:"temporarily_unavailable"});}
  });
}
