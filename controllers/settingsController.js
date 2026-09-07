const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const secureLogger = require('../utils/secureLogger');

const SETTING_RULES = Object.freeze({
  company_email: { max: 254, validate: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) },
  abn: { max: 20, validate: (value) => !value || /^\d{11}$/.test(value.replace(/[\s-]/g, '')) },
  payment_terms: { max: 250 },
  bank_name: { max: 120 },
  website: { max: 300, validate: (value) => { if (!value) return true; try { return new URL(value).protocol === 'https:'; } catch { return false; } } },
  support_phone: { max: 40, validate: (value) => !value || /^[+()\d\s.-]{6,40}$/.test(value) }
});
const ALLOWED_SETTINGS = Object.freeze(Object.keys(SETTING_RULES));

async function ensureSettingsTable(connection = pool) {
  await connection.query(`CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(120) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
  )`);
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Settings must be a JSON object'), { statusCode: 400 });
  const unexpected = Object.keys(input).filter((key) => !SETTING_RULES[key]);
  if (unexpected.length) throw Object.assign(new Error('Unsupported settings cannot be stored'), { statusCode: 400, fields: unexpected });
  const output = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw !== null && !['string', 'number', 'boolean'].includes(typeof raw)) throw Object.assign(new Error(`${key} must be a scalar value`), { statusCode: 400 });
    const value = String(raw ?? '').trim();
    const rule = SETTING_RULES[key];
    if (value.length > rule.max || (rule.validate && !rule.validate(value))) throw Object.assign(new Error(`${key} is not valid`), { statusCode: 400 });
    output[key] = value;
  }
  return output;
}

exports.getSettings = async (req, res) => {
  try {
    await ensureSettingsTable();
    const placeholders = ALLOWED_SETTINGS.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN (${placeholders})`, ALLOWED_SETTINGS);
    const settings = {};
    rows.forEach((row) => { settings[row.setting_key] = row.setting_value; });
    return res.json({ settings });
  } catch (error) {
    secureLogger.error('SETTINGS_READ_FAILED', { requestId: req.requestId, error });
    return res.status(500).json({ message: 'Failed to load settings', requestId: req.requestId });
  }
};

exports.updateSettings = async (req, res) => {
  let settings;
  try { settings = validateSettings(req.body); } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message, fields: error.fields || undefined });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureSettingsTable(connection);
    const keys = Object.keys(settings);
    const before = {};
    if (keys.length) {
      const [rows] = await connection.query(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN (${keys.map(() => '?').join(',')}) FOR UPDATE`, keys);
      rows.forEach((row) => { before[row.setting_key] = row.setting_value; });
    }
    for (const [key, value] of Object.entries(settings)) {
      await connection.query(`INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [key, value]);
    }
    await logAudit(connection, {
      actorId: req.user.id, action: 'SAFE_SETTINGS_CHANGED', module: 'settings', recordType: 'settings',
      recordId: 'company-profile', oldValue: before, newValue: settings, ipAddress: req.ip,
      userAgent: req.get('user-agent'), requestId: req.requestId, sessionId: req.session?.id,
      metadata: { changed_keys: keys }
    });
    await connection.commit();
    return res.json({ message: 'Settings saved successfully', changed_keys: keys });
  } catch (error) {
    await connection.rollback().catch(() => {});
    secureLogger.error('SETTINGS_UPDATE_FAILED', { requestId: req.requestId, error });
    return res.status(500).json({ message: 'Failed to save settings', requestId: req.requestId });
  } finally { connection.release(); }
};

exports.ALLOWED_SETTINGS = ALLOWED_SETTINGS;
exports.validateSettings = validateSettings;
