'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const db = require('../config/db');
const team = require('../services/aiTeamService');
const routes = require('../routes/aiTeamRoutes');
const { parseRunOutput, publishRun } = require('./run-ai-team-notice');

const config = {
  AI_TEAM_GITHUB_WEBHOOK_SECRET: 'local-test-signature-secret-not-for-deployment',
  AI_TEAM_RUNNER_SECRET: 'separate-local-test-runner-secret',
  AI_TEAM_GITHUB_REPOSITORY_ID: '1234',
  AI_TEAM_GITHUB_REPOSITORY: 'vp0712/voxelveda-app',
  AI_TEAM_RECIPIENT_USER_IDS: '7, 9, 9, 12, 2147483648, invalid'
};
const repository = { id: 1234, full_name: 'vp0712/voxelveda-app' };
const workflow = { action: 'completed', repository, workflow_run: {
  id: 79, run_attempt: 1, status: 'completed', conclusion: 'failure', name: 'Test workflow',
  html_url: 'https://example.invalid/untrusted'
} };
const digest = body => 'sha256=' + createHmac('sha256', config.AI_TEAM_GITHUB_WEBHOOK_SECRET).update(body).digest('hex');

function producerContract() {
  assert.deepEqual(team.aiTeamRecipientIds(config), [7, 9, 12]);
  assert.equal(team.isAiTeamEligible({ id: 12, role: 'staff' }, config), false);
  assert.equal(team.isAiTeamEligible({ id: 10, role: 'admin' }, config), false);
  const run = team.eventFromGitHub('workflow_run', workflow, config);
  assert.equal(run.source, 'GITHUB_ACTIONS');
  assert.equal(run.eventType, 'RUN_NEEDS_ATTENTION');
  assert.doesNotMatch(JSON.stringify(run), /example.invalid/);
  assert.equal(team.eventFromGitHub('workflow_run', { ...workflow, action: 'requested' }, config), null);
  assert.equal(team.eventFromGitHub('workflow_run', { ...workflow, repository: { ...repository, id: 2222 } }, config), null);
  assert.notEqual(team.eventFromGitHub('workflow_run', { ...workflow, workflow_run: { ...workflow.workflow_run, run_attempt: 2 } }, config).key, run.key);
  const pull_request = { id: 102, number: 22, title: 'Mobile review', state: 'open', draft: false, updated_at: '2026-11-23T12:00:00Z' };
  const request = { action: 'review_requested', repository, pull_request, requested_reviewer: { id: 7 } };
  const review = team.eventFromGitHub('pull_request', request, config);
  assert.equal(review.source, 'GITHUB_PULL_REQUESTS');
  assert.equal(review.reference, 'Pull request #22');
  assert.equal(team.eventFromGitHub('pull_request', { ...request, pull_request: { ...pull_request, draft: true } }, config), null);
  assert.equal(team.eventFromGitHub('pull_request_review', { action: 'submitted', repository, pull_request,
    review: { id: 43, state: 'changes_requested' } }, config).eventType, 'REVIEW_CHANGES_REQUESTED');
  const release = { action: 'published', repository, release: { id: 44, draft: false, prerelease: true, tag_name: 'v3.1-test' } };
  assert.equal(team.eventFromGitHub('release', release, config).title, 'GitHub prerelease published');
  assert.equal(team.eventFromGitHub('push', { action: 'updated', repository }, config), null, 'A source commit does not prove agent activity.');
}

async function run() {
  producerContract();
  const savedEnvironment = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  const users = { owner: { id: 7, role: 'super_admin' }, staff: { id: 12, role: 'staff' }, other: { id: 9, role: 'admin' } };
  const fixtureEvents = new Map();
  const original = { getConnection: db.getConnection, execute: db.execute };
  const transactions = [];
  const event = { id: '1', source: 'GITHUB_ACTIONS', title: 'Workflow needs attention', summary: 'Test workflow · failure',
    created_at: '2026-11-23T12:00:00.000Z', is_read: 0 };
  db.getConnection = async () => ({
    async beginTransaction() { transactions.push('begin'); },
    async commit() { transactions.push('commit'); },
    async rollback() { transactions.push('rollback'); },
    release() { transactions.push('release'); },
    async execute(sql, params) {
      if (sql.includes('INSERT INTO ai_team_events')) {
        if (fixtureEvents.has(params[0])) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        fixtureEvents.set(params[0], event);
        return [{ insertId: 1 }];
      }
      if (sql.includes('INSERT INTO ai_team_recipients')) {
        assert.match(sql, /u.active = 1 AND u.deleted_at IS NULL/);
        assert.match(sql, /LOWER\(u.role\) IN \('admin', 'super_admin'\)/);
        assert.deepEqual(params, [1, 1, 7, 9, 12]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FOR UPDATE')) return [params[0] === 7 && fixtureEvents.size ? [{ ...event, reference_label: 'Run 79 · Attempt 1' }] : []];
      if (sql.includes('UPDATE ai_team_recipients')) { assert.deepEqual(params, [7, '1']); event.is_read = 1; return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected transaction statement');
    }
  });
  db.execute = async (sql, params) => {
    if (sql.includes('SELECT in_app_enabled')) return [[]];
    if (sql.includes('COUNT(*) AS unread')) return [[{ unread: params[0] === 7 && fixtureEvents.size && !event.is_read ? 1 : 0 }]];
    if (sql.includes('JOIN ai_team_events')) return [params[0] === 7 && fixtureEvents.size ? [event] : []];
    throw new Error('Unexpected read statement');
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = Buffer.from(raw); } }));
  app.post('/api/ai-team/github', routes.webhook);
  app.post('/api/ai-team/runner', routes.runner);
  app.use('/api/ai-team', (req, res, next) => {
    req.user = users[req.get('x-fixture-user')];
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    req.session = { id: 'fixture-session' };
    req.authType = req.get('x-fixture-auth');
    if (req.get('x-fixture-impersonated')) req.securityContext = { impersonation: true };
    return next();
  }, routes.feed);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const host = `http://127.0.0.1:${server.address().port}/api/ai-team`;
    const six = JSON.stringify(workflow);
    const postEvent = (payload, signature = digest(payload)) => fetch(host + '/github', { method: 'POST', body: payload,
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_run', 'x-hub-signature-256': signature } });
    const call = (path, user, method = 'GET', additionalHeaders = {}) => fetch(host + path, {
      method, headers: { 'x-fixture-user': user, ...additionalHeaders }
    });
    assert.equal((await postEvent(six + ' ', digest(six))).status, 401, 'The raw signed bytes are authoritative.');
    assert.equal((await postEvent(JSON.stringify({ ...workflow, repository: { ...repository, full_name: 'unrelated/repo' } }))).status, 202);
    assert.equal((await postEvent(six)).status, 201);
    assert.equal((await postEvent(six)).status, 200);
    assert.deepEqual(transactions, ['begin', 'commit', 'release', 'begin', 'rollback', 'release']);
    assert.equal((await call('/status', 'signed-out')).status, 401);
    assert.deepEqual(await (await call('/status', 'staff')).json(), { eligible: false });
    assert.deepEqual(await (await call('/status', 'owner', 'GET', { 'x-fixture-impersonated': 'true' })).json(), { eligible: false });
    assert.equal((await call('/events', 'owner', 'GET', { 'x-fixture-auth': 'api_token' })).status, 403);
    assert.equal((await call('/events', 'staff')).status, 403);
    assert.equal((await call('/events?before=-1', 'owner')).status, 400);
    assert.deepEqual((await (await call('/events', 'owner')).json()).items, [event]);
    assert.deepEqual((await (await call('/events', 'other')).json()).items, []);
    assert.equal((await call('/events/1/open', 'other', 'POST')).status, 404);
    const opened = await (await call('/events/1/open', 'owner', 'POST')).json();
    assert.equal(opened.item.is_read, 1);
    assert.equal(opened.unread, 0);
    const state = {};
    parseRunOutput(state, '{"type":"turn.completed"}');
    assert.deepEqual(state, {}, 'A terminal event alone is insufficient.');
    parseRunOutput(state, '{"type":"thread.started","thread_id":"private-fixture-id"}');
    parseRunOutput(state, '{"type":"turn.failed","error":{"message":"private fixture log"}}');
    assert.deepEqual(state, { started: true, terminal: 'turn.failed' }, 'The parser retains no prompt or log.');
    const payload = { run_id: 'b0278d5d-9fe3-435b-9c5f-5f86eb78d1a5', outcome: 'failed' };
    assert.equal(team.eventFromRunner(payload).source, 'CODEX_CLI');
    let requestCount = 0;
    const replay = async (url, input) => {
      assert.equal(url.pathname, '/api/ai-team/runner');
      assert.deepEqual(JSON.parse(input.body), payload);
      const response = await fetch(host + '/runner', input);
      assert.equal(response.status, ++requestCount === 1 ? 201 : 200);
      if (requestCount === 1) throw new Error('fixture lost the response after persistence');
      const tampered = await fetch(host + '/runner', { ...input, body: input.body + ' ' });
      assert.equal(tampered.status, 401);
      const expired = String(Number(input.headers['x-vv-timestamp']) - 600);
      const signature = 'sha256=' + createHmac('sha256', config.AI_TEAM_RUNNER_SECRET).update(`${expired}.${input.body}`).digest('hex');
      const old = await fetch(host + '/runner', { ...input, headers: { ...input.headers, 'x-vv-timestamp': expired, 'x-vv-signature': signature } });
      assert.equal(old.status, 401);
      return response;
    };
    await publishRun('https://app.voxelveda.com', config.AI_TEAM_RUNNER_SECRET, payload, replay);
    assert.equal(requestCount, 2);
    console.log('PASS AI Team raw-body HMAC, repository allowlist, meaningful event sources, idempotent transaction branch and authorised in-app detail.');
  } finally {
    db.getConnection = original.getConnection;
    db.execute = original.execute;
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
    await db.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
