const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MemoryRateLimitStore,
  RateLimitService,
  RedisRateLimitStore,
  getRateLimitService,
  opaqueKey,
  setRateLimitServiceForTests
} = require('../services/rateLimitService');
const {
  RATE_LIMIT_POLICIES,
  authPolicyName,
  rateLimit
} = require('../middleware/securityMiddleware');
const {
  aiLeadContract,
  cocVerificationContract,
  customerRegistrationContract,
  publicRfqContract,
  qrGenerationContract
} = require('../middleware/publicEndpointProtection');
const {
  botChallenge,
  registerBotChallengeAdapter,
  unregisterBotChallengeAdapter
} = require('../services/botChallengeService');
const {
  beginPublicSubmission,
  completePublicSubmission,
  payloadHash,
  validatedIdempotencyKey
} = require('../services/publicSubmissionDedupeService');
const { assessProductionReadiness } = require('../config/productionReadiness');

const root = path.join(__dirname, '..');

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendFile(filename) { this.filename = filename; return this; },
    accepts() { return false; }
  };
}

async function invoke(middleware, req) {
  const res = response();
  let nextError;
  let nextCalled = false;
  await middleware(req, res, (error) => { nextError = error; nextCalled = true; });
  if (nextError) throw nextError;
  return { res, nextCalled };
}

class DedupeDb {
  constructor() {
    this.rows = new Map();
  }

  key(type, key) {
    return `${type}:${key}`;
  }

  async query(sql, params) {
    if (sql.includes('INSERT INTO public_submission_dedupe')) {
      const [type, key, payload, lock, ttl] = params;
      const id = this.key(type, key);
      const existing = this.rows.get(id);
      if (!existing || existing.expires_at <= new Date()) {
        this.rows.set(id, {
          payload_sha256: payload,
          lock_token: lock,
          status: 'PROCESSING',
          response_status: null,
          response_json: null,
          expires_at: new Date(Date.now() + ttl * 1000)
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT payload_sha256')) {
      return [[this.rows.get(this.key(params[0], params[1]))].filter(Boolean)];
    }
    if (sql.includes("SET status = 'COMPLETED'")) {
      const [status, json, type, key, lock] = params;
      const row = this.rows.get(this.key(type, key));
      if (row?.lock_token === lock) Object.assign(row, { status: 'COMPLETED', response_status: status, response_json: json });
      return [{ affectedRows: row?.lock_token === lock ? 1 : 0 }];
    }
    if (sql.includes("SET status = 'FAILED'")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected dedupe query: ${sql}`);
  }
}

async function run() {
  let now = 1000;
  const memory = new MemoryRateLimitStore({ namespace: 'test:one', now: () => now });
  assert.equal((await memory.consume('client', 1000)).count, 1);
  assert.equal((await memory.consume('client', 1000)).count, 2);
  now = 2001;
  assert.equal((await memory.consume('client', 1000)).count, 1, 'counter resets after TTL');
  assert.notEqual(opaqueKey('test:one', 'client'), opaqueKey('test:two', 'client'));
  assert.equal(opaqueKey('test:one', 'client'), opaqueKey('test:one', 'client'));
  assert(!opaqueKey('test:one', 'client').includes('client'), 'stored keys must not expose client identifiers');

  const fakeRedis = {
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true; },
    async ping() { return 'PONG'; },
    async eval() { return [2, 950]; },
    async quit() { this.isOpen = false; }
  };
  const redis = new RedisRateLimitStore({ url: 'redis://example', namespace: 'shared', clientFactory: () => fakeRedis });
  assert.equal((await redis.initialize()).ok, true);
  const redisResult = await redis.consume('ip', 1000);
  assert.equal(redisResult.count, 2);
  assert.equal(redisResult.ttlMs, 950);
  assert(Number.isFinite(redisResult.resetAt));
  assert.equal((await redis.health()).provider, 'REDIS');
  await redis.close();

  const sharedCounters = new Map();
  const sharedClientFactory = () => ({
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true; },
    async ping() { return 'PONG'; },
    async eval(_script, options) {
      const key = options.keys[0];
      const count = (sharedCounters.get(key) || 0) + 1;
      sharedCounters.set(key, count);
      return [count, Number(options.arguments[0])];
    },
    async quit() { this.isOpen = false; }
  });
  const replicaOne = new RedisRateLimitStore({ url: 'redis://shared', namespace: 'cluster', clientFactory: sharedClientFactory });
  const replicaTwo = new RedisRateLimitStore({ url: 'redis://shared', namespace: 'cluster', clientFactory: sharedClientFactory });
  await replicaOne.initialize();
  await replicaTwo.initialize();
  assert.equal((await replicaOne.consume('same-client', 60000)).count, 1);
  assert.equal((await replicaTwo.consume('same-client', 60000)).count, 2, 'separate replicas share a namespaced Redis counter');
  await replicaOne.close();
  await replicaTwo.close();

  const productionFailure = new RateLimitService({ env: { NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_FAILURE_POLICY: 'deny' } });
  await assert.rejects(() => productionFailure.initialize(), { code: 'RATE_LIMIT_STORE_UNAVAILABLE' });
  assert.equal(productionFailure.status().state, 'FAILED');
  const failingClientFactory = () => ({
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true; },
    async ping() { const error = new Error('provider unavailable'); error.code = 'ECONNREFUSED'; throw error; },
    async quit() { this.isOpen = false; }
  });
  const redisHealthFailure = new RateLimitService({
    env: { NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_FAILURE_POLICY: 'deny', REDIS_URL: 'redis://unavailable' },
    clientFactory: failingClientFactory
  });
  await assert.rejects(() => redisHealthFailure.initialize(), { code: 'RATE_LIMIT_STORE_UNAVAILABLE' });
  assert.equal(redisHealthFailure.status().last_error_code, 'ECONNREFUSED');
  const developmentFallback = new RateLimitService({ env: { NODE_ENV: 'test', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_FAILURE_POLICY: 'memory' } });
  assert.equal((await developmentFallback.initialize()).state, 'DEGRADED');
  assert.equal(developmentFallback.status().provider, 'MEMORY');

  const originalLimiter = getRateLimitService();
  const middlewareStore = new RateLimitService({ env: { NODE_ENV: 'test', RATE_LIMIT_STORE: 'memory' } });
  await middlewareStore.initialize();
  setRateLimitServiceForTests(middlewareStore);
  const limited = rateLimit({ windowMs: 60000, max: 2, keyPrefix: 'route' });
  assert.equal((await invoke(limited, { ip: '10.0.0.1', headers: {}, path: '/api/test' })).nextCalled, true);
  assert.equal((await invoke(limited, { ip: '10.0.0.1', headers: {}, path: '/api/test' })).nextCalled, true);
  assert.equal((await invoke(limited, { ip: '10.0.0.1', headers: {}, path: '/api/test' })).res.statusCode, 429);
  assert.equal((await invoke(limited, { ip: '10.0.0.2', headers: {}, path: '/api/test' })).nextCalled, true, 'different IP has a separate counter');
  setRateLimitServiceForTests(originalLimiter);

  assert.equal(authPolicyName('/login'), 'login');
  assert.equal(authPolicyName('/mfa/verify'), 'mfa');
  assert.equal(authPolicyName('/step-up'), 'step_up');
  assert.equal(authPolicyName('/password-reset/request'), 'password_reset');
  assert.notEqual(RATE_LIMIT_POLICIES.public_rfq.max, RATE_LIMIT_POLICIES.shift_qr.max);

  const validRfq = { customer_name: 'A Customer', email: 'buyer@example.com', phone: '', material: 'ABS', quantity: 4, application: 'Prototype' };
  assert.equal((await invoke(publicRfqContract, { body: validRfq, headers: {} })).nextCalled, true);
  assert.equal((await invoke(publicRfqContract, { body: { ...validRfq, quantity: 0 }, headers: {} })).res.statusCode, 400);
  assert.equal((await invoke(aiLeadContract, { body: { name: 'Buyer', email: 'buyer@example.com', need: 'Production tooling' }, headers: {} })).nextCalled, true);
  assert.equal((await invoke(customerRegistrationContract, { body: { name: 'Buyer', email: 'buyer@example.com', password: 'long password value', confirm_privacy: true }, headers: {} })).nextCalled, true);
  assert.equal((await invoke(qrGenerationContract, { query: { data: 'safe-value' }, headers: {} })).nextCalled, true);
  assert.equal((await invoke(cocVerificationContract, { params: { no: 'COC-0001' }, query: { hash: 'a'.repeat(64) }, headers: {} })).nextCalled, true);

  const challengeName = 'test-adapter';
  registerBotChallengeAdapter(challengeName, { async verify({ token }) { return { verified: token === 'valid' }; } });
  const challengeEnv = { BOT_CHALLENGE_PROVIDER: challengeName, BOT_CHALLENGE_REQUIRED_ENDPOINTS: 'public_rfq' };
  assert.equal((await invoke(botChallenge('public_rfq', { env: challengeEnv }), { headers: { 'x-bot-challenge-token': 'valid' }, body: {}, ip: '1.1.1.1', get: () => '' })).nextCalled, true);
  assert.equal((await invoke(botChallenge('public_rfq', { env: challengeEnv }), { headers: {}, body: {}, ip: '1.1.1.1', get: () => '' })).res.statusCode, 403);
  assert.equal((await invoke(botChallenge('public_rfq', { env: { BOT_CHALLENGE_PROVIDER: 'none', BOT_CHALLENGE_REQUIRED_ENDPOINTS: 'public_rfq' } }), { headers: {}, body: {}, ip: '1.1.1.1', get: () => '' })).res.statusCode, 503);
  unregisterBotChallengeAdapter(challengeName);

  assert.equal(payloadHash({ a: 1, bot_challenge_token: 'one' }), payloadHash({ a: 1, bot_challenge_token: 'two' }));
  assert.throws(() => validatedIdempotencyKey('bad key'), { code: 'IDEMPOTENCY_KEY_INVALID' });
  const db = new DedupeDb();
  const first = await beginPublicSubmission({ db, submissionType: 'public_rfq', body: validRfq, ip: '1.1.1.1', idempotencyKey: 'request-0001' });
  assert.equal(first.state, 'ACQUIRED');
  await completePublicSubmission(first, 201, { id: 42 }, db);
  const replay = await beginPublicSubmission({ db, submissionType: 'public_rfq', body: validRfq, ip: '1.1.1.1', idempotencyKey: 'request-0001' });
  assert.deepEqual({ state: replay.state, status: replay.status, response: replay.response }, { state: 'REPLAY', status: 201, response: { id: 42 } });
  const conflict = await beginPublicSubmission({ db, submissionType: 'public_rfq', body: { ...validRfq, quantity: 5 }, ip: '1.1.1.1', idempotencyKey: 'request-0001' });
  assert.equal(conflict.state, 'CONFLICT');

  const readiness = assessProductionReadiness({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_FAILURE_POLICY: 'memory' });
  assert(readiness.failures.some((item) => item.includes('fail closed')));

  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(root, 'controllers', 'authController.js'), 'utf8');
  const authRoutesSource = fs.readFileSync(path.join(root, 'routes', 'authRoutes.js'), 'utf8');
  const registerHtml = fs.readFileSync(path.join(root, 'public', 'register.html'), 'utf8');
  assert(appSource.includes("rateLimitPolicy('public_rfq')"));
  assert(appSource.includes("publicSubmissionDedupe({submissionType:'public_rfq'})"));
  assert(appSource.includes("app.use('/api/auth', boundedJson('8kb'))"));
  assert(appSource.includes("app.use('/api/public/rfq', boundedJson('16kb'))"));
  assert(appSource.includes("app.use('/api/public/ai-lead', boundedJson('32kb'))"));
  assert(authRoutesSource.includes("botChallenge('customer_registration')"));
  assert(!authSource.includes('exports.register ='));
  assert(authSource.includes('const passwordCheck = validatePassword(password'));
  assert(registerHtml.includes('minlength="14"'));

  console.log('Wave B PR1 platform guard tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
