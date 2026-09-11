const adapters = new Map();

function normalizeProvider(value) {
  return String(value || 'none').trim().toLowerCase();
}

function requiredEndpoints(env = process.env) {
  return new Set(
    String(env.BOT_CHALLENGE_REQUIRED_ENDPOINTS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function registerBotChallengeAdapter(name, adapter) {
  const key = normalizeProvider(name);
  if (key === 'none' || !adapter || typeof adapter.verify !== 'function') {
    throw new Error('Bot challenge adapters require a provider name and verify function');
  }
  adapters.set(key, adapter);
}

function unregisterBotChallengeAdapter(name) {
  adapters.delete(normalizeProvider(name));
}

function challengeToken(req) {
  return String(req.headers?.['x-bot-challenge-token'] || req.body?.bot_challenge_token || '').trim().slice(0, 4096);
}

async function verifyBotChallenge({ endpoint, token, req, env = process.env }) {
  const provider = normalizeProvider(env.BOT_CHALLENGE_PROVIDER);
  const required = requiredEndpoints(env);
  const mustVerify = required.has('*') || required.has(String(endpoint || '').toLowerCase());
  if (!mustVerify && !token) return { required: false, verified: false, skipped: true, provider };
  if (provider === 'none') return { required: mustVerify, verified: false, unavailable: mustVerify, provider };
  const adapter = adapters.get(provider);
  if (!adapter) return { required: mustVerify, verified: false, unavailable: true, provider };
  const result = await adapter.verify({ endpoint, token, ip: req.ip, userAgent: req.get?.('user-agent') || '' });
  return { required: mustVerify, provider, verified: Boolean(result?.verified), metadata: result?.metadata || null };
}

function botChallenge(endpoint, { env = process.env } = {}) {
  return async (req, res, next) => {
    try {
      const result = await verifyBotChallenge({ endpoint, token: challengeToken(req), req, env });
      if (result.unavailable) {
        return res.status(503).json({ code: 'BOT_CHALLENGE_UNAVAILABLE', message: 'Submission verification is temporarily unavailable' });
      }
      if (result.required && !result.verified) {
        return res.status(403).json({ code: 'BOT_CHALLENGE_FAILED', message: 'Submission verification failed' });
      }
      req.botChallenge = result;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  botChallenge,
  challengeToken,
  normalizeProvider,
  registerBotChallengeAdapter,
  requiredEndpoints,
  unregisterBotChallengeAdapter,
  verifyBotChallenge
};
