import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {privateLoginHtml,privateLoginCss,privateLoginJs} from "./private-browser-ui.js";
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
function clearCookie(name:string):string {
  return name+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function registerPrivateBrowserAuthRoutes(
  server:FastifyInstance,
  deps:{origin:string;controller:BrowserAuthController;allowWorkspaceInvitations?:boolean;
    allowWorkspaceConnections?:boolean}
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
        memberInvitationsEnabled:invitationCapability(data)
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
        memberInvitationsEnabled:invitationCapability(data)});
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
          memberInvitationsEnabled:invitationCapability(data)
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
