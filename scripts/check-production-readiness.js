const { validateProductionReadiness } = require('../config/productionReadiness');

try {
  const result = validateProductionReadiness(process.env);
  console.log(result.production ? 'Production security configuration passed critical checks.' : 'Non-production security configuration passed critical checks.');
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
