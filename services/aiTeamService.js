'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const TEAM_ROLES = new Set(['admin', 'super_admin']);
const RUN_FAILURES = new Set(['failure', 'startup_failure', 'timed_out', 'action_required', 'stale']);
const RUN_CONCLUSIONS = new Set(['success', 'cancelled', ...RUN_FAILURES]);
const FEED_PAGE_SIZE = 25;

function aiTeamRecipientIds(env = process.env) {
  return [...new Set(String(env.AI_TEAM_RECIPIENT_USER_IDS || '').split(',')
    .map(value => value.trim()).filter(value => /^[1-9][0-9]{0,9}$/.test(value))
    .map(Number).filter(value => value <= 2147483647))];
}

function isAiTeamEligible(user, env = process.env) {
  return TEAM_ROLES.has(String(user?.role || '').toLowerCase()) && aiTeamRecipientIds(env).includes(Number(user?.id));
}

function validGitHubSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function displayText(value, length) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, length) : '';
}

function eventEntry(identity, source, eventType, title, summary, reference) {
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { key, source, eventType, title, summary, reference };
}

function validRunnerSignature(rawBody, signature, sentAt, secret, now = Date.now()) {
  if (!secret || !Buffer.isBuffer(rawBody) || rawBody.length > 512 ||
      !/^\d{10}$/.test(sentAt || '') || Math.abs(now / 1000 - Number(sentAt)) > 300) return false;
  return validGitHubSignature(Buffer.concat([Buffer.from(sentAt + '.'), rawBody]), signature, secret);
}

function eventFromRunner(body) {
  if (!body || Object.keys(body).length !== 2 ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.run_id || '') ||
      !['completed', 'failed'].includes(body.outcome)) return null;
  const failed = body.outcome === 'failed';
  return eventEntry(['codex-cli', body.run_id], 'CODEX_CLI', failed ? 'RUN_NEEDS_ATTENTION' : 'RUN_FINISHED',
    failed ? 'AI Team run needs attention' : 'AI Team run finished',
    failed ? 'A Codex run ended with a failure.' : 'A Codex run completed.', null);
}

function eventFromGitHub(eventName, body, env = process.env) {
  const repositoryId = String(env.AI_TEAM_GITHUB_REPOSITORY_ID || '').trim();
  const repositoryName = String(env.AI_TEAM_GITHUB_REPOSITORY || 'vp0712/voxelveda-app').trim().toLowerCase();
  if (!/^[1-9][0-9]*$/.test(repositoryId) || !positiveId(body?.repository?.id) ||
      String(body.repository.id) !== repositoryId || String(body.repository.full_name || '').toLowerCase() !== repositoryName) return null;

  const action = body.action;
  const identity = [repositoryId, eventName, action];
  if (eventName === 'workflow_run' && action === 'completed') {
    const run = body.workflow_run;
    if (!positiveId(run?.id) || !positiveId(run?.run_attempt) || run.status !== 'completed' || !RUN_CONCLUSIONS.has(run.conclusion)) return null;
    const failed = RUN_FAILURES.has(run.conclusion);
    const name = displayText(run.name, 100) || 'Workflow';
    return eventEntry([...identity, run.id, run.run_attempt], 'GITHUB_ACTIONS',
      failed ? 'RUN_NEEDS_ATTENTION' : 'RUN_FINISHED',
      failed ? 'Workflow needs attention' : 'Workflow run finished',
      `${name} · ${run.conclusion.replaceAll('_', ' ')}`, `Run ${run.id} · Attempt ${run.run_attempt}`);
  }
  if (eventName === 'pull_request' && ['ready_for_review', 'review_requested'].includes(action)) {
    const pr = body.pull_request;
    if (!positiveId(pr?.id) || !positiveId(pr?.number) || pr.state !== 'open' || pr.draft !== false) return null;
    const reviewer = body.requested_reviewer?.id || body.requested_team?.id;
    if (action === 'review_requested' && !positiveId(reviewer)) return null;
    if (typeof pr.updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(pr.updated_at)) return null;
    const target = action === 'ready_for_review' ? '' : [body.requested_reviewer ? 'user' : 'team', reviewer];
    return eventEntry([...identity, pr.id, pr.updated_at, target], 'GITHUB_PULL_REQUESTS', 'REVIEW_NEEDED',
      action === 'ready_for_review' ? 'Pull request is ready for review' : 'Pull request review requested',
      displayText(pr.title, 240) || 'A pull request needs review.', `Pull request #${pr.number}`);
  }
  if (eventName === 'pull_request_review' && action === 'submitted') {
    const pr = body.pull_request;
    const review = body.review;
    if (!positiveId(pr?.id) || !positiveId(pr?.number) || pr.state !== 'open' ||
        !positiveId(review?.id) || review.state !== 'changes_requested') return null;
    return eventEntry([...identity, pr.id, review.id], 'GITHUB_PULL_REQUESTS', 'REVIEW_CHANGES_REQUESTED',
      'Changes requested in review', displayText(pr.title, 240) || 'A review is waiting for changes.', `Pull request #${pr.number}`);
  }
  if (eventName === 'release' && action === 'published') {
    const release = body.release;
    const tag = displayText(release?.tag_name, 90);
    if (!positiveId(release?.id) || release.draft !== false || !tag) return null;
    return eventEntry([...identity, release.id], 'GITHUB_RELEASES', 'REPOSITORY_RELEASE_PUBLISHED',
      release.prerelease ? 'GitHub prerelease published' : 'GitHub release published',
      displayText(release.name, 240) || tag, `GitHub tag ${tag}`);
  }
  return null;
}

async function recordAiTeamEvent(pool, event, env = process.env) {
  const recipientIds = aiTeamRecipientIds(env);
  if (!recipientIds.length) return { recorded: false };
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    let eventId;
    try {
      const [result] = await db.execute(`INSERT INTO ai_team_events
        (event_key, source, event_type, title, summary, reference_label, created_at)
        VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [event.key, event.source, event.eventType, event.title, event.summary, event.reference]);
      eventId = result.insertId;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      await db.rollback();
      return { recorded: false, duplicate: true };
    }
    const [recipients] = await db.execute(`INSERT INTO ai_team_recipients (event_id, user_id, created_at)
      SELECT ?, u.id, e.created_at
      FROM users u CROSS JOIN ai_team_events e
      LEFT JOIN ai_team_preferences p ON p.user_id = u.id
      WHERE e.id = ? AND u.id IN (${recipientIds.map(() => '?').join(', ')})
        AND u.active = 1 AND u.deleted_at IS NULL
        AND UPPER(COALESCE(u.account_status, '')) NOT IN ('LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED')
        AND LOWER(u.role) IN ('admin', 'super_admin')
        AND (COALESCE(p.in_app_enabled, 1) = 1 OR p.push_enabled = 1)`, [eventId, eventId, ...recipientIds]);
    await db.commit();
    return { recorded: true, recipients: recipients.affectedRows };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

const visibleRecipient = `r.user_id = ? AND NOT EXISTS (
  SELECT 1 FROM ai_team_preferences p WHERE p.user_id = r.user_id AND p.in_app_enabled = 0
)`;
const eventFields = `CAST(e.id AS CHAR) AS id, e.source, e.event_type, e.title, e.summary,
  CONCAT(DATE_FORMAT(e.created_at, '%Y-%m-%dT%H:%i:%s.'), LEFT(DATE_FORMAT(e.created_at, '%f'), 3), 'Z') AS created_at,
  (r.read_at IS NOT NULL) AS is_read`;

async function unreadAiTeamEvents(pool, userId) {
  const [[row]] = await pool.execute(`SELECT COUNT(*) AS unread FROM ai_team_recipients r
    WHERE ${visibleRecipient} AND r.read_at IS NULL`, [userId]);
  return Number(row.unread);
}

async function getAiTeamPreferences(pool, userId) {
  const [[row]] = await pool.execute('SELECT in_app_enabled, push_enabled FROM ai_team_preferences WHERE user_id = ?', [userId]);
  return { in_app_enabled: Number(row?.in_app_enabled ?? 1) === 1, push_enabled: Number(row?.push_enabled ?? 0) === 1 };
}

async function setAiTeamPreferences(pool, userId, { in_app_enabled, push_enabled }) {
  await pool.execute(`INSERT INTO ai_team_preferences (user_id, in_app_enabled, push_enabled, push_enabled_at)
    VALUES (?, ?, ?, IF(? = 1, UTC_TIMESTAMP(3), NULL))
    ON DUPLICATE KEY UPDATE in_app_enabled = VALUES(in_app_enabled),
      push_enabled_at = IF(VALUES(push_enabled) = 1, COALESCE(push_enabled_at, UTC_TIMESTAMP(3)), NULL),
      push_enabled = VALUES(push_enabled)`, [userId, +in_app_enabled, +push_enabled, +push_enabled]);
}

async function listAiTeamEvents(pool, userId, before) {
  const [items] = await pool.execute(`SELECT ${eventFields}
    FROM ai_team_recipients r JOIN ai_team_events e ON e.id = r.event_id
    WHERE ${visibleRecipient}${before ? ' AND r.event_id < ?' : ''}
    ORDER BY r.event_id DESC LIMIT ${FEED_PAGE_SIZE + 1}`, before ? [userId, before] : [userId]);
  const page = items.slice(0, FEED_PAGE_SIZE);
  return { items: page, before: items.length > FEED_PAGE_SIZE ? page.at(-1).id : null };
}

async function openAiTeamEvent(pool, userId, eventId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[event]] = await db.execute(`SELECT ${eventFields}, e.reference_label FROM ai_team_recipients r
      JOIN ai_team_events e ON e.id = r.event_id WHERE ${visibleRecipient} AND r.event_id = ? FOR UPDATE`, [userId, eventId]);
    if (event && !event.is_read) {
      await db.execute(`UPDATE ai_team_recipients r SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
        WHERE ${visibleRecipient} AND r.event_id = ?`, [userId, eventId]);
      event.is_read = 1;
    }
    await db.commit();
    return event || null;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function markAllAiTeamEventsRead(pool, userId) {
  await pool.execute(`UPDATE ai_team_recipients r SET read_at = UTC_TIMESTAMP(3)
    WHERE ${visibleRecipient} AND r.read_at IS NULL`, [userId]);
}

module.exports = {
  aiTeamRecipientIds, isAiTeamEligible, validGitHubSignature, validRunnerSignature,
  eventFromGitHub, eventFromRunner, recordAiTeamEvent,
  unreadAiTeamEvents, getAiTeamPreferences, setAiTeamPreferences, listAiTeamEvents, openAiTeamEvent,
  markAllAiTeamEventsRead
};
