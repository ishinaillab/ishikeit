/**
 * Defensive execution context for the one-time platform administrator job.
 * GitHub's protected workflow is manual-only. Refuse any schedule,
 * push, pull_request or foreign-workflow invocation even if a later
 * workflow change accidentally adds an unsafe trigger.
 *
 * This is NOT proof of human authorization by itself: the GitHub protected
 * environment's required reviewer, exact deployment branch, official Auth
 * configuration and database audit must also be verified before credentials
 * are used. Retain this independent fail-closed check even with the
 * obsolete scheduled trigger removed from the workflow.
 *
 * GitHub-managed GITHUB_* environment variables are documented at:
 * https://docs.github.com/en/actions/reference/workflows-and-actions/variables
 */
const requiredContext = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "ishinaillab/ishikeit",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF:
    "ishinaillab/ishikeit/.github/workflows/initial-admin-provisioning.yml@refs/heads/main"
} as const;

export function isApprovedFirstOwnerActionContext(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return (Object.keys(requiredContext) as Array<keyof typeof requiredContext>)
    .every(key => env[key] === requiredContext[key]);
}
