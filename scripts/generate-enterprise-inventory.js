const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const excludedDirectories = new Set(['.git', 'node_modules', 'invoices', 'uploads']);
const textExtensions = new Set([
  '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.sql', '.md', '.yml', '.yaml',
  '.xml', '.plist', '.gradle', '.properties', '.swift', '.kt', '.java', '.toml', '.txt'
]);
const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.woff', '.woff2', '.ttf']);

function relative(filename) {
  return path.relative(root, filename).replace(/\\/g, '/');
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename, files);
    else files.push(filename);
  }
  return files;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function category(filename) {
  if (filename.startsWith('controllers/')) return 'controllers';
  if (filename.startsWith('routes/')) return 'routes';
  if (filename.startsWith('services/')) return 'services';
  if (filename.startsWith('middleware/')) return 'middleware';
  if (filename.startsWith('migrations/')) return 'migrations';
  if (filename.startsWith('public/')) return 'frontend';
  if (filename.startsWith('scripts/')) return 'scripts';
  if (filename.startsWith('config/')) return 'config';
  if (filename.startsWith('ios/')) return 'ios';
  if (filename.startsWith('android/')) return 'android';
  if (filename.startsWith('.github/workflows/')) return 'ci';
  if (filename.startsWith('docs/')) return 'documentation';
  return 'root_or_other';
}

function finding(kind, severity, filename, line, evidence) {
  return { kind, severity, file: filename, line, evidence: String(evidence).trim().slice(0, 220) };
}

const allFiles = walk(root);
const sources = [];
const binaries = [];
const findings = [];
const routes = [];
const workers = [];
for (const absolute of allFiles) {
  const filename = relative(absolute);
  if (filename === 'docs/ENTERPRISE_ARCHITECTURE_INVENTORY.json') continue;
  const extension = path.extname(filename).toLowerCase();
  const stats = fs.statSync(absolute);
  if (binaryExtensions.has(extension)) {
    binaries.push({ file: filename, bytes: stats.size, category: category(filename) });
    continue;
  }
  if (!textExtensions.has(extension) && path.basename(filename) !== '.env.example') continue;
  const content = fs.readFileSync(absolute, 'utf8');
  const lines = content.split(/\r?\n/);
  sources.push({ file: filename, category: category(filename), bytes: stats.size, lines: lines.length, sha256: sha256(content) });

  lines.forEach((line, index) => {
    const routeExpression = /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)/g;
    for (const match of line.matchAll(routeExpression)) routes.push({ file: filename, line: index + 1, method: match[1].toUpperCase(), path: match[2] });
    if (/\b(?:setInterval|setTimeout)\s*\(/.test(line) && /(?:worker|scheduler|queue|purge|sla|timesheet)/i.test(content)) workers.push({ file: filename, line: index + 1, evidence: line.trim().slice(0, 180) });
    if (/\b(?:TODO|FIXME|HACK)\b/i.test(line) && !['documentation', 'scripts'].includes(category(filename))) findings.push(finding('todo_fixme', 'LOW', filename, index + 1, line));
    if ((/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(line) || /catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) && !['documentation', 'scripts'].includes(category(filename))) findings.push(finding('swallowed_error', 'MEDIUM', filename, index + 1, line));
    if (/\bDELETE\s+FROM\b/i.test(line) && ['controllers', 'services'].includes(category(filename))) findings.push(finding('direct_destructive_delete', 'HIGH', filename, index + 1, line));
    if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|PROCEDURE)\b/i.test(line) && ['controllers', 'routes', 'middleware'].includes(category(filename))) findings.push(finding('request_path_ddl', 'HIGH', filename, index + 1, line));
  });
}

const categoryCounts = sources.reduce((result, file) => {
  result[file.category] = (result[file.category] || 0) + 1;
  return result;
}, {});
const securityControls = {
  authentication: sources.filter((file) => /(?:auth|session|mfa|password)/i.test(file.file)).map((file) => file.file),
  authorization: sources.filter((file) => /(?:permission|authorization|stepUp)/i.test(file.file)).map((file) => file.file),
  audit: sources.filter((file) => /audit/i.test(file.file)).map((file) => file.file),
  document_security: sources.filter((file) => /(?:documentSecurity|malware|upload)/i.test(file.file)).map((file) => file.file),
  readiness: sources.filter((file) => /(?:readiness|runtimeState|databaseRuntime|migrationRunner)/i.test(file.file)).map((file) => file.file)
};

const inventory = {
  schema_version: 1,
  baseline_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: ['/', 'config/', 'controllers/', 'middleware/', 'migrations/', 'public/', 'routes/', 'scripts/', 'services/', 'utils/', 'ios/', 'android/', '.github/workflows/'],
  totals: {
    text_source_files: sources.length,
    binary_assets: binaries.length,
    text_bytes: sources.reduce((sum, file) => sum + file.bytes, 0),
    text_lines: sources.reduce((sum, file) => sum + file.lines, 0),
    routes: routes.length,
    migrations: sources.filter((file) => file.category === 'migrations').length,
    worker_timer_sites: workers.length,
    findings: findings.length
  },
  category_counts: Object.fromEntries(Object.entries(categoryCounts).sort(([a], [b]) => a.localeCompare(b))),
  routes,
  workers,
  security_controls: securityControls,
  static_findings: findings,
  source_files: sources,
  binary_assets: binaries.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file)),
  heuristics: {
    request_path_ddl: 'DDL text located directly in controllers, routes or middleware only; service-owned runtime guards are documented separately in the audit.',
    direct_destructive_delete: 'DELETE FROM statements outside migration files; each requires domain retention review.',
    swallowed_error: 'Empty promise or catch handlers found by a narrow source expression; broader error-flow review is documented separately.'
  }
};

const output = path.join(root, 'docs', 'ENTERPRISE_ARCHITECTURE_INVENTORY.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify(inventory.totals));
