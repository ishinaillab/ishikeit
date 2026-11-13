// Ishikeit continuity observer: read-only assessment, optional REVIEW issue only.
// Not a distributed lock, ChatGPT heartbeat, or automatic takeover mechanism.
const MARKER = 'ISHIKEIT_COORDINATION_V1\n';
export const REVIEW_TITLE = 'ISHIKEIT continuity review required (ledger #284)';
const STATES = new Set(['idle', 'active', 'handoff_requested', 'released']);
const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const MAX_LEASE_SECONDS = 7200;
const MIN_LEASE_SECONDS = 60;
const GRACE_SECONDS = 1800;
const RECENT_PROTECTED_CI_MS = 30 * 60_000; // Activity evidence, NOT an ownership lease

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export function inspectComment(comment, trustedActor) {
  if (!isRecord(comment) || comment.user?.login !== trustedActor || typeof comment.body !== 'string' || !comment.body.startsWith(MARKER)) return null;
  // Never accept edited comments as a renewed heartbeat: Github's created_at is
  // the event clock, not the content's claimed time or the edit timestamp.
  if (comment.body.length > 4096 || timestamp(comment.created_at) === null ||
      timestamp(comment.updated_at) !== timestamp(comment.created_at)) {
    return { kind: 'invalid', id: comment.id ?? null, created_at: comment.created_at ?? null };
  }
  let value;
  try { value = JSON.parse(comment.body.slice(MARKER.length).trim()); }
  catch { return { kind: 'invalid', id: comment.id ?? null, created_at: comment.created_at }; }
  if (!isRecord(value) ||
      !STATES.has(value.state) ||
      !IDENTIFIER.test(value.owner_id ?? '') ||
      !IDENTIFIER.test(value.standby_id ?? '') ||
      !IDENTIFIER.test(value.task_id ?? '') ||
      !Number.isInteger(value.lease_seconds) ||
      value.lease_seconds < MIN_LEASE_SECONDS ||
      value.lease_seconds > MAX_LEASE_SECONDS ||
      typeof value.checkpoint_url !== 'string' ||
      !value.checkpoint_url.startsWith('https://github.com/ishinaillab/ishikeit/') ||
      value.checkpoint_url.length > 250) {
    return { kind: 'invalid', id: comment.id ?? null, created_at: comment.created_at };
  }
  if (value.busy_until !== undefined) {
    const busy = timestamp(value.busy_until);
    const created = timestamp(comment.created_at);
    if (busy === null || busy < created || busy > created + MAX_LEASE_SECONDS * 1000) {
      return { kind: 'invalid', id: comment.id ?? null, created_at: comment.created_at };
    }
  }
  return { kind: 'valid', id: comment.id, created_at: comment.created_at, value };
}

export function latestTrustedEvent(comments, trustedActor) {
  if (!Array.isArray(comments)) throw new Error('Expected list of GitHub issue comments');
  // Server-assigned comment ID is monotonic; do not trust caller-supplied ordering.
  const sorted = [...comments].sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
  for (const comment of sorted) {
    const parsed = inspectComment(comment, trustedActor);
    if (parsed) return parsed; // A malformed NEWER event never falls back to older authority.
  }
  return null;
}

export function assessContinuity(event, nowMs, running = false, recentProtectedCi = false) {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid reference clock');
  if (!event) return { status: 'unconfigured', action: 'none' };
  if (event.kind === 'invalid') return { status: 'invalid_event', action: 'review' };
  const { value } = event;
  if (value.state === 'idle' || value.state === 'released') return { status: 'idle', action: 'none' };
  const observedMs = timestamp(event.created_at);
  if (observedMs === null || observedMs > nowMs + 300_000) return { status: 'clock_ambiguity', action: 'review' };
  // In-job heartbeats are best-effort evidence; even apparently expired ones
  // NEVER confer ownership on a standby agent.
  const ageSeconds = (nowMs - observedMs) / 1000;
  const expires = value.lease_seconds + GRACE_SECONDS;
  if (ageSeconds <= expires) return { status: 'progress_recent', action: 'none' };
  if (value.busy_until && timestamp(value.busy_until) > nowMs) return { status: 'possible_long_running_operation', action: 'none' };
  if (running) return { status: 'active_ci_possible', action: 'none' };
  if (recentProtectedCi) return { status: 'recent_protected_ci', action: 'none' };
  return { status: 'stale_progress_needs_review', action: 'review' };
}

const MAX_JSON_BYTES = 2_000_000;
async function githubApi(path, token, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.github.com' + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init.headers
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('GitHub API ' + response.status + ' at ' + path.split('?')[0]);
  const body = await response.text();
  if (body.length > MAX_JSON_BYTES) throw new Error('GitHub API response size exceeded');
  return JSON.parse(body);
}

export async function runObserver({ repo, issueNumber, token, nowMs = Date.now(), dryRun = false, fetchImpl = fetch }) {
  if (!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(repo) || !Number.isInteger(issueNumber) || issueNumber < 1 || !token) throw new Error('Missing or malformed GitHub configuration');
  const prefix = '/repos/' + repo;
  const comments = await githubApi(prefix + '/issues/' + issueNumber + '/comments?sort=created&direction=desc&per_page=100', token, {}, fetchImpl);
  const event = latestTrustedEvent(comments, repo.split('/')[0]);
  let result = assessContinuity(event, nowMs);
  if (result.status === 'stale_progress_needs_review') {
    // Unfiltered API read also includes queued/waiting and recently finished
    // protected-main CI; status=in_progress would hide all of those.
    const runs = await githubApi(prefix + '/actions/runs?per_page=30', token, {}, fetchImpl);
    if (!Array.isArray(runs.workflow_runs)) throw new Error('Invalid workflow runs response');
    const otherRun = runs.workflow_runs.some((run) => run.name !== 'Ishikeit continuity observer' &&
      ['in_progress', 'queued', 'waiting', 'pending', 'requested'].includes(run.status));
    const recentProtectedCi = runs.workflow_runs.some((run) => {
      if (run.name !== 'CI' || run.event !== 'push' ||
          run.head_branch !== 'main' || run.status !== 'completed' ||
          run.conclusion !== 'success') return false;
      const completedMs = timestamp(run.updated_at);
      // Use Github server timestamps, not a user-submitted claim.
      return completedMs !== null && completedMs <= nowMs + 300_000 &&
        completedMs >= nowMs - RECENT_PROTECTED_CI_MS;
    });
    result = assessContinuity(event, nowMs, otherRun, recentProtectedCi);
  }
  if (result.action !== 'review') return { ...result, review_created: false };
  if (dryRun) return { ...result, review_created: false, dry_run: true };

  const issues = await githubApi(prefix + '/issues?state=open&per_page=100', token, {}, fetchImpl);
  if (!Array.isArray(issues)) throw new Error('Invalid open issues response');
  if (issues.some((issue) => !issue.pull_request && issue.title === REVIEW_TITLE)) {
    return { ...result, review_created: false, review_already_open: true };
  }
  // Review issue is NOT an automatic authority or handoff. Intentionally no
  // secrets, account identifiers, provider payloads or raw issue comments.
  const body = [
    'An external observer detected an ambiguous or stale Ishikeit coordination signal in #' + issueNumber + '.',
    '',
    '**Observed category:** \' ' + result.status + '\' (not proof that a ChatGPT conversation failed).',
    '**Required action:** human review of GitHub/CI/deploy/local state before any ownership transfer.',
    'Do not let a standby perform writes until exclusive fencing is independently proven.',
    'Source of truth: #' + issueNumber + ' and checkpoint #277.',
    '',
    'GitHub scheduled workflow runs may be delayed or dropped. A missing run or chat response alone is not evidence of failure.'
  ].join('\n');
  await githubApi(prefix + '/issues', token, { method: 'POST', body: JSON.stringify({ title: REVIEW_TITLE, body }) }, fetchImpl);
  return { ...result, review_created: true };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replaceAll('\\', '/')).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.CONTINUITY_ISSUE);
  const dryRun = process.env.DRY_RUN !== 'false';
  runObserver({ repo, issueNumber, token: process.env.GITHUB_TOKEN, dryRun })
    .then((result) => console.log('Ishikeit continuity observation: ' + JSON.stringify(result)))
    .catch((err) => { console.error('Continuity observer failed closed: ' + err.message); process.exitCode = 1; });
}
