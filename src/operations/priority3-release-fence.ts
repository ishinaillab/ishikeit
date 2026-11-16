import {createHash} from "node:crypto";
import type pg from "pg";
import type {PostgresDatabase} from "../persistence/postgres.js";

const scopeFormat=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const shaFormat=/^[0-9a-f]{40}$/u;
const secretFormat=/^[A-Za-z0-9_-]{43}$/u;

export interface ReleaseFenceCommand {
  scope:string;
  /** Fresh 256-bit base64url random secret, never logged or stored plaintext. */
  holderSecret:string;
  /** Independently verified protected production main branch SHA. */
  appMainSha:string;
  dbMainSha:string;
  ttlSeconds:number;
}
export interface ReleaseFenceOwnedCommand extends ReleaseFenceCommand {
  generation:number;
}
export type ReleaseExternalStep="schema_migration"|"app_deploy";
export interface ReleaseExternalStepCommand extends ReleaseFenceOwnedCommand {
  step:ReleaseExternalStep;
}
export interface ReleaseFenceTicket {
  scope:string;
  generation:number;
  expiresAt:string;
}
export type ReleaseFenceObservation =
  | {active:false}
  | {active:boolean;scope:string;generation:number;
     appMainSha:string;dbMainSha:string;expiresAt:string;
     pendingExternalStep:ReleaseExternalStep|null;
     pendingExternalStepAt:string|null};

interface FenceRow extends pg.QueryResultRow {
  generation:string|number;
  expires_at:Date;
}
interface InspectRow extends FenceRow {
  scope:string;
  app_main_sha:string;
  db_main_sha:string;
  active:boolean;
  pending_external_step:ReleaseExternalStep|null;
  pending_external_step_at:Date|null;
}
function validateScope(scope:string):void{
  if(typeof scope!=="string"||!scopeFormat.test(scope))
    throw Error("Release lease scope invalid");
}
function validate(input:ReleaseFenceCommand):{
  digest:Buffer;ttlSeconds:number;
}{
  validateScope(input.scope);
  if(!shaFormat.test(input.appMainSha)||!shaFormat.test(input.dbMainSha))
    throw Error("Release lease protected commit identity invalid");
  if(!Number.isSafeInteger(input.ttlSeconds) ||
     input.ttlSeconds<60||input.ttlSeconds>900)
    throw Error("Release lease requires bounded 60–900 second lifetime");
  const secret=input.holderSecret;
  if(typeof secret!=="string"||!secretFormat.test(secret))
    throw Error("Release lease proof invalid");
  const bytes=Buffer.from(secret,"base64url");
  if(bytes.length!==32||bytes.toString("base64url")!==secret)
    throw Error("Release lease proof invalid");
  return {digest:createHash("sha256").update(bytes).digest(),
    ttlSeconds:input.ttlSeconds};
}
function ticket(scope:string,row:FenceRow):ReleaseFenceTicket{
  const generation=Number(row.generation);
  if(!Number.isSafeInteger(generation)||generation<1||
    !(row.expires_at instanceof Date)||
    !Number.isFinite(row.expires_at.getTime()))
    throw Error("Release lease database row invalid");
  return {scope,generation,expiresAt:row.expires_at.toISOString()};
}

/**
 * Single-row PostgreSQL compare-and-swap lease with a monotonically
 * increasing fencing generation. A stale/expired holder cannot renew,
 * release, or authorize the next protected action even if it saved the
 * original secret. Independent concurrent acquirers race on ONE indexed
 * PostgreSQL unique key, not on GitHub issue comments or computer PID.
 *
 * This database primitive does NOT protect a GitHub push, Hostinger's
 * automatic deploy, or a direct DBA session on its own. A PROTECTED
 * release controller and real externally enforced main/deployment rules
 * must require check() with the current generation and exact main SHAs
 * before EACH side effect; production release remains blocked until then.
 *
 * An armed external operation can outlive its lease. A pending external step
 * prevents both explicit release and reassignment even AFTER lease expiry.
 * Only future owner-authorized, authoritative out-of-band reconciliation may
 * resolve the real hosted outcome; this class intentionally provides no
 * client-asserted success/abort/retry override. A queued migration or build
 * cannot be assumed to have failed because HTTP timed out.
 */
export class PostgresPriority3ReleaseFence{
  constructor(private readonly db:Pick<PostgresDatabase,"query">){}

  async acquire(input:ReleaseFenceCommand):
    Promise<ReleaseFenceTicket|undefined>{
    const {digest,ttlSeconds}=validate(input);
    const result=await this.db.query<FenceRow>(
      `INSERT INTO public.ishikeit_release_ownership
         (scope,generation,holder_digest,app_main_sha,db_main_sha,
          expires_at,updated_at)
       VALUES ($1,1,$2,$3,$4,
         clock_timestamp()+($5::integer*interval '1 second'),clock_timestamp())
       ON CONFLICT (scope) DO UPDATE
         SET generation=public.ishikeit_release_ownership.generation+1,
             holder_digest=EXCLUDED.holder_digest,
             app_main_sha=EXCLUDED.app_main_sha,
             db_main_sha=EXCLUDED.db_main_sha,
             expires_at=clock_timestamp()+($5::integer*interval '1 second'),
             updated_at=clock_timestamp()
         WHERE (public.ishikeit_release_ownership.holder_digest IS NULL
            OR public.ishikeit_release_ownership.expires_at<=clock_timestamp())
           AND public.ishikeit_release_ownership.pending_external_step IS NULL
       RETURNING generation,expires_at`,
      [input.scope,digest,input.appMainSha,input.dbMainSha,ttlSeconds]
    );
    return result.rows[0]===undefined?undefined:ticket(input.scope,result.rows[0]);
  }

  /** Admission check for a NEW hosted side effect. A live lease alone is
   * insufficient while a previous hosted mutation remains unresolved. */
  async check(input:ReleaseFenceOwnedCommand):Promise<boolean>{
    const {digest}=validate(input);
    if(!Number.isSafeInteger(input.generation)||input.generation<1)
      throw Error("Release lease generation invalid");
    const found=await this.db.query<pg.QueryResultRow>(
      `SELECT 1 FROM public.ishikeit_release_ownership
        WHERE scope=$1 AND generation=$2
          AND holder_digest=$3 AND app_main_sha=$4 AND db_main_sha=$5
          AND expires_at>clock_timestamp()
          AND pending_external_step IS NULL`,
      [input.scope,input.generation,digest,input.appMainSha,input.dbMainSha]
    );
    return found.rowCount===1;
  }

  async renew(input:ReleaseFenceOwnedCommand):
    Promise<ReleaseFenceTicket|undefined>{
    const {digest,ttlSeconds}=validate(input);
    if(!Number.isSafeInteger(input.generation)||input.generation<1)
      throw Error("Release lease generation invalid");
    const result=await this.db.query<FenceRow>(
      `UPDATE public.ishikeit_release_ownership
         SET expires_at=clock_timestamp()+($6::integer*interval '1 second'),
             updated_at=clock_timestamp()
       WHERE scope=$1 AND generation=$2 AND holder_digest=$3
         AND app_main_sha=$4 AND db_main_sha=$5
         AND expires_at>clock_timestamp()
       RETURNING generation,expires_at`,
      [input.scope,input.generation,digest,input.appMainSha,input.dbMainSha,
        ttlSeconds]
    );
    return result.rows[0]===undefined?undefined:ticket(input.scope,result.rows[0]);
  }

  /**
   * Persist the intent BEFORE invoking an external hosted mutation.
   * A started step remains uncertain across process crashes, lease expiry,
   * and retries: no new holder may take over until an independent,
   * owner-approved provider readback resolves the actual outcome.
   * This is a DORMANT admission primitive, not a deploy executor.
   */
  async beginExternalStep(input:ReleaseExternalStepCommand):Promise<boolean>{
    const {digest}=validate(input);
    if(!Number.isSafeInteger(input.generation)||input.generation<1)
      throw Error("Release lease generation invalid");
    if(input.step!=="schema_migration"&&input.step!=="app_deploy")
      throw Error("Unsupported external release step");
    const result=await this.db.query<pg.QueryResultRow>(
      `UPDATE public.ishikeit_release_ownership
          SET pending_external_step=$6,
              pending_external_step_at=clock_timestamp(),
              updated_at=clock_timestamp()
        WHERE scope=$1 AND generation=$2 AND holder_digest=$3
          AND app_main_sha=$4 AND db_main_sha=$5
          AND expires_at>clock_timestamp()
          AND pending_external_step IS NULL
        RETURNING generation`,
      [input.scope,input.generation,digest,input.appMainSha,input.dbMainSha,
        input.step]
    );
    return result.rowCount===1;
  }

  async release(input:ReleaseFenceOwnedCommand):Promise<boolean>{
    const {digest}=validate(input);
    if(!Number.isSafeInteger(input.generation)||input.generation<1)
      throw Error("Release lease generation invalid");
    const done=await this.db.query<pg.QueryResultRow>(
      `UPDATE public.ishikeit_release_ownership
         SET holder_digest=NULL, generation=generation+1,
             expires_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE scope=$1 AND generation=$2 AND holder_digest=$3
         AND app_main_sha=$4 AND db_main_sha=$5
         AND expires_at>clock_timestamp()
         AND pending_external_step IS NULL
       RETURNING generation`,
      [input.scope,input.generation,digest,input.appMainSha,input.dbMainSha]
    );
    return done.rowCount===1;
  }

  async inspect(scope:string):Promise<ReleaseFenceObservation>{
    validateScope(scope);
    const result=await this.db.query<InspectRow>(
      `SELECT scope,generation,app_main_sha,db_main_sha,expires_at,
              pending_external_step,pending_external_step_at,
              (holder_digest IS NOT NULL AND expires_at>clock_timestamp()) AS active
         FROM public.ishikeit_release_ownership WHERE scope=$1`,[scope]
    );
    const row=result.rows[0];
    if(row===undefined)return {active:false};
    const identity=ticket(scope,row);
    return {
      scope,active:row.active,generation:identity.generation,
      appMainSha:row.app_main_sha,dbMainSha:row.db_main_sha,
      expiresAt:identity.expiresAt,
      pendingExternalStep:row.pending_external_step,
      pendingExternalStepAt:row.pending_external_step_at?.toISOString()??null
    };
  }
}
