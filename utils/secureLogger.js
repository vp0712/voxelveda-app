const { redactSensitive } = require('./securityRedaction');

function cleanError(error) {
  if (!error) return null;
  return redactSensitive({
    name: error.name,
    code: error.code,
    message: String(error.message || 'Unknown error').slice(0, 500)
  });
}

function write(level, event, metadata = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event: String(event || 'APPLICATION_EVENT').slice(0, 120),
    ...redactSensitive(metadata)
  };
  const output = JSON.stringify(payload);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

module.exports = {
  error(event, metadata = {}) { write('error', event, { ...metadata, error: cleanError(metadata.error) }); },
  info(event, metadata = {}) { write('info', event, metadata); },
  warn(event, metadata = {}) { write('warn', event, { ...metadata, error: cleanError(metadata.error) }); }
};
