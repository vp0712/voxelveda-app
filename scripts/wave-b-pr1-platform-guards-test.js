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
  customerRegistrationContract,
  loginContract,
  mfaCodeContract,
  passwordChangeContract
} = require('../middleware/publicEndpointProtection');
const {
  botChallenge,
  registerBotChallengeAdapter,
  unregisterBotChallengeAdapter
} = require('../services/botChallengeService');
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
  assert.equal(authPolicyName('/customer-register'), 'customer_registration');
  assert(RATE_LIMIT_POLICIES.customer_registration.max < RATE_LIMIT_POLICIES.authenticated_api.max);

  const validRegistration = { name: 'Account Example', email: 'fixture@example.invalid', password: 'long password value', confirm_privacy: true };
  assert.equal((await invoke(customerRegistrationContract, { body: validRegistration, headers: {} })).nextCalled, true);
  for (const body of [
    { ...validRegistration, role: 'super_admin' },
    { ...validRegistration, permissions: ['MANAGE_USERS'] },
    { ...validRegistration, email: 'invalid' },
    { ...validRegistration, confirm_privacy: 'true' },
    { ...validRegistration, confirm_privacy: false },
    { ...validRegistration, name: '' }, []
  ]) assert.equal((await invoke(customerRegistrationContract, { body, headers: {} })).res.statusCode, 400);
  assert.equal((await invoke(customerRegistrationContract, { body: validRegistration, rawBody: Buffer.alloc(8 * 1024 + 1), headers: {} })).res.statusCode, 400);

  const validLogin = { email: 'fixture@example.invalid', password: 'fixture password' };
  assert.equal((await invoke(loginContract, { body: validLogin, headers: {} })).nextCalled, true);
  for (const body of [
    { ...validLogin, role: 'super_admin' }, { ...validLogin, password: '' },
    { ...validLogin, email: '<script>' }, [], null
  ]) assert.equal((await invoke(loginContract, { body, headers: {} })).res.statusCode, 400);
  assert.equal((await invoke(loginContract, { body: validLogin, rawBody: Buffer.alloc(8 * 1024 + 1), headers: {} })).res.statusCode, 400);
  const challenge = { challenge_token: 'a'.repeat(40), code: '123456' };
  assert.equal((await invoke(mfaCodeContract, { body: challenge, headers: {} })).nextCalled, true);
  assert.equal((await invoke(mfaCodeContract, { body: { ...challenge, code: '<script>' }, headers: {} })).res.statusCode, 400);
  assert.equal((await invoke(mfaCodeContract, { body: { ...challenge, user_id: 999 }, headers: {} })).res.statusCode, 400);
  assert.equal((await invoke(passwordChangeContract, { body: { current_password: 'fixture old', new_password: 'fixture new' }, headers: {} })).nextCalled, true);
  assert.equal((await invoke(passwordChangeContract, { body: { current_password: 'fixture old', new_password: 'fixture new', user_id: 999 }, headers: {} })).res.statusCode, 400);

  const challengeName = 'test-adapter';
  registerBotChallengeAdapter(challengeName, { async verify({ token }) { return { verified: token === 'valid' }; } });
  const challengeEnv = { BOT_CHALLENGE_PROVIDER: challengeName, BOT_CHALLENGE_REQUIRED_ENDPOINTS: 'customer_registration' };
  assert.equal((await invoke(botChallenge('customer_registration', { env: challengeEnv }), { headers: { 'x-bot-challenge-token': 'valid' }, body: {}, ip: '1.1.1.1', get: () => '' })).nextCalled, true);
  assert.equal((await invoke(botChallenge('customer_registration', { env: challengeEnv }), { headers: {}, body: {}, ip: '1.1.1.1', get: () => '' })).res.statusCode, 403);
  assert.equal((await invoke(botChallenge('customer_registration', { env: { BOT_CHALLENGE_PROVIDER: 'none', BOT_CHALLENGE_REQUIRED_ENDPOINTS: 'customer_registration' } }), { headers: {}, body: {}, ip: '1.1.1.1', get: () => '' })).res.statusCode, 503);
  unregisterBotChallengeAdapter(challengeName);

  const readiness = assessProductionReadiness({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_FAILURE_POLICY: 'memory' });
  assert(readiness.failures.some((item) => item.includes('fail closed')));

  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(root, 'controllers', 'authController.js'), 'utf8');
  const authRoutesSource = fs.readFileSync(path.join(root, 'routes', 'authRoutes.js'), 'utf8');
  const registerHtml = fs.readFileSync(path.join(root, 'public', 'register.html'), 'utf8');
  assert.match(appSource, /app\.use\('\/api\/auth',express\.json\(\{limit:'8kb'/);
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
