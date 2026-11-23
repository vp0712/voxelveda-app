'use strict';

const express = require('express');
const pool = require('../config/db');
const team = require('../services/aiTeamService');
const feed = express.Router();

function interactive(req) {
  return Boolean(req.session?.id) && req.authType !== 'api_token' && !req.securityContext?.impersonation && !req.securityContext?.breakGlass;
}

function eligible(req) {
  return interactive(req) && team.isAiTeamEligible(req.user);
}

function requireTeamAccess(req, res, next) {
  if (!eligible(req)) return res.status(403).json({ message: 'AI Team activity is available to enrolled administrators.' });
  return next();
}

function eventId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

const handle = action => (req, res, next) => Promise.resolve(action(req, res)).catch(next);

feed.get('/status', handle(async (req, res) => {
  if (!eligible(req)) return res.json({ eligible: false });
  const [preferences, unread] = await Promise.all([
    team.getAiTeamPreferences(pool, req.user.id),
    team.unreadAiTeamEvents(pool, req.user.id)
  ]);
  return res.json({ eligible: true, ...preferences, unread });
}));

feed.use(requireTeamAccess);
feed.get('/events', handle(async (req, res) => {
  const { before } = req.query;
  if (before !== undefined && !eventId(before)) return res.status(400).json({ message: 'Choose a valid activity page.' });
  return res.json(await team.listAiTeamEvents(pool, req.user.id, before));
}));

feed.post('/events/:id/open', handle(async (req, res) => {
  if (!eventId(req.params.id)) return res.status(400).json({ message: 'Choose a valid activity item.' });
  const item = await team.openAiTeamEvent(pool, req.user.id, req.params.id);
  if (!item) return res.status(404).json({ message: 'This activity item is unavailable.' });
  return res.json({ item, unread: await team.unreadAiTeamEvents(pool, req.user.id) });
}));

feed.post('/mark-all-read', handle(async (req, res) => {
  await team.markAllAiTeamEventsRead(pool, req.user.id);
  return res.json({ unread: await team.unreadAiTeamEvents(pool, req.user.id) });
}));

feed.put('/preferences', handle(async (req, res) => {
  const { in_app_enabled, push_enabled } = req.body || {};
  if (typeof in_app_enabled !== 'boolean' || typeof push_enabled !== 'boolean') {
    return res.status(400).json({ message: 'Choose valid AI Team notification preferences.' });
  }
  await team.setAiTeamPreferences(pool, req.user.id, { in_app_enabled, push_enabled });
  return res.json({ eligible: true, in_app_enabled, push_enabled, unread: await team.unreadAiTeamEvents(pool, req.user.id) });
}));

const webhook = handle(async (req, res) => {
  const secret = process.env.AI_TEAM_GITHUB_WEBHOOK_SECRET;
  if (!secret || !/^[1-9][0-9]*$/.test(String(process.env.AI_TEAM_GITHUB_REPOSITORY_ID || '').trim()) || !team.aiTeamRecipientIds().length) {
    return res.status(503).json({ message: 'The AI Team GitHub producer has not been configured.' });
  }
  if (!team.validGitHubSignature(req.rawBody, req.get('X-Hub-Signature-256'), secret)) {
    return res.status(401).json({ message: 'The event signature could not be verified.' });
  }
  let body;
  try { body = JSON.parse(req.rawBody.toString('utf8')); }
  catch { return res.status(400).json({ message: 'A valid JSON event is required.' }); }

  const event = team.eventFromGitHub(req.get('X-GitHub-Event'), body);
  if (!event) return res.status(202).json({ recorded: false });
  const result = await team.recordAiTeamEvent(pool, event);
  return res.status(result.recorded ? 201 : 200).json({ recorded: result.recorded });
});

const runner = handle(async (req, res) => {
  const secret = process.env.AI_TEAM_RUNNER_SECRET;
  if (!secret || !team.aiTeamRecipientIds().length) {
    return res.status(503).json({ message: 'The AI Team Codex producer has not been configured.' });
  }
  if (!team.validRunnerSignature(req.rawBody, req.get('X-VV-Signature'), req.get('X-VV-Timestamp'), secret)) {
    return res.status(401).json({ message: 'The event signature could not be verified.' });
  }
  const event = team.eventFromRunner(req.body);
  if (!event) return res.status(400).json({ message: 'A valid run outcome is required.' });
  const result = await team.recordAiTeamEvent(pool, event);
  return res.status(result.recorded ? 201 : 200).json({ recorded: result.recorded });
});

module.exports = { feed, webhook, runner };
