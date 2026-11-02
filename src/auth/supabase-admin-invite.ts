import { z } from "zod";

/** Supabase Auth Admin /invite, executed ONLY from a trusted server.
 * This adapter is intentionally separate from public/publishable Auth.
 * Secret API keys must never be logged, embedded in frontend JS, or exposed
 * through Fastify.
 */
const uuid=z.string().uuid();
const email=z.email().max(320).transform(x=>x.trim().toLowerCase());
const response=z.object({id:uuid,email:z.email().max(320)}).passthrough();
export interface SupabaseAdminInviteResult { userId:string; email:string }
export class SupabaseAdminInviteClient {
  readonly #origin:string;
  readonly #secret:string;
  readonly #fetch:typeof fetch;
  constructor(options:{
    projectUrl:string;
    secretKey:string;
    fetchImpl?:typeof fetch;
  }){
    const u=new URL(options.projectUrl);
    if(u.protocol!=="https:" || !/^[a-z0-9]{20}\.supabase\.co$/u.test(u.hostname)
      || u.pathname!=="/" || u.search!=="" || u.hash!=="" || u.port!==""
      || u.username!=="" || u.password!=="")throw new Error("Invalid Auth Admin project origin");
    if(!/^sb_secret_[A-Za-z0-9_-]{8,200}$/u.test(options.secretKey))
      throw new Error("Require modern private Supabase project secret key");
    this.#origin=u.origin;
    this.#secret=options.secretKey;
    this.#fetch=options.fetchImpl??fetch;
  }
  async inviteUserByEmail(rawEmail:string):Promise<SupabaseAdminInviteResult>{
    const target=email.parse(rawEmail);
    let r:Response;
    try{
      r=await this.#fetch(this.#origin+"/auth/v1/invite",{
        method:"POST",redirect:"error",cache:"no-store",
        headers:{
          apikey:this.#secret,
          authorization:"Bearer "+this.#secret,
          accept:"application/json",
          "content-type":"application/json"
        },
        body:JSON.stringify({email:target}),
        signal:AbortSignal.timeout(7000)
      });
    }catch{throw new Error("Auth Admin invitation transport unavailable");}
    if(!r.ok)throw new Error("Auth Admin invitation rejected");
    const length=r.headers.get("content-length");
    if(length!==null && (!/^\d+$/u.test(length)||Number(length)>16384))
      throw new Error("Auth Admin response rejected");
    const reader=r.body?.getReader();
    if(!reader)throw new Error("Auth Admin response rejected");
    const chunks:Uint8Array[]=[];
    let total=0;
    try{
      for(;;){
        const next=await reader.read();
        if(next.done)break;
        if(next.value===undefined)continue;
        total+=next.value.byteLength;
        if(total>16384){
          await reader.cancel().catch(()=>undefined);
          throw new Error("Auth Admin response rejected");
        }
        chunks.push(next.value);
      }
    }finally{reader.releaseLock();}
    let user:z.infer<typeof response>;
    try{user=response.parse(JSON.parse(Buffer.concat(chunks,total).toString("utf8")) as unknown);}
    catch{throw new Error("Auth Admin response rejected");}
    if(email.parse(user.email)!==target)throw new Error("Auth Admin identity mismatch");
    return {userId:user.id,email:target};
  }
}
