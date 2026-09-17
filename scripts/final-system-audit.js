const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

function fail(message) { failures.push(message); }

// 1) App-level route modules and public pages must exist.
const app = read('app.js');
for (const match of app.matchAll(/require\(['"]\.\/(routes\/[^'"]+)['"]\)/g)) {
  const target = `${match[1]}.js`.replace(/\.js\.js$/, '.js');
  if (!exists(target)) fail(`Missing route module required by app.js: ${target}`);
}
for (const match of app.matchAll(/sendPage\(['"]([^'"]+)['"]\)/g)) {
  const target = `public/${match[1]}`;
  if (!exists(target)) fail(`Missing page referenced by app.js: ${target}`);
}

// 2) Route -> controller contracts. Catch buttons/API calls landing on routes whose handlers do not exist.
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
        || new RegExp(`\\b${method}\\s*[,}]`).test(controller) && /module\.exports\s*=/.test(controller);
      if (!exported) fail(`${routePath} references missing ${controllerPath} export: ${method}`);
    }
  }
}

// 3) Rendered admin assets must exist and be cache-busted/no-store.
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

// 4) Existing static admin dashboard buttons and section targets must remain wired.
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

// 5) Recovery module buttons/endpoints must have both UI listeners and protected backend routes.
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
  const routeStem = route.replace('/:id', '/:id');
  if (!readinessRoutes.includes(routeStem)) fail(`readinessRoutes.js is missing expected recovery route: ${route}`);
}

// 6) No duplicate static admin IDs.
const ids = new Map();
for (const m of html.matchAll(/\bid=["']([^"']+)["']/gi)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
for (const [id, count] of ids) if (count > 1) fail(`Duplicate static admin element id: ${id} (${count})`);

if (failures.length) {
  console.error(`FINAL_SYSTEM_AUDIT_FAILED (${failures.length})`);
  failures.forEach((item) => console.error(` - ${item}`));
  process.exit(1);
}
console.log(`FINAL_SYSTEM_AUDIT_OK routes=${fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).length} public_js=${jsFiles.length} recovery_assets=${recoveryAssets.length}`);
