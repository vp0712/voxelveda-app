const { validateProductionReadiness } = require('./productionReadiness');

function validateSecurityEnvironment() {
  const result = validateProductionReadiness(process.env);
  for (const warning of result.warnings) console.warn(`Security readiness warning: ${warning}`);
  return result;
}

module.exports = { validateSecurityEnvironment };
