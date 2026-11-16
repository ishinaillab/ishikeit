import {verifyPriority3GithubBoundary} from "./verify-priority3-github-release.mjs";

// Read-only smoke; never print credentials or contact non-GitHub hosts.
const credential=process.env.GITHUB_TOKEN;
if(process.env.GITHUB_ACTIONS!=="true" || !credential || credential.length<10)
  throw Error("Read-only GitHub Actions credential is required");
async function readMainSha(repo){
  const uri="https://api.github.com/repos/"+repo+"/commits/main";
  const response=await fetch(uri,{
    method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
    headers:{accept:"application/vnd.github+json",
      authorization:"Bearer "+credential,
      "x-github-api-version":"2022-11-28"}
  });
  if(!response.ok)throw Error("Authenticated GitHub main readback unavailable: "+repo+
    " HTTP "+response.status);
  const result=await response.json();
  if(!/^[0-9a-f]{40}$/u.test(result?.sha??""))
    throw Error("Invalid protected main SHA from GitHub");
  return result.sha;
}
const [appSha,dbSha]=await Promise.all([
  readMainSha("ishinaillab/ishikeit"),
  readMainSha("ishinaillab/ishikeit-db")
]);
const verified=await verifyPriority3GithubBoundary({
  expectedAppMainSha:appSha,expectedDbMainSha:dbSha,authToken:credential
});
if(!verified.verified)throw Error("GitHub owner readback did not verify");
process.stdout.write("Authenticated GitHub APP+DB read-only protected release boundary PASS\n");
