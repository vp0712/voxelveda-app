const crypto = require('node:crypto');

const STORE_STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  OPERATIONAL: 'OPERATIONAL',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED'
});

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizeNamespace(value) {
  const namespace = String(value || 'voxelveda:rate-limit').trim();
  return namespace.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80) || 'voxelveda:rate-limit';
}

function opaqueKey(namespace, value) {
  const digest = crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex');
  return `${namespace}:${digest}`;
}

class MemoryRateLimitStore {
  constructor({ namespace, now = () => Date.now(), maxEntries = 50000 } = {}) {
    this.namespace = normalizeNamespace(namespace);
    this.now = now;
    this.maxEntries = positiveInteger(maxEntries, 50000, 100, 1000000);
    this.buckets = new Map();
  }

  prune(now) {
    if (this.buckets.size < this.maxEntries) return;
    for (const [key, entry] of this.buckets.entries()) {
      if (entry.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  async consume(key, windowMs) {
    const now = this.now();
    const duration = positiveInteger(windowMs, 60000, 1000, 86400000);
    const storageKey = opaqueKey(this.namespace, key);
    this.prune(now);
    let entry = this.buckets.get(storageKey);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + duration };
    entry.count += 1;
    this.buckets.set(storageKey, entry);
    return { count: entry.count, resetAt: entry.resetAt, ttlMs: Math.max(0, entry.resetAt - now) };
  }

  async health() {
    return { provider: 'MEMORY', distributed: false, ok: true };
  }

  async close() {
    this.buckets.clear();
  }
}

class RedisRateLimitStore {
  constructor({ url, namespace, connectTimeoutMs = 5000, clientFactory } = {}) {
    this.url = String(url || '').trim();
    this.namespace = normalizeNamespace(namespace);
    this.connectTimeoutMs = positiveInteger(connectTimeoutMs, 5000, 500, 30000);
    this.clientFactory = clientFactory;
    this.client = null;
    this.lastError = null;
  }

  async initialize() {
    if (!this.url) {
      const error = new Error('REDIS_URL is required when RATE_LIMIT_STORE=redis');
      error.code = 'REDIS_URL_REQUIRED';
      throw error;
    }
    const factory = this.clientFactory || ((options) => require('redis').createClient(options));
    this.client = factory({
      url: this.url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: this.connectTimeoutMs,
        reconnectStrategy: false
      }
    });
    this.client.on?.('error', (error) => {
      this.lastError = error;
    });
    await this.client.connect();
    const result = await this.client.ping();
    if (String(result).toUpperCase() !== 'PONG') {
      const error = new Error('Redis health operation did not return PONG');
      error.code = 'REDIS_HEALTH_FAILED';
      throw error;
    }
    return this.health();
  }

  async consume(key, windowMs) {
    if (!this.client?.isOpen) {
      const error = new Error('Redis rate-limit connection is unavailable');
      error.code = 'REDIS_NOT_CONNECTED';
      throw error;
    }
    const duration = positiveInteger(windowMs, 60000, 1000, 86400000);
    const script = [
      "local current = redis.call('INCR', KEYS[1])",
      "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
      "local ttl = redis.call('PTTL', KEYS[1])",
      "if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end",
      'return {current, ttl}'
    ].join('\n');
    const result = await this.client.eval(script, {
      keys: [opaqueKey(this.namespace, key)],
      arguments: [String(duration)]
    });
    const count = Number(result?.[0]);
    const ttlMs = Number(result?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      const error = new Error('Redis returned an invalid rate-limit result');
      error.code = 'REDIS_RESULT_INVALID';
      throw error;
    }
    return { count, ttlMs: Math.max(0, ttlMs), resetAt: Date.now() + Math.max(0, ttlMs) };
  }

  async health() {
    if (!this.client?.isOpen) return { provider: 'REDIS', distributed: true, ok: false };
    const result = await this.client.ping();
    return { provider: 'REDIS', distributed: true, ok: String(result).toUpperCase() === 'PONG' };
  }

  async close() {
    if (!this.client?.isOpen) return;
    await this.client.quit().catch(() => this.client.disconnect?.());
  }
}

class RateLimitService {
  constructor({ env = process.env, clientFactory, now } = {}) {
    this.env = env;
    this.mode = String(env.RATE_LIMIT_STORE || 'memory').trim().toUpperCase();
    this.namespace = normalizeNamespace(env.RATE_LIMIT_NAMESPACE);
    this.production = env.NODE_ENV === 'production';
    this.failurePolicy = String(env.RATE_LIMIT_FAILURE_POLICY || (this.production ? 'deny' : 'memory')).trim().toUpperCase();
    this.memory = new MemoryRateLimitStore({ namespace: this.namespace, now });
    this.clientFactory = clientFactory;
    this.active = this.mode === 'MEMORY' ? this.memory : null;
    this.state = this.mode === 'MEMORY' ? (this.production ? STORE_STATES.DEGRADED : STORE_STATES.OPERATIONAL) : STORE_STATES.INITIALIZING;
    this.lastErrorCode = null;
  }

  canUseMemoryFallback() {
    return !this.production && this.failurePolicy === 'MEMORY';
  }

  async initialize() {
    if (this.mode === 'MEMORY') return this.status();
    if (this.mode !== 'REDIS') {
      const error = new Error(`Unsupported RATE_LIMIT_STORE: ${this.mode}`);
      error.code = 'RATE_LIMIT_STORE_INVALID';
      this.state = STORE_STATES.FAILED;
      this.lastErrorCode = error.code;
      throw error;
    }

    this.state = STORE_STATES.INITIALIZING;
    const redis = new RedisRateLimitStore({
      url: this.env.REDIS_URL,
      namespace: this.namespace,
      connectTimeoutMs: this.env.REDIS_CONNECT_TIMEOUT_MS,
      clientFactory: this.clientFactory
    });
    try {
      const health = await redis.initialize();
      if (!health.ok) {
        const error = new Error('Redis rate-limit health operation failed');
        error.code = 'REDIS_HEALTH_FAILED';
        throw error;
      }
      this.active = redis;
      this.state = STORE_STATES.OPERATIONAL;
      this.lastErrorCode = null;
      return this.status();
    } catch (error) {
      await redis.close().catch(() => {});
      this.state = STORE_STATES.FAILED;
      this.lastErrorCode = String(error.code || 'REDIS_INITIALIZATION_FAILED');
      if (this.canUseMemoryFallback()) {
        this.active = this.memory;
        this.state = STORE_STATES.DEGRADED;
        return this.status();
      }
      this.active = null;
      const unavailable = new Error('Distributed rate limiting is unavailable');
      unavailable.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
      unavailable.causeCode = this.lastErrorCode;
      throw unavailable;
    }
  }

  async consume(key, windowMs) {
    if (!this.active) {
      const error = new Error('Rate-limit store is unavailable');
      error.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
      throw error;
    }
    try {
      return await this.active.consume(key, windowMs);
    } catch (error) {
      this.lastErrorCode = String(error.code || 'RATE_LIMIT_STORE_ERROR');
      if (this.mode === 'REDIS' && this.canUseMemoryFallback()) {
        this.active = this.memory;
        this.state = STORE_STATES.DEGRADED;
        return this.active.consume(key, windowMs);
      }
      this.state = STORE_STATES.FAILED;
      const unavailable = new Error('Rate-limit protection is temporarily unavailable');
      unavailable.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
      unavailable.causeCode = this.lastErrorCode;
      throw unavailable;
    }
  }

  status() {
    return {
      state: this.state,
      provider: this.active instanceof RedisRateLimitStore ? 'REDIS' : (this.active ? 'MEMORY' : this.mode),
      distributed: this.active instanceof RedisRateLimitStore && this.state === STORE_STATES.OPERATIONAL,
      failure_policy: this.failurePolicy,
      last_error_code: this.lastErrorCode
    };
  }

  async close() {
    await this.active?.close?.();
  }
}

let singleton = new RateLimitService();

function getRateLimitService() {
  return singleton;
}

function setRateLimitServiceForTests(service) {
  singleton = service;
}

module.exports = {
  MemoryRateLimitStore,
  RateLimitService,
  RedisRateLimitStore,
  STORE_STATES,
  getRateLimitService,
  normalizeNamespace,
  opaqueKey,
  positiveInteger,
  setRateLimitServiceForTests
};
