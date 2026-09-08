const fs = require('fs');
const path = require('path');

const catalogue = fs.readFileSync(path.join(__dirname, '..', 'public', 'controlled-forms-pack.js'), 'utf8');
const installer = fs.readFileSync(path.join(__dirname, 'install-controlled-forms-runtime.js'), 'utf8');

const required = [
  'VV-FRM-001', 'VV-FRM-025', 'VV-FRM-028', 'VV-FRM-042',
  'VV-REG-001', 'VV-REG-002', 'VV-REG-004', 'VV-REG-010',
  'VV-FAC-001', 'controlledSourceOnly', 'controlledSourcePack'
];
const failures = required.filter((token) => !catalogue.includes(token));
if (!installer.includes('controlled-forms-pack.js')) failures.push('runtime installer does not inject controlled-forms-pack.js');
if (!installer.includes('data-vv-controlled-forms')) failures.push('runtime installer is not idempotent');

if (failures.length) {
  console.error('Controlled forms catalogue checks failed:');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log('Controlled forms catalogue checks passed.');
