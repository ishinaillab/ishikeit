import test from "node:test";
import assert from "node:assert/strict";
import {verifyPriority3GithubBoundary} from "./verify-priority3-github-release.mjs";
const APP="ishinaillab/ishikeit",DB="ishinaillab/ishikeit-db";
const appSha="a".repeat(40),dbSha="b".repeat(40);
const environments={
  [APP]:"ishikeit-priority3-production",
  [DB]:"ishikeit-priority3-migrations"
};
const jobs={
  [APP]:["node","outbox-postgres-integration","php-lint","context-continuity"],
  [DB]:["migration-ci"]
};
function basicRules(repo){
  return [
    {type:"deletion"},{type:"non_fast_forward"},{type:"required_linear_history"},
    {type:"pull_request",parameters:{
      required_approving_review_count:0,
      dismiss_stale_reviews_on_push:true,
      required_review_thread_resolution:true
    }},
    {type:"required_status_checks",parameters:{
      strict_required_status_checks_policy:true,
      required_status_checks:jobs[repo].map(context=>({context,integration_id:15368}))
    }}
  ];
}
function makeScenario(overrides={}){
  const docs=new Map();
  for(const repo of [APP,DB]){
    const api="https://api.github.com/repos/"+repo;
    docs.set(api,{full_name:repo,private:false,archived:false,default_branch:"main"});
    docs.set(api+"/rules/branches/main",basicRules(repo));
    docs.set(api+"/environments/"+environments[repo],{
      name:environments[repo],can_admins_bypass:false,
      protection_rules:[{type:"required_reviewers",prevent_self_review:false,
        reviewers:[{type:"User",reviewer:{login:"ishinaillab"}}]}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
    });
    docs.set(api+"/environments/"+environments[repo]+
      "/deployment-branch-policies?per_page=100",{
        total_count:1,branch_policies:[{name:"main",type:"branch"}]
      });
    docs.set(api+"/commits/main",{sha:repo===APP?appSha:dbSha});
  }
  for(const [path,value] of Object.entries(overrides))docs.set(path,value);
  const seen=[];
  const fetchImpl=async(url,init)=>{
    seen.push({url,init});
    if(!docs.has(url))return new Response("not found",{status:404});
    const value=docs.get(url);
    if(value==="403")return new Response("PRIVATE ERROR BODY",{status:403});
    return new Response(JSON.stringify(value),{status:200});
  };
  return {seen,docs,run:()=>verifyPriority3GithubBoundary({
    expectedAppMainSha:appSha,expectedDbMainSha:dbSha,fetchImpl
  })};
}
const u=(repo,tail)=>"https://api.github.com/repos/"+repo+tail;
async function blocked(mutations,pattern){
  const scenario=makeScenario(mutations);
  await assert.rejects(scenario.run(),pattern);
  return scenario;
}
test("verifies both exact protected main SHAs, solo-owner PR gates, required CI and human release environments",async()=>{
  const s=makeScenario();
  const result=await s.run();
  assert.deepEqual(result,{verified:true,appMainSha:appSha,
    dbMainSha:dbSha,limitation:
      "Read-only GitHub rules/environment/HEAD gate only; NOT a release permit"});
  assert.equal(s.seen.length,12);
  assert.ok(s.seen.every(x=>x.init.method==="GET"&&x.init.redirect==="error"));
  assert.ok(s.seen.every(x=>x.url.startsWith("https://api.github.com/repos/ishinaillab/")));
});
test("refuses unworkable independent approvals, disabled safeguards and unresolved review threads",async()=>{
  for(const [key,value] of [
    ["required_approving_review_count",1],
    ["dismiss_stale_reviews_on_push",false],
    ["required_review_thread_resolution",false]
  ]){
    const base=basicRules(APP);base[3].parameters[key]=value;
    await blocked({[u(APP,"/rules/branches/main")]:base},/protected solo-owner/);
  }
});
test("enforces app and DB CI independently and requires strict current branch",async()=>{
  for(const repo of [APP,DB]){
    const base=basicRules(repo);
    base[4].parameters.required_status_checks=[];
    await blocked({[u(repo,"/rules/branches/main")]:base},/CI context/);
    const relaxed=basicRules(repo);
    relaxed[4].parameters.strict_required_status_checks_policy=false;
    await blocked({[u(repo,"/rules/branches/main")]:relaxed},/strict CI/);
    const missing=basicRules(repo).filter(x=>x.type!=="non_fast_forward");
    await blocked({[u(repo,"/rules/branches/main")]:missing},/immutable-history/);
  }
});
test("requires named human owner reviewer and main-only branch deployment environment",async()=>{
  const repo=APP,env=environments[repo],url=u(repo,"/environments/"+env);
  await blocked({[url]:{name:env,can_admins_bypass:false,protection_rules:[],
    deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}}},/Owner release approval/);
  await blocked({[url]:{name:env,can_admins_bypass:false,protection_rules:[{
    type:"required_reviewers",prevent_self_review:false,reviewers:[{type:"User",reviewer:{login:"attacker"}}]
  }],deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}}},/Owner release approval/);
  await blocked({[url]:{name:env,can_admins_bypass:false,protection_rules:[{
    type:"required_reviewers",prevent_self_review:false,reviewers:[{type:"User",reviewer:{login:"ishinaillab"}}]
  }],deployment_branch_policy:{protected_branches:false,custom_branch_policies:false}}},/main only/);
  await blocked({[u(repo,"/environments/"+env+"/deployment-branch-policies?per_page=100")]:{
    total_count:2,branch_policies:[{name:"main"},{name:"*"}]
  }},/main only/);
});
test("rejects environment administrator bypass, self-review deadlocks, tag-only and protected-branch wildcard",async()=>{
  const repo=APP,env=environments[repo],url=u(repo,"/environments/"+env);
  const s=makeScenario();
  const baseline=s.docs.get(url);
  await blocked({[url]:{...baseline,can_admins_bypass:true}},/administrator bypass/);
  await blocked({[url]:{...baseline,protection_rules:[{
    type:"required_reviewers",prevent_self_review:true,
    reviewers:[{type:"User",reviewer:{login:"ishinaillab"}}]
  }]}},/Owner release approval/);
  await blocked({[url]:{...baseline,deployment_branch_policy:{
    protected_branches:true,custom_branch_policies:false
  }}},/main only/);
  await blocked({[u(repo,"/environments/"+env+"/deployment-branch-policies?per_page=100")]:{
    total_count:1,branch_policies:[{name:"main",type:"tag"}]
  }},/main only/);
});
test("rejects private, archived, unexpected owner and non-main default repositories",async()=>{
  for(const patch of [
    {private:true},{archived:true},{default_branch:"develop"},{full_name:"stranger/private"}
  ]){
    const baseline={full_name:APP,private:false,archived:false,default_branch:"main"};
    await blocked({[u(APP,"")]:{...baseline,...patch}},/unarchived public repository/);
  }
});
test("refuses unexpected latest GitHub SHAs, 403, missing state and malformed caller revisions",async()=>{
  await blocked({[u(DB,"/commits/main")]:{sha:"c".repeat(40)}},/revision changed/);
  await blocked({[u(APP,"/environments/"+environments[APP])]:"403"},/unavailable/);
  await assert.rejects(verifyPriority3GithubBoundary({
    expectedAppMainSha:"main",expectedDbMainSha:dbSha,
    fetchImpl:async()=>{throw Error("no network should happen");}
  }),/Exact protected main/);
});
test("rechecks each repo's active main rules after reading HEAD",async()=>{
  const s=makeScenario(),called=new Map();
  const fetchImpl=async(url)=>{
    const n=(called.get(url)??0)+1;called.set(url,n);
    if(url===u(DB,"/rules/branches/main")&&n===2)
      return new Response(JSON.stringify([]),{status:200});
    const value=s.docs.get(url);
    return new Response(JSON.stringify(value),{status:200});
  };
  await assert.rejects(verifyPriority3GithubBoundary({
    expectedAppMainSha:appSha,expectedDbMainSha:dbSha,fetchImpl
  }),/Mandatory GitHub main rules/);
});

test("authenticates every allowlisted readback with bounded job token and never allows redirects",async()=>{
  const s=makeScenario();
  const token="ghs_release_readback_synthetic_not_real_secret";
  const seen=[];
  await verifyPriority3GithubBoundary({
    expectedAppMainSha:appSha,expectedDbMainSha:dbSha,githubToken:token,
    fetchImpl:async(url,init)=>{
      seen.push({url,init});
      return new Response(JSON.stringify(s.docs.get(url)),{status:200});
    }
  });
  assert.equal(seen.length,12);
  assert.ok(seen.every(x=>x.init.headers.authorization==="Bearer "+token));
  assert.ok(seen.every(x=>x.init.redirect==="error"&&x.init.method==="GET"));
  assert.ok(seen.every(x=>x.url.startsWith("https://api.github.com/repos/ishinaillab/")));
});
test("rejects missing and oversized readback tokens without sending HTTP requests",async()=>{
  for(const token of ["", "abc", "x".repeat(2049), 42]){
    let calls=0;
    await assert.rejects(verifyPriority3GithubBoundary({
      expectedAppMainSha:appSha,expectedDbMainSha:dbSha,githubToken:token,
      fetchImpl:async()=>{calls++;return new Response("{}",{status:200});}
    }),/credential is invalid/);
    assert.equal(calls,0);
  }
});
test("redacts token and HTTP error bodies while reporting safe endpoint and status",async()=>{
  const token="ghs_sensitive_synthetic_readback_12345";
  const s=makeScenario();
  const errors=[];
  for(const repo of [APP,DB]){
    const target=u(repo,"/environments/"+environments[repo]);
    const calls=new Map(s.docs);
    const fetchImpl=async(url)=>{
      if(url===target)return new Response("SECRET_TOKEN="+token+"; personal data",{status:403,headers:{"x-ratelimit-remaining":"0"}});
      return new Response(JSON.stringify(calls.get(url)),{status:200});
    };
    await assert.rejects(verifyPriority3GithubBoundary({
      expectedAppMainSha:appSha,expectedDbMainSha:dbSha,githubToken:token,fetchImpl
    }),e=>{
      errors.push(e.message);
      return e.message.includes(repo===APP?"app environment HTTP 403":"db environment HTTP 403") &&
        e.message.includes("remaining=0") &&
        !e.message.includes(token) && !e.message.includes("personal data");
    });
  }
  assert.equal(errors.length,2);
});
test("fails closed on network failures without exposing token",async()=>{
  const token="ghs_sensitive_synthetic_readback_12345";
  await assert.rejects(verifyPriority3GithubBoundary({
    expectedAppMainSha:appSha,expectedDbMainSha:dbSha,githubToken:token,
    fetchImpl:async()=>{throw Error(token);}
  }),e=>/network: app metadata/.test(e.message)&&!e.message.includes(token));
});
