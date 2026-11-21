import {verifyPriority3GithubBoundary} from "./verify-priority3-github-release.mjs";

const token=process.env.ISHIKEIT_GITHUB_READBACK_TOKEN;
if(typeof token!=="string"||token.length<10)
  throw Error("Authenticated protected GitHub readback token missing");

const repos=["ishinaillab/ishikeit","ishinaillab/ishikeit-db"];
const shas=[];
for(const repo of repos){
  const response=await fetch("https://api.github.com/repos/"+repo+"/git/ref/heads/main",{
    method:"GET",redirect:"error",cache:"no-store",
    signal:AbortSignal.timeout(8000),
    headers:{"accept":"application/vnd.github+json",
      "x-github-api-version":"2022-11-28",
      "user-agent":"ishikeit-protected-readback-ci-smoke",
      authorization:"Bearer "+token}
  });
  if(!response.ok)
    throw Error("Protected GitHub readback test blocked at "+repo+
      " main HEAD (HTTP "+response.status+")");
  const result=await response.json();
  if(result?.ref!=="refs/heads/main"||result?.object?.type!=="commit"||
     typeof result.object.sha!=="string"||!/^[0-9a-f]{40}$/u.test(result.object.sha))
    throw Error("Protected GitHub readback returned malformed revision");
  shas.push(result.object.sha);
}
const result=await verifyPriority3GithubBoundary({
  expectedAppMainSha:shas[0],expectedDbMainSha:shas[1],githubToken:token
});
if(result.verified!==true)throw Error("Authenticated release readback not verified");
console.log("REAL GitHub Action token protected main/CI/environment readback passed (read-only)");
