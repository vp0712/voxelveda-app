const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'controlled-forms-pack.js'), 'utf8');
const documentIds = [...src.matchAll(/'((?:VV-FRM|VV-REG)-\d{3})'/g)].map((match) => match[1]);
const unique = new Set(documentIds);
if (unique.size < 49) throw new Error(`Expected at least 49 controlled form/register IDs, found ${unique.size}`);
if (!src.includes("revision: '1.0'")) throw new Error('Controlled revision metadata is missing');
if (!src.includes('controlledSourceOnly')) throw new Error('Controlled-source guard is missing');
console.log(`Controlled forms source contract passed for ${unique.size} indexed document IDs.`);
