const fs = require('node:fs');
const path = require('node:path');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
function expect(source, needle, message) { if (!source.includes(needle)) throw new Error(message || `Expected ${needle}`); }

const wizard = read('public/finance-import-wizard.js');
const styles = read('public/finance-import-wizard.css');
const readiness = read('public/finance-banking-readiness.js');

expect(wizard, 'Import in 5 safe steps', 'Import wizard heading is missing.');
expect(wizard, 'Choose account', 'Import wizard account step is missing.');
expect(wizard, 'Choose file', 'Import wizard file step is missing.');
expect(wizard, 'Preview checks', 'Import wizard preview step is missing.');
expect(wizard, 'Review rows', 'Import wizard review step is missing.');
expect(wizard, 'Approve import', 'Import wizard approval step is missing.');
expect(wizard, "new Set(['CSV','PDF','OFX','QFX','QIF','XLSX'])", 'Supported statement formats must remain explicit.');
expect(wizard, 'Nothing touches your finance records until the final approval step.', 'Import safety explanation is missing.');
expect(wizard, 'Duplicates stay excluded', 'Duplicate handling explanation is missing.');
expect(wizard, 'Preview statement', 'Preview action label is missing.');
expect(wizard, 'Checking statement…', 'Import progress state is missing.');
expect(wizard, "document.readyState === 'loading'", 'Wizard must initialize safely when dynamically loaded.');
expect(styles, '.import-stepper', 'Wizard progress styling is missing.');
expect(styles, '@media(max-width:700px)', 'Wizard must include mobile-specific layout.');
expect(readiness, '/finance-import-wizard.js?v=20260916-wizard2', 'Readiness layer must load the versioned import wizard script.');
expect(readiness, '/finance-import-wizard.css?v=20260916-wizard2', 'Readiness layer must load the versioned import wizard styles.');

console.log('Finance import wizard regression checks passed.');
