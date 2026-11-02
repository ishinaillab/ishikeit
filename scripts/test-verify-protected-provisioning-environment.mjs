import test from "node:test";
import assert from "node:assert/strict";
import { verifyProtectedProvisioningEnvironment } from "./verify-protected-provisioning-environment.mjs";

const repository="ishinaillab/ishikeit";
const ref="refs/heads/main";
const jobToken="github_actions_ephemeral_token_1234567890123456";
const api="https://api.github.com/repos/"+repository;


const protectedEnv={
  name:"ishikeit-provisioning",
  protection_rules:[{
    type:"required_reviewers",
    prevent_self_review:false,
    reviewers:[{type:"User",reviewer:{login:"ishinaillab"}}]
  }],
  deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
};
function client({env=protectedEnv,branches={
  total_count:1,branch_policies:[{name:"main"}]
},mainProtected=true,failAt=null}={}){
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});
    if(failAt&&url.includes(failAt))
      return new Response("PRIVATE BODY",{status:403});
    let data;
    if(url===api+"/environments/ishikeit-provisioning")data=env;
    else if(url===api+"/environments/ishikeit-provisioning/deployment-branch-policies?per_page=100")data=branches;
    else if(url===api+"/branches/main")data={name:"main",protected:mainProtected};
    else throw new Error("unexpected endpoint");
    return new Response(JSON.stringify(data),{
      status:200,headers:{"content-type":"application/json"}
    });
  };
  return {
    calls,
    verify:()=>verifyProtectedProvisioningEnvironment({
      repository,ref,jobToken,fetchImpl
    })
  };
}
test("requires confirmed real reviewers and exact custom branch main policy",async()=>{
  const x=client();
  assert.deepEqual(await x.verify(),{
    ready:true,protectedEnvironment:"ishikeit-provisioning",branch:"main"
  });
  assert.equal(x.calls.length,2);
  assert.ok(x.calls.every(x=>x.init.method==="GET"&&x.init.redirect==="error"));
  assert.ok(x.calls.every(x=>x.init.headers.authorization==="Bearer "+jobToken));
});
test("accepts protected main only when GitHub verifies main branch is protected",async()=>{
  const x=client({env:{
    ...protectedEnv,
    deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}
  }});
  assert.equal((await x.verify()).ready,true);
  const bad=client({env:{
    ...protectedEnv,
    deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}
  },mainProtected:false});
  await assert.rejects(bad.verify(),/not protected/);
});
test("refuses the wrong required human reviewer",async()=>{
  await assert.rejects(client({env:{
    ...protectedEnv,protection_rules:[{
      type:"required_reviewers",
      reviewers:[{type:"User",reviewer:{login:"unapproved-human"}}]
    }]
  }}).verify(),/Human approval/);
});
test("refuses a second GitHub branch pattern alongside main",async()=>{
  await assert.rejects(client({branches:{
    total_count:2,branch_policies:[{name:"main"},{name:"feature/*"}]
  }}).verify(),/main-only/);
  await assert.rejects(client({branches:{
    total_count:2,branch_policies:[{name:"main"}]
  }}).verify(),/main-only/);
});
test("rejects unreviewed or missing GitHub Actions environments",async()=>{
  await assert.rejects(client({env:{
    ...protectedEnv,protection_rules:[]
  }}).verify(),/Human approval/);
  await assert.rejects(client({env:{
    ...protectedEnv,protection_rules:[{type:"required_reviewers",reviewers:[]}]
  }}).verify(),/Human approval/);
  await assert.rejects(client({failAt:"/environments/ishikeit-provisioning"}).verify(),
    /unavailable/);
});
test("refuses broad deploy branch patterns and ambiguous branch rules",async()=>{
  await assert.rejects(client({branches:{
    total_count:1,branch_policies:[{name:"*"}]
  }}).verify(),/main-only/);
  await assert.rejects(client({env:{
    ...protectedEnv,
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:false}
  }}).verify(),/ambiguous/);
});
test("rejects mismatched repository, untrusted main ref or absent job token before request",async()=>{
  let count=0;
  const fetchImpl=async()=>{count++;throw new Error("unexpected network call");};
  for(const params of [
    {repository:"attacker/project",ref,jobToken},
    {repository,ref:"refs/heads/feature",jobToken},
    {repository,ref,jobToken:"short"}
  ]){
    await assert.rejects(verifyProtectedProvisioningEnvironment({
      ...params,fetchImpl
    }));
  }
  assert.equal(count,0);
});
test("network errors never reflect provider responses or job credentials",async()=>{
  await assert.rejects(client({failAt:"deployment-branch-policies"}).verify(),
    /unavailable/);
  await assert.rejects(verifyProtectedProvisioningEnvironment({
    repository,ref,jobToken,
    fetchImpl:async()=>{throw new Error("PRIVATE-TOKEN="+jobToken);}
  }),/unavailable/);
});
