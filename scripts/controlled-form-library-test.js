const fs = require('fs');
const path = require('path');

const controlled = fs.readFileSync(path.join(__dirname, '..', 'public', 'controlled-forms.js'), 'utf8');
const stepUp = fs.readFileSync(path.join(__dirname, '..', 'public', 'step-up.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredIds = [
  'VV-FRM-001', 'VV-FRM-025', 'VV-REG-001', 'VV-REG-002',
  'VV-FRM-028', 'VV-FRM-042', 'VV-REG-004', 'VV-REG-010'
];
requiredIds.forEach((id) => assert(controlled.includes(`'${id}'`), `Missing controlled document ${id}`));

assert(controlled.includes("revision: REVISION"), 'Controlled form revision metadata missing');
assert(controlled.includes('controlledDocument: true'), 'Controlled form marker missing');
assert(controlled.includes('companyFormFields = function controlledCompanyFormFields'), 'Controlled field override missing');
assert(controlled.includes('renderCompanyForms = function controlledRenderCompanyForms'), 'Controlled render integration missing');
assert(controlled.includes("label === 'Preview PDF' || label === 'Download'"), 'Unavailable source-PDF actions are not suppressed');
assert(stepUp.includes('/controlled-forms.js?v=20260908-controlled-packs-r1'), 'Controlled forms loader missing from admin runtime');
assert(!controlled.includes('AS9100 Certified') && !controlled.includes('ISO 9001 Certified') && !controlled.includes('DISP Certified'), 'Unverified certification claim found');

const ids = [...controlled.matchAll(/form\('(VV-(?:FRM|REG)-\d+)'/g)].map((match) => match[1]);
assert(ids.length === 47, `Expected 47 controlled digital forms/registers, found ${ids.length}`);
assert(new Set(ids).size === ids.length, 'Controlled form document IDs must be unique');

console.log(`Controlled form library checks passed for ${ids.length} documents.`);
