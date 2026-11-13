# Ishikeit dual-conversation continuity and safe recovery (2026-11-13)

This is a **working safety protocol** and a **bounded external observer**, not a promise that ChatGPT continues running when a conversation ends. The project source of truth is the latest [checkpoint #277](https://github.com/ishinaillab/ishikeit/issues/277), live source/CI/Hostinger Supabase evidence, and the [coordination ledger #284](https://github.com/ishinaillab/ishikeit/issues/284).

## Roles and authority

- Primary: `chatgpt-primary-window-1`. Responsible for development, verified checkpoint and progress events during active ChatGPT execution.
- Standby: `chatgpt-standby-window-2`. A second project-scoped conversation created using the authorized Windows desktop; **read-only observer** until safe takeover is independently proven.
- The user can operate both windows. A second conversation is NOT guaranteed to run periodically, share live execution state with the primary, or start itself after a failure.
- ChatGPT Scheduled Tasks were already at the **five active tasks** limit at setup. Do not displace an existing user task without authorization.
- The standby's exact conversation ID and a ChatGPT API for cross-conversation automation were not established; do not invent them.

## Durable records and event format

The newest versioned repo sources, PR/CI/test evidence, current source SHA and runtime readbacks are authoritative for implementation state. The #277 checkpoint provides an append-only chronological release log; prioritize its newest verified comment over old prose. #284 holds short coordination observations, not secrets and not the complete implementation checkpoint.

To record an event, a trusted GitHub actor `ishinaillab` appends a **new issue comment** on #284 consisting of the exact prefix and standalone JSON:

```text
ISHIKEIT_COORDINATION_V1
{"state":"active","owner_id":"chatgpt-primary-window-1","standby_id":"chatgpt-standby-window-2","task_id":"continuity-bootstrap","checkpoint_url":"https://github.com/ishinaillab/ishikeit/issues/277","lease_seconds":1800}
```

Allowed states: `active` (an explicitly observed progressing operation), `handoff_requested` (a planned handoff), `idle` (no active execution obligation), and `released` (no claim of ownership). The GitHub-created comment timestamp is the event time; editing old comments is invalid. A validated optional `busy_until` timestamp may cover an announced long-running action but must fall no more than two hours after the comment. `lease_seconds` must be 60–7,200, and the observer gives an extra 1,800-second grace window.

**Crucial:** the described lease/grace is only a *monitoring timeout*, **NOT an exclusive lock**. It does not prevent two ChatGPT conversations from writing at the same time. It is inappropriate as an authorization token, database migration lock, deployment fence, or proof of a terminated chat. ChatGPT does not keep posting heartbeats when it is not executing; human and system idle periods are normal. Do not tag idle as failed.

## External observer

`.github/workflows/ishikeit-continuity-observer.yml` runs a Node24 native [test runner](https://nodejs.org/api/test.html) and `scripts/continuity-observer.mjs`. It uses the repository-specific ephemeral `GITHUB_TOKEN`, scoped to `contents:read`, `actions:read`, `issues:write`. It holds **no** Supabase, Hostinger, OAuth, MFA, customer, deployment or ChatGPT credentials.

Triggers:
- push to `main` that changes monitor code/workflow: real GitHub API smoke, hard-coded dry run (no review writes);
- `workflow_dispatch` on `main`: default dry run; explicitly disabled dry-run can open a *manual* review issue;
- scheduled at minute 17 and 47 each hour. GitHub explicitly documents that scheduled runs may be delayed or dropped.

Observation rules:
1. Read up to 100 most recent #284 issue comments. Trust only an exact marker from the repository owner, parse strict identifiers and timestamps, reject edited/malformed records without reverting to older authority.
2. No event, `idle`, `released`, or recent progress means **no alarm**.
3. When an active/handoff record exceeds its declared window plus grace, check currently running other GitHub Actions. A running CI or a bounded busy declaration makes the situation **ambiguous**, not a verified failure.
4. If stale with no observed CI, create one deduplicated **ISHIKEIT continuity review required (ledger #284)** issue only. Its creation asks for **human investigation**, not automatic takeover.
5. A GitHub API failure stops the monitor (fail closed). No external state mutation occurs except creating the manual-review issue, after successful prerequisite reads and deduplication.
6. No automatic commit, merge, deploy, database write, credential use, ChatGPT messaging, new conversation, or ownership transfer is implemented.

The first verified scheduled run and actionable review-issue creation must be read back before claiming full operational external monitoring. Unit tests with synthetic API responses prove safety branches, not live scheduling or real interruption detection.

## Safe handoff or unexpected interruption

1. Verify #284 latest record and #277 latest checkpoint, GitHub protected `main`, currently open PRs, CI, independent Hostinger exact deployment and health, Supabase schema/migrations, and the original Windows checkout status. Take note of active builds, deploys or pending changes. **A blank ChatGPT response is never enough.**
2. If any live development operation, valid owner-proven lease, uncertainty, or outstanding owner-controlled MFA requirement exists: remain standby observer. Do not reset/stash/clean anything.
3. To enable actual automatic takeover later, first implement and **prove** an independent exclusive task lock with time-bounded ownership, monotonically increasing fencing token, transactional compare-and-set updates, and fencing verification by every code/deploy/DB writer. The current GitHub comment observer provides none of those enforcement guarantees.
4. Once a separately implemented fence and failure verification exist, the new owner must atomically acquire exclusive authority, reread current branch/source/live deployment, protect unpublished edits, follow required approval gates, create a fresh clean worktree from remote `main`, and resume exactly the unfinished unit.
5. Before ending a session, publish a new #277 (or successor) checkpoint with verified SHA/PR/build/test/deploy, schema, changed files, local preservation status, outstanding acceptance, next task and rollback. End an active coordination record with `idle` or `released` when appropriate.
6. New ChatGPT conversations must be created inside Ishikeit. An unattended new conversation requires separately documented, authorized external scheduling/API/browsing support; a GitHub scheduled workflow **cannot** launch ChatGPT by itself.

## Current development constraints as of initial setup

- The last #277 release update identifies app PR #283, `main` SHA `860e3fabe0dba80bc06db71a2e978c8c12e717f9`, plus DB PR #22 `0fe65c1737006813e1d205ce57c21641e3796dcf`, tracked migration `20261112104427`; reverify against live sources before using as current.
- Source checkout `D:\projects\openai\ishikeit\ishikeit` has seven preexisting unpublished changes. **Never reset, stash, clean, overwrite, or merge there.** Use isolated worktrees.
- Owner's verified TOTP authenticators must remain intact; no real MFA factor deletion or token readback as part of handoff.
- Workspace connection #230 still needs authentic provider-native identity/consent, AAL2-session-bound account link UI, actual generation-fenced tenant-safe ingress/dispatch and controlled cutover. #206 per-account provenance/freshness and #216 live booking/checkout remain open.
- No application or production DB changes are required by this observer. Its live rollout is independent of the Node24/PG17 application deployment.

## Authority

[GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [workflow concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency), [least-privileged GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [GitHub issue comments](https://docs.github.com/en/rest/issues/comments), [GitHub issue creation](https://docs.github.com/en/rest/issues/issues), [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [ChatGPT scheduled task limits](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).

**Verification boundary:** This protocol deliberately stops short of unauthorized autonomous ChatGPT restarts, unproven fencing, or destructive owner takeover. Those would require additional supported and independently tested infrastructure.

## 2026-11-13 — GitHub schedule gap and independent protected-CI trigger

**Incident observation (official live readback):** GitHub Actions workflow ID `416836845`, `.github/workflows/ishikeit-continuity-observer.yml`, reported `state=active` and **one push run / zero scheduled runs** despite off-hour `17,47 * * * *` cron being present on protected default main since 03:21 UTC 2026-11-13. The exact root cause was **not verified**. GitHub documents that schedule can be delayed/dropped and that associated actors can become inactive; don't claim the workflow was broken for a specific reason without independent evidence.

**Reliability hardening:** Revise cron to `23,53 * * * *` to refresh the schedule actor under documented GitHub behavior; retain the independent periodic trigger but do not claim it resumed without an actual **schedule** event. Add `workflow_run` for successful protected-main `CI` push completions; ignore PR-origin, forks, failed runs, foreign branches and manual CI events. Only protected main is checked out. No untrusted PR SHA, CI artifacts, cache, PR code or user input is executed in this privileged monitor. The workflow uses only its ephemeral repository `GITHUB_TOKEN` with narrowly declared issues write, actions read and contents read; no external API/production credentials or server access. Workflow runs remain bounded to five minutes.

**Monitoring classification improvement:** Query the **unfiltered** recent GitHub Actions runs to detect queued/waiting/in-progress jobs (previous filtered API would hide queued/waiting) and successful protected-main CI completed in the last 30 minutes. Recent successful main CI means an apparent stale conversation record is **ambiguous**; suppress a false takeover alert rather than treating it as proof of normal activity. Expired/failed/PR/foreign-branch CI does not qualify. Existing review-issue deduplication, trusted-comment validation and fail-closed API behavior are unchanged. This monitor does not provide or enforce exclusive ownership/fencing.

**Verification boundaries:** 18 isolated Node native monitor tests (4 new) pass; static workflow safeguards verified. Protected GitHub PR CI, post-merge workflow_run event and any actual schedule event must be verified before those triggers are called operational. Do not infer automatic ChatGPT restart, cross-chat heartbeat, authoritative interruption verification, or safe takeover from these GitHub observations. If schedule remains absent, continue investigation of GitHub policy/actor/plan and consider a separately authorized independent scheduler; never silently substitute long-running ChatGPT or reassign one of the existing five user tasks.

Official current sources: [GitHub Events/workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GitHub troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows), [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use), [GitHub workflow REST](https://docs.github.com/en/rest/actions/workflows), [GitHub workflow runs REST](https://docs.github.com/en/rest/actions/workflow-runs).
