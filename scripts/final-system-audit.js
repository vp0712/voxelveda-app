const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const rel = (p) => p.split(path.sep).join('/');

function fail(message) { failures.push(message); }
function walk(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(next) : [rel(next)];
  });
}

const app = read('app.js');
const servedPages = new Set();

// 1) App-level route modules and live public pages must exist.
for (const match of app.matchAll(/require\(['"]\.\/(routes\/[^'"]+)['"]\)/g)) {
  const target = `${match[1]}.js`.replace(/\.js\.js$/, '.js');
  if (!exists(target)) fail(`Missing route module required by app.js: ${target}`);
}
for (const match of app.matchAll(/sendPage\(['"]([^'"]+)['"]\)/g)) {
  const target = `public/${match[1]}`;
  servedPages.add(target);
  if (!exists(target)) fail(`Missing page referenced by app.js: ${target}`);
}
servedPages.add('public/admin-dashboard.html');

// 2) Route -> controller contracts.
const routesDir = path.join(root, 'routes');
for (const filename of fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'))) {
  const routePath = `routes/${filename}`;
  const source = read(routePath);
  const controllers = new Map();
  for (const m of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]\.\.\/(controllers\/[^'"]+)['"]\)/g)) {
    let target = m[2];
    if (!target.endsWith('.js')) target += '.js';
    controllers.set(m[1], target);
    if (!exists(target)) fail(`${routePath} requires missing controller: ${target}`);
  }
  for (const [name, controllerPath] of controllers) {
    if (!exists(controllerPath)) continue;
    const controller = read(controllerPath);
    const methodPattern = new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const m of source.matchAll(methodPattern)) {
      const method = m[1];
      const exported = new RegExp(`exports\\.${method}\\s*=`).test(controller)
        || (new RegExp(`\\b${method}\\s*[,}]`).test(controller) && /module\.exports\s*=/.test(controller));
      if (!exported) fail(`${routePath} references missing ${controllerPath} export: ${method}`);
    }
  }
}

// 3) Local assets used by live server-delivered pages must exist.
const publicFiles = walk('public');
const staticAsset = /\.(?:css|js|png|jpe?g|webp|svg|ico|gif|woff2?|ttf)(?:[?#].*)?$/i;
for (const htmlPath of servedPages) {
  if (!exists(htmlPath)) continue;
  const source = read(htmlPath);
  for (const m of source.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const value = m[1].trim();
    if (!value.startsWith('/') || value.startsWith('//') || !staticAsset.test(value)) continue;
    const clean = value.split(/[?#]/)[0].replace(/^\/+/, '');
    if (!exists(`public/${clean}`)) fail(`${htmlPath} references missing local asset: /${clean}`);
  }
}

// 4) Global branding must protect all served HTML from broken logo URLs.
const firstPartyTextFiles = [
  ...publicFiles.filter((f) => /\.(?:html|js|css)$/i.test(f)),
  ...walk('services').filter((f) => f.endsWith('.js')),
  'app.js'
].filter((f, i, all) => all.indexOf(f) === i && exists(f));
for (const file of firstPartyTextFiles) {
  const source = read(file);
  if (source.includes('//logo.png')) fail(`${file} contains broken protocol-relative logo path //logo.png`);
}
if (!exists('public/logo.png')) fail('Canonical original logo public/logo.png is missing');
const brandRenderer = read('services/globalBrandRenderer.js');
for (const marker of ['CANONICAL_LOGO', 'voxel-veda-logo', 'Frame(?:%20| )1', 'injectGlobalBrand']) {
  if (!brandRenderer.includes(marker)) fail(`Global brand renderer missing canonicalization contract: ${marker}`);
}
if (!app.includes('injectGlobalBrand')) fail('app.js is not applying the global brand renderer to served pages');

// 5) Rendered admin assets must exist and be no-store/cache-safe.
const renderer = read('services/adminPageRenderer.js');
const recoveryAssets = [
  'recovery-assurance.css','recovery-assurance.js','recovery-drill.css','recovery-drill.js',
  'recovery-drill-ledger.css','recovery-drill-ledger.js','recovery-drill-governance.css','recovery-drill-governance.js',
  'recovery-remediation.css','recovery-remediation.js','recovery-executive.css','recovery-executive.js'
];
for (const asset of recoveryAssets) {
  if (!exists(`public/${asset}`)) fail(`Missing recovery admin asset: public/${asset}`);
  if (!renderer.includes(`/${asset}`)) fail(`Admin renderer does not load recovery asset: ${asset}`);
  if (!app.includes(`'${asset}'`)) fail(`app.js no-store asset set does not include: ${asset}`);
}

// 6) Static admin buttons and section targets must remain wired.
const html = read('public/admin-dashboard.html');
const jsFiles = fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.js'));
const js = jsFiles.map((f) => read(`public/${f}`)).join('\n');
const handlerNames = [...html.matchAll(/onclick\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
for (const name of new Set(handlerNames)) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [new RegExp(`function\\s+${escaped}\\s*\\(`), new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=`), new RegExp(`window\\.${escaped}\\s*=`)];
  if (!patterns.some((pattern) => pattern.test(js))) fail(`Admin onclick handler missing: ${name}`);
}
const sectionIds = new Set([...html.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]));
for (const match of html.matchAll(/data-section=["']([^"']+)["']/gi)) if (!sectionIds.has(match[1])) fail(`Admin data-section target missing: ${match[1]}`);

// 7) Recovery UI/backend contracts.
const readinessRoutes = read('routes/readinessRoutes.js');
const recoveryContracts = [
  ['public/recovery-drill.js', 'refreshRecoveryDrill', '/recovery/drill'],
  ['public/recovery-remediation.js', 'syncRecoveryRemediation', '/recovery/remediations/sync'],
  ['public/recovery-remediation.js', 'closeRecoveryRemediation', '/recovery/remediations/:id/close'],
  ['public/recovery-executive.js', 'refreshRecoveryExec', '/recovery/executive']
];
for (const [uiPath, buttonId, route] of recoveryContracts) {
  const ui = read(uiPath);
  if (!ui.includes(buttonId)) fail(`${uiPath} is missing expected button/listener id: ${buttonId}`);
  if (!readinessRoutes.includes(route)) fail(`readinessRoutes.js is missing expected recovery route: ${route}`);
}

// 8) No duplicate static admin IDs.
const ids = new Map();
for (const m of html.matchAll(/\bid=["']([^"']+)["']/gi)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
for (const [id, count] of ids) if (count > 1) fail(`Duplicate static admin element id: ${id} (${count})`);

// 9) Network reconnect handlers must not hard-reload the app.
for (const file of publicFiles.filter((f) => f.endsWith('.js'))) {
  const source = read(file);
  if (/addEventListener\s*\(\s*['"]online['"]/i.test(source) && /(?:window\.)?location\.reload\s*\(/i.test(source)) {
    fail(`${file} contains a hard reload in a network-online handler`);
  }
}

// 10) Statement-import reliability contracts.
const statementController = read('controllers/statementImportController.js');
const financeUi = read('public/finance-master.js');
const statementContracts = [
  [statementController, "existingSession.status === 'PENDING_REVIEW'", 'pending statement reviews must reopen'],
  [statementController, "session.status === 'IMPORTED'", 'statement commit must be idempotent'],
  [statementController, 'isBalanceMarker', 'balance markers must be identified'],
  [statementController, "validation_status IN ('VALID','WARNING')", 'commit must only import valid/warning rows'],
  [financeUi, "row.validation_status==='DUPLICATE'", 'duplicate rows must be locked in the canonical review UI'],
  [financeUi, 'data-review-override', 'rejected rows must require an explicit manual correction workflow'],
  [financeUi, 'balanceLocked', 'opening and closing balance markers must remain locked'],
  [financeUi, 'data-review-commit', 'statement review commit action must exist in the canonical Finance OS'],
  [financeUi, 'openStatementReview', 'statement review errors must remain inside the canonical Finance OS']
];
for (const [source, marker, message] of statementContracts) if (!source.includes(marker)) fail(`Statement import contract missing: ${message}`);

if (failures.length) {
  console.error(`FINAL_SYSTEM_AUDIT_FAILED (${failures.length})`);
  failures.forEach((item) => console.error(` - ${item}`));
  process.exit(1);
}
console.log(`FINAL_SYSTEM_AUDIT_OK routes=${fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).length} served_pages=${servedPages.size} public_files=${publicFiles.length} public_js=${jsFiles.length} recovery_assets=${recoveryAssets.length}`);
