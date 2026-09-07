const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(address) {
  const ip = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 2, 168].includes(b)) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('ff');
  }
  return true;
}

function allowedHosts(env = process.env) {
  return new Set(String(env.OUTBOUND_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function validateOutboundUrl(value, env = process.env) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw Object.assign(new Error('Outbound URL is invalid'), { statusCode: 400 }); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Object.assign(new Error('Outbound destinations must use HTTPS without embedded credentials or custom ports'), { statusCode: 400 });
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allowedHosts(env).has(hostname)) throw Object.assign(new Error('Outbound destination is not allowlisted'), { statusCode: 403 });
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw Object.assign(new Error('Private network destinations are forbidden'), { statusCode: 403 });
  return url;
}

async function assertSafeOutboundUrl(value, env = process.env) {
  const url = validateOutboundUrl(value, env);
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw Object.assign(new Error('Outbound destination resolves to a private or unsafe network'), { statusCode: 403 });
  return url;
}

module.exports = { allowedHosts, assertSafeOutboundUrl, isPrivateIp, validateOutboundUrl };
