const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HIGH_RISK_PATH_PREFIXES = ['/api/high-risk-finance','/api/security','/api/users','/api/settings','/api/finance'];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function scoreRequestRisk(req) {
  const signals = [];
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const write = WRITE_METHODS.has(method);
  const highRiskPath = HIGH_RISK_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  const assurance = Number(req.session?.assuranceLevel || 0);
  const add = (key, points, detail) => signals.push({ key, points, detail });

  if (write) add('WRITE_REQUEST', 8, `${method} request`);
  if (highRiskPath) add('HIGH_RISK_MODULE', 16, path);
  if (write && highRiskPath) add('HIGH_RISK_MUTATION', 14, 'Write request against a sensitive module');
  if (req.authType === 'api_token' && write) add('SERVICE_CREDENTIAL_MUTATION', 12, 'API token performing a mutation');
  if (assurance < 2 && highRiskPath) add('LOW_ASSURANCE_FOR_SENSITIVE_MODULE', 30, `Assurance level ${assurance}`);
  if (req.securityContext?.breakGlass) add('BREAK_GLASS_CONTEXT', 30, 'Emergency delegated access is active');
  if (req.securityContext?.impersonation) add('IMPERSONATION_CONTEXT', write ? 100 : 25, write ? 'Write under impersonation is prohibited' : 'Read-only support impersonation');

  const score = clamp(signals.reduce((sum, signal) => sum + signal.points, 0), 0, 100);
  const tier = score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return {
    score,
    tier,
    signals,
    requires_additional_review: tier === 'HIGH' || tier === 'CRITICAL',
    enforcement_note: 'Risk scoring is advisory unless a route has an explicit permission, step-up, dual-control or denial policy.'
  };
}

module.exports = { scoreRequestRisk };
