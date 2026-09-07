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

for (const file of ['public/admin-dashboard.js', 'public/staff.js']) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\.innerHTML\s*=\s*(?:data|response|result)\.[A-Za-z_$]/.test(source)) findings.push(`${file}: unescaped API field assigned directly to innerHTML`);
  for (const entity of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    if (!source.includes(entity)) findings.push(`${file}: escapeHtml is missing ${entity}`);
  }
}

if (findings.length) {
  console.error(`Injection/XSS sink audit failed:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Injection/XSS sink audit passed across ${files.length + 2} application files.`);
