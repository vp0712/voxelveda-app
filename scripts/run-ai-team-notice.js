'use strict';

const { spawn } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');

function parseRunOutput(state, line) {
  if (line.length > 16 * 1024) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event?.type === 'thread.started' && typeof event.thread_id === 'string') state.started = true;
  if (state.started && ['turn.completed', 'turn.failed'].includes(event?.type)) state.terminal = event.type;
}

async function publishRun(origin, secret, payload, request = fetch) {
  const endpoint = new URL('/api/ai-team/runner', origin);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const headers = { 'content-type': 'application/json', 'x-vv-timestamp': timestamp, 'x-vv-signature': signature };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try { response = await request(endpoint, { method:'POST', body, headers, redirect:'error', signal:AbortSignal.timeout(10000) }); }
    catch { if (attempt === 0) continue; throw new Error('AI Team event delivery could not be confirmed.'); }
    if ([200, 201].includes(response.status)) return;
    if (response.status >= 500 && attempt === 0) continue;
    throw new Error(`AI Team event was not recorded (HTTP ${response.status}).`);
  }
}

async function run(args, env = process.env) {
  const origin = new URL(env.AI_TEAM_RUNNER_ORIGIN || 'https://app.voxelveda.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.href !== `${origin.origin}/`) {
    throw new Error('AI_TEAM_RUNNER_ORIGIN must be an HTTPS origin.');
  }
  const { AI_TEAM_RUNNER_SECRET: secret, ...childEnv } = env;
  if (!secret) throw new Error('Set AI_TEAM_RUNNER_SECRET securely for this trusted runner.');
  const state = {};
  const child = spawn('codex', ['exec', '--json', ...args], { env: childEnv, stdio:['inherit','pipe','inherit'] });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { process.stdout.write(`${line}\n`); parseRunOutput(state, line); });
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, killedBy) => resolve([status, killedBy]));
  });
  if (!signal && state.started && (state.terminal || code !== 0)) {
    const outcome = state.terminal === 'turn.completed' && code === 0 ? 'completed' : 'failed';
    await publishRun(origin, secret, { run_id: randomUUID(), outcome }).catch(error => console.error(error.message));
  }
  return code ?? 1;
}

if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.code === 'ENOENT' ? 'The signed-in Codex CLI must be installed on this runner.' : error.message);
  process.exitCode = 1;
});

module.exports = { parseRunOutput, publishRun };
