import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REPOSITORY="ishinaillab/ishikeit";
const ENVIRONMENT="ishikeit-provisioning";
const BRANCH="main";

/**
 * Read-only GitHub REST verification. This protects the first production
 * super-admin invite from automatically created/unreviewed Actions
 * environments. A name alone is NOT an access-control boundary.
 *
 * Uses the job's short-lived GitHub token, Actions:read, Contents:read.
 * Never reads or prints environment secrets or repository variables.
 */
export async function verifyProtectedProvisioningEnvironment({
  repository,ref,jobToken,fetchImpl=fetch
}){
  if(repository!==REPOSITORY||ref!=="refs/heads/"+BRANCH)
    throw new Error("Protected provisioning requires exact main repository");
  if(typeof jobToken!=="string"||jobToken.length<25||jobToken.length>2048)
    throw new Error("GitHub read-only Actions job credential unavailable");
  const base="https://api.github.com/repos/"+REPOSITORY;
  async function get(url){
    if(!url.startsWith(base+"/"))
      throw new Error("GitHub environment verification origin mismatch");
    let response;
    try{
      response=await fetchImpl(url,{
        method:"GET",redirect:"error",cache:"no-store",
        signal:AbortSignal.timeout(8000),
        headers:{
          authorization:"Bearer "+jobToken,
          accept:"application/vnd.github+json",
          "x-github-api-version":"2022-11-28",
          "user-agent":"ishikeit-provisioning-preflight"
        }
      });
    }catch{throw new Error("GitHub environment readback unavailable");}
    if(!response.ok)throw new Error("GitHub environment readback unavailable");
    if(Number(response.headers.get("content-length")??0)>65536)
      throw new Error("GitHub environment readback unavailable");
    const reader=response.body?.getReader();
    if(!reader)throw new Error("GitHub environment readback unavailable");
    const parts=[];let length=0;
    try{
      for(;;){
        const chunk=await reader.read();
        if(chunk.done)break;
        if(!chunk.value)continue;
        length+=chunk.value.byteLength;
        if(length>65536){
          await reader.cancel().catch(()=>undefined);
          throw new Error("GitHub environment readback unavailable");
        }
        parts.push(chunk.value);
      }
    }finally{reader.releaseLock();}
    try{
      const parsed=JSON.parse(Buffer.concat(parts,length).toString("utf8"));
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
        throw new Error("Invalid GitHub environment response");
      return parsed;
    }catch{throw new Error("GitHub environment readback unavailable");}
  }
  const env=await get(base+"/environments/"+ENVIRONMENT);
  if(env.name!==ENVIRONMENT)throw new Error("GitHub deployment environment mismatch");
  const reviewers=Array.isArray(env.protection_rules)
    ?env.protection_rules.find(x=>x?.type==="required_reviewers"):null;
  if(!reviewers||!Array.isArray(reviewers.reviewers)||
      !reviewers.reviewers.some(x=>x?.type==="User"||x?.type==="Team"))
    throw new Error("Human approval protection missing for super-admin provisioning");

  const policy=env.deployment_branch_policy;
  if(!policy||typeof policy!=="object")
    throw new Error("GitHub environment main branch restriction missing");
  if(policy.custom_branch_policies===true && policy.protected_branches===false){
    const branches=await get(
      base+"/environments/"+ENVIRONMENT+"/deployment-branch-policies?per_page=100"
    );
    // Explicit main only. A permissive '*' pattern must not enable this
    // privileged workflow on pull requests or arbitrary branches.
    if(!Array.isArray(branches.branch_policies)||
      !branches.branch_policies.some(x=>x?.name===BRANCH)||
      branches.total_count>branches.branch_policies.length)
      throw new Error("GitHub environment main-only deployment policy missing");
  }else if(policy.protected_branches===true && policy.custom_branch_policies===false){
    const branch=await get(base+"/branches/"+BRANCH);
    if(branch.name!==BRANCH||branch.protected!==true)
      throw new Error("GitHub main branch is not protected");
  }else{
    throw new Error("GitHub environment deployment branch protection ambiguous");
  }
  return {ready:true,protectedEnvironment:ENVIRONMENT,branch:BRANCH};
}

if(process.argv[1]!==undefined &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    await verifyProtectedProvisioningEnvironment({
      repository:process.env.GITHUB_REPOSITORY,
      ref:process.env.GITHUB_REF,
      jobToken:process.env.ISHIKEIT_PROVISIONING_GITHUB_READ_TOKEN
    });
    process.stdout.write("Protected GitHub deployment environment verified.\n");
  }catch{
    process.stderr.write(
      "Initial administrator invitation blocked: protected environment not verified.\n"
    );
    process.exitCode=1;
  }
}
