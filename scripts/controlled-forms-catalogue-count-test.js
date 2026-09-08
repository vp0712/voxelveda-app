const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'controlled-forms-pack.js'), 'utf8');
const qms = [...src.matchAll(/'VV-(?:FRM|REG)-\d{3}'/g)];
if (!qms.length) throw new Error('No controlled form identifiers found');
console.log(`Controlled forms catalogue contains ${qms.length} identifier references.`);
