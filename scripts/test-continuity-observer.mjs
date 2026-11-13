import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { inspectComment, latestTrustedEvent, assessContinuity, runObserver, REVIEW_TITLE } from './continuity-observer.mjs';

const NOW = Date.parse('2026-11-13T04:00:00.000Z');
const actor = 'ishinaillab';
function comment({ id = 1, state = 'active', ageSec = 0, lease = 1800, user = actor, edited = false, busyUntil, body } = {}) {
  const created_at = new Date(NOW - ageSec * 1000).toISOString();
  const v = { state, owner_id: 'chatgpt-primary-window-1', standby_id: 'chatgpt-standby-window-2', task_id: 'continuity-bootstrap', checkpoint_url: 'https://github.com/ishinaillab/ishikeit/issues/277', lease_seconds: lease };
  if (busyUntil !== undefined) v.busy_until = busyUntil;
  return { id, user: { login: user }, created_at, updated_at: edited ? new Date(NOW).toISOString() : created_at, body: body ?? 'ISHIKEIT_COORDINATION_V1\n' + JSON.stringify(v) };
}

test('valid GitHub-created event is parsed without trusting client clock', () => {
  const event = inspectComment(comment(), actor);
  assert.equal(event.kind, 'valid');
  assert.equal(event.value.state, 'active');
  assert.equal(event.created_at, new Date(NOW).toISOString());
});
test('only exact trusted owner comments are eligible; no spoofed marker/edited heartbeat', () => {
  assert.equal(inspectComment(comment({ user: 'stranger' }), actor), null);
  assert.equal(inspectComment(comment({ body: 'some other text' }), actor), null);
  assert.equal(inspectComment(comment({ edited: true, ageSec: 100 }), actor).kind, 'invalid');
});
test('rejects out-of-range lease, invalid reference, invalid busy extension', () => {
  assert.equal(inspectComment(comment({ lease: 8000 }), actor).kind, 'invalid');
  const badReference = comment();
  badReference.body = badReference.body.replace('/ishikeit/issues/277', '/another/issues/277');
  assert.equal(inspectComment(badReference, actor).kind, 'invalid');
  const excessiveBusy = comment({ busyUntil: new Date(NOW + 8000000).toISOString() });
  assert.equal(inspectComment(excessiveBusy, actor).kind, 'invalid');
});
test('a malformed newer trusted event fences older valid progress', () => {
  const event = latestTrustedEvent([comment({ id: 3 }), comment({ id: 4, body: 'ISHIKEIT_COORDINATION_V1\n{broken' }), comment({ id: 5, user: 'untrusted' })], actor);
  assert.equal(event.kind, 'invalid');
  assert.equal(event.id, 4);
});
test('idle/released and absent event never result in an interruption alert', () => {
  assert.deepEqual(assessContinuity(null, NOW), { status: 'unconfigured', action: 'none' });
  assert.equal(assessContinuity(inspectComment(comment({ state: 'idle', ageSec: 90000 }), actor), NOW).status, 'idle');
  assert.equal(assessContinuity(inspectComment(comment({ state: 'released', ageSec: 90000 }), actor), NOW).action, 'none');
});
test('recent progress does not indicate a failure; staleness prompts only review', () => {
  const recent = inspectComment(comment({ ageSec: 3500 }), actor);
  const stale = inspectComment(comment({ ageSec: 3601 }), actor);
  assert.equal(assessContinuity(recent, NOW).status, 'progress_recent');
  assert.deepEqual(assessContinuity(stale, NOW), { status: 'stale_progress_needs_review', action: 'review' });
  assert.equal(assessContinuity(stale, NOW, true).status, 'active_ci_possible');
});
test('long-running declared operations are ambiguous and never automatic takeover', () => {
  const c = comment({ ageSec: 2000, lease: 60, busyUntil: new Date(NOW + 1000 * 60).toISOString() });
  const event = inspectComment(c, actor);
  assert.equal(event.kind, 'valid');
  assert.equal(assessContinuity(event, NOW).status, 'possible_long_running_operation');
});
test('future GitHub timestamp produces ambiguous alert, not transfer', () => {
  const c = comment({ ageSec: -900 });
  assert.equal(assessContinuity(inspectComment(c, actor), NOW).status, 'clock_ambiguity');
});

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }; }
function mockGitHub(events, { runs = [], issues = [], failOnPost = false } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.includes('/comments?')) return response(events);
    if (url.includes('/actions/runs?')) return response({ workflow_runs: runs });
    if (url.endsWith('/issues') && init.method === 'POST') return failOnPost ? response({}, 403) : response({ number: 999 }, 201);
    if (url.includes('/issues?')) return response(issues);
    throw new Error('Unexpected path ' + url);
  };
  return { calls, fetchImpl: f };
}
const config = { repo: 'ishinaillab/ishikeit', issueNumber: 284, token: 'test-not-secret', nowMs: NOW };
test('unconfigured monitor makes no writes; no issue is invented', async () => {
  const api = mockGitHub([]);
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.equal(result.status, 'unconfigured');
  assert.equal(api.calls.length, 1);
});
test('idle primary never causes review even after long silence', async () => {
  const api = mockGitHub([comment({ state: 'idle', ageSec: 90000 })]);
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.equal(result.status, 'idle');
  assert.deepEqual(api.calls.map(c => c.method), ['GET']);
});
test('stale primary with active CI remains ambiguous and makes no writes', async () => {
  const api = mockGitHub([comment({ ageSec: 5000 })], { runs: [{ name: 'CI', status: 'in_progress' }] });
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.equal(result.status, 'active_ci_possible');
  assert.deepEqual(api.calls.map(c => c.method), ['GET', 'GET']);
});
test('stale owner with queued CI remains ambiguous and does not write', async () => {
  const api = mockGitHub([comment({ ageSec: 5000 })], { runs: [{ name: 'CI', status: 'queued' }] });
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.equal(result.status, 'active_ci_possible');
  assert.ok(api.calls.every(call => call.method === 'GET'));
});
test('recent successful protected-main CI is evidence of progress, not automatic ownership transfer', async () => {
  const completed = new Date(NOW - 90_000).toISOString();
  const api = mockGitHub([comment({ ageSec: 5000 })], { runs: [
    { name: 'CI', event: 'push', head_branch: 'main', status: 'completed',
      conclusion: 'success', updated_at: completed }
  ] });
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.deepEqual(result, { status: 'recent_protected_ci', action: 'none', review_created: false });
  assert.ok(api.calls.every(call => call.method === 'GET'));
});
test('an old, failed, PR-origin or foreign branch CI does not bypass stale review', async () => {
  const examples = [
    { event: 'push', head_branch: 'main', conclusion: 'success', updated_at: new Date(NOW - 31*60_000).toISOString() },
    { event: 'push', head_branch: 'main', conclusion: 'failure', updated_at: new Date(NOW - 90_000).toISOString() },
    { event: 'pull_request', head_branch: 'main', conclusion: 'success', updated_at: new Date(NOW - 90_000).toISOString() },
    { event: 'push', head_branch: 'dev', conclusion: 'success', updated_at: new Date(NOW - 90_000).toISOString() },
    { event: 'push', head_branch: 'main', conclusion: 'success', updated_at: 'not-a-date' }
  ];
  for (const example of examples) {
    const api = mockGitHub([comment({ ageSec: 5000 })], { runs: [
      { name: 'CI', status: 'completed', ...example }
    ] });
    const result = await runObserver({ ...config, fetchImpl: api.fetchImpl, dryRun: true });
    assert.equal(result.status, 'stale_progress_needs_review');
    assert.equal(result.dry_run, true);
    assert.ok(api.calls.every(call => call.method === 'GET'));
  }
});
test('observer workflow uses a protected main-only CI trigger, off-peak cron and no PR code checkout', () => {
  const yaml = readFileSync(new URL('../.github/workflows/ishikeit-continuity-observer.yml', import.meta.url), 'utf8');
  assert.match(yaml, /cron: ['"]23,53 \* \* \* \*['"]/);
  assert.match(yaml, /workflow_run:[\s\S]*workflows: \['CI'\][\s\S]*types: \[completed\]/);
  assert.match(yaml, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(yaml, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(yaml, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(yaml, /head_repository\.full_name == github\.repository/);
  assert.match(yaml, /ref: main/);
  assert.match(yaml, /persist-credentials: false/);
  assert.doesNotMatch(yaml, /download-artifact|pull_request_target|\.head\.sha/);
});

test('dry-run stale progress does not create an issue', async () => {
  const api = mockGitHub([comment({ ageSec: 5000 })]);
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl, dryRun: true });
  assert.equal(result.status, 'stale_progress_needs_review');
  assert.equal(result.dry_run, true);
  assert.deepEqual(api.calls.map(c => c.method), ['GET', 'GET']);
});
test('stale review creates at most one manual review issue, not takeover', async () => {
  const api = mockGitHub([comment({ ageSec: 5000 })]);
  const result = await runObserver({ ...config, fetchImpl: api.fetchImpl });
  assert.equal(result.review_created, true);
  assert.deepEqual(api.calls.map(c => c.method), ['GET', 'GET', 'GET', 'POST']);
  const duplicate = mockGitHub([comment({ ageSec: 5000 })], { issues: [{ title: REVIEW_TITLE }] });
  const existing = await runObserver({ ...config, fetchImpl: duplicate.fetchImpl });
  assert.equal(existing.review_already_open, true);
  assert.ok(duplicate.calls.every(c => c.method === 'GET'));
});
test('API read/write errors fail closed rather than silently claiming success', async () => {
  const api = mockGitHub([comment({ ageSec: 5000 })], { failOnPost: true });
  await assert.rejects(() => runObserver({ ...config, fetchImpl: api.fetchImpl }), /GitHub API 403/);
});
