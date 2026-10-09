const fs = require('fs');
const path = require('path');

const roots = ['controllers', 'middleware', 'routes', 'services'];
const files = roots.flatMap((root) => fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => path.join(root, entry.name)));
const findings = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const checks = [
    { name: 'request interpolation in SQL template', regex: /\.query\s*\(\s*`[\s\S]{0,1600}\$\{[^}]*req\.(?:body|query|params)/g },
    { name: 'request concatenation in SQL', regex: /\.query\s*\([^;]{0,1600}(?:\+\s*req\.(?:body|query|params)|req\.(?:body|query|params)[^;]{0,300}\+)/g },
    { name: 'raw request data sent as HTML', regex: /res\.send\s*\(\s*req\.(?:body|query|params)/g }
  ];
  for (const check of checks) {
    if (check.regex.test(source)) findings.push(`${file}: ${check.name}`);
  }
}

const browserFiles = fs.readdirSync('public', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => path.join('public', entry.name));
for (const file of browserFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\.innerHTML\s*=\s*(?:data|response|result)\.[A-Za-z_$]/.test(source)) findings.push(`${file}: unescaped API field assigned directly to innerHTML`);
}

if (findings.length) {
  console.error(`Injection/XSS sink audit failed:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Injection/XSS sink audit passed across ${files.length + browserFiles.length} retained server and browser application files.`);
