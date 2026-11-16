import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

/**
 * READ-ONLY preflight for the externally enforced Priority 3 release boundary.
 * This never acquires a lease, approves a deployment, merges a PR, pushes
 * a database migration, sends a message or modifies Hostinger settings.
 *
 * GitHub rulesets and protected environments are separate controls. A
 * successful readback does NOT prove bypass-actor absence (GitHub may omit
 * bypass_actors without ruleset-admin privileges), Hostinger auto-deploy
 * disabled, or a fenced Supabase/Hostinger release controller. Those remain
 * separate fail-closed acceptance gates before any production write.
 */
const APP="ishinaillab/ishikeit";
const DB="ishinaillab/ishikeit-db";
const OWNER="ishinaillab";
const APP_ENV="ishikeit-priority3-production";
const DB_ENV="ishikeit-priority3-migrations";
const EXPECTED_CI={
  [APP]:["node","outbox-postgres-integration","php-lint","context-continuity"],
  [DB]:["migration-ci"]
};
const SHA=/^[0-9a-f]{40}$/u;

async function boundedJson(url,fetchImpl,githubToken){
  const allow=url==="https://api.github.com/repos/"+APP ||
    url==="https://api.github.com/repos/"+DB ||
    url.startsWith("https://api.github.com/repos/"+APP+"/") ||
    url.startsWith("https://api.github.com/repos/"+DB+"/");
  if(!allow)throw Error("Unrecognized GitHub readback target");
  let response;
  const headers={"accept":"application/vnd.github+json",
    "x-github-api-version":"2022-11-28",
    "user-agent":"ishikeit-priority3-external-release-readback"};
  if(githubToken!==undefined){
    if(typeof githubToken!=="string"||githubToken.length<10||githubToken.length>2048)
      throw Error("GitHub readback credential is invalid");
    headers.authorization="Bearer "+githubToken;
  }
  const resource=url.includes("/ishikeit-db")?"db":"app";
  let endpoint="metadata";
  if(url.includes("/rules/branches/"))endpoint="branch-rules";
  else if(url.includes("/deployment-branch-policies"))endpoint="deployment-branches";
  else if(url.includes("/environments/"))endpoint="environment";
  else if(url.includes("/commits/"))endpoint="main-head";
  try{
    response=await fetchImpl(url,{
      method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
      headers
    });
  }catch{throw Error("GitHub release verification unavailable (network: "+resource+" "+endpoint+")");}
  if(!response.ok){
    // Metadata only: never echo a response body, URL query, or bearer credential.
    const remaining=response.headers.get("x-ratelimit-remaining");
    const budget=remaining!==null && /^\d{1,6}$/u.test(remaining)?
      " remaining="+remaining:"";
    throw Error("GitHub release verification unavailable ("+resource+" "+endpoint+
      " HTTP "+response.status+budget+")");
  }
  if(Number(response.headers.get("content-length")??0)>131072)
    throw Error("GitHub release verification unavailable (oversized: "+resource+" "+endpoint+")");
  let body;
  try{body=await response.text();}catch{throw Error("GitHub release verification unavailable");}
  if(body.length>131072)throw Error("GitHub release verification unavailable");
  try{return JSON.parse(body);}catch{throw Error("GitHub release verification malformed");}
}
function checkRules(repo,rules){
  if(!Array.isArray(rules)||rules.length===0)
    throw Error("Mandatory GitHub main rules unavailable");
  const pr=rules.find(x=>x?.type==="pull_request");
  if(!pr||!Number.isSafeInteger(pr.parameters?.required_approving_review_count) ||
     pr.parameters.required_approving_review_count!==0 ||
     pr.parameters.dismiss_stale_reviews_on_push!==true ||
     pr.parameters.required_review_thread_resolution!==true)
    throw Error("GitHub main requires protected solo-owner pull requests and resolved threads");
  if(!rules.some(x=>x?.type==="non_fast_forward") ||
     !rules.some(x=>x?.type==="deletion") ||
     !rules.some(x=>x?.type==="required_linear_history"))
    throw Error("GitHub main lacks immutable-history guardrails");
  const statuses=rules.find(x=>x?.type==="required_status_checks")?.parameters;
  if(!statuses||statuses.strict_required_status_checks_policy!==true||
    !Array.isArray(statuses.required_status_checks))
    throw Error("GitHub main strict CI rules missing");
  for(const job of EXPECTED_CI[repo]){
    if(!statuses.required_status_checks.some(x=>x?.context===job &&
       Number.isSafeInteger(x.integration_id)&&x.integration_id>0))
      throw Error("GitHub main mandatory CI context missing");
  }
}
function checkEnvironment(name,environment,branchPolicies){
  if(!environment||typeof environment!=="object"||
     Array.isArray(environment)||environment.name!==name)
    throw Error("Protected release environment absent");
  if(environment.can_admins_bypass!==false)
    throw Error("Environment release protection permits administrator bypass");
  const rules=environment.protection_rules;
  const required=Array.isArray(rules)?
    rules.find(x=>x?.type==="required_reviewers"):undefined;
  if(!required||required.prevent_self_review!==false||
     !Array.isArray(required.reviewers)||
     !required.reviewers.some(x=>x?.type==="User" &&
       x.reviewer?.login===OWNER))
    throw Error("Owner release approval requirement missing");
  const b=environment.deployment_branch_policy;
  if(!b||typeof b!=="object")
    throw Error("Protected release environment branch policy absent");
  if(b.protected_branches!==false || b.custom_branch_policies!==true ||
     !branchPolicies || branchPolicies.total_count!==1 ||
     !Array.isArray(branchPolicies.branch_policies) ||
     branchPolicies.branch_policies.length!==1 ||
     branchPolicies.branch_policies[0]?.name!=="main" ||
     branchPolicies.branch_policies[0]?.type!=="branch")
    throw Error("Protected release environment must target main only");
}
export async function verifyPriority3GithubBoundary({
  expectedAppMainSha,expectedDbMainSha,fetchImpl=fetch,githubToken
}){
  if(!SHA.test(expectedAppMainSha)||!SHA.test(expectedDbMainSha))
    throw Error("Exact protected main commit SHAs required");
  const refs=[[APP,APP_ENV,expectedAppMainSha],[DB,DB_ENV,expectedDbMainSha]];
  for(const [repo,environment,expectedSha] of refs){
    const base="https://api.github.com/repos/"+repo;
    const repository=await boundedJson(base,fetchImpl,githubToken);
    if(repository?.full_name!==repo || repository.private!==false ||
       repository.archived!==false || repository.default_branch!=="main")
      throw Error("Release requires an unarchived public repository with main as default");
    const rules=await boundedJson(base+"/rules/branches/main",fetchImpl,githubToken);
    checkRules(repo,rules);
    const env=await boundedJson(base+"/environments/"+environment,fetchImpl,githubToken);
    let branchPolicies;
    if(env.deployment_branch_policy?.custom_branch_policies===true){
      branchPolicies=await boundedJson(base+"/environments/"+environment+
        "/deployment-branch-policies?per_page=100",fetchImpl,githubToken);
    }
    checkEnvironment(environment,env,branchPolicies);
    const head=await boundedJson(base+"/commits/main",fetchImpl,githubToken);
    if(head?.sha!==expectedSha)
      throw Error("Protected GitHub main revision changed during release preflight");
    // Recheck the rule readback after the source revision lookup: neither
    // a branch head nor a ruleset permission is an immutable deployment lease.
    checkRules(repo,await boundedJson(base+"/rules/branches/main",fetchImpl,githubToken));
  }
  return {verified:true,appMainSha:expectedAppMainSha,
    dbMainSha:expectedDbMainSha,limitation:
    "Read-only GitHub rules/environment/HEAD gate only; NOT a release permit"};
}

if(process.argv[1]!==undefined &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const githubToken=process.env.ISHIKEIT_GITHUB_READBACK_TOKEN;
    if(process.env.GITHUB_ACTIONS==="true" && !githubToken)
      throw Error("GitHub Actions release readback token required");
    await verifyPriority3GithubBoundary({
      expectedAppMainSha:process.env.ISHIKEIT_RELEASE_APP_SHA,
      expectedDbMainSha:process.env.ISHIKEIT_RELEASE_DB_SHA,
      githubToken
    });
    process.stdout.write(
      "GitHub main PR/CI/environment/HEAD preflight passed (READ ONLY). "+
      "Hostinger, provider and PostgreSQL lease authorization still required.\n"
    );
  }catch(error){
    // Only fixed source-free diagnostics; never leak private API bodies.
    const code=error instanceof Error?error.message:"unknown verification failure";
    process.stderr.write("Priority 3 GitHub release PRE-FLIGHT BLOCKED: "+code+"\n");
    process.exitCode=1;
  }
}
