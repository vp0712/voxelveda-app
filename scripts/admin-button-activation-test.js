const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'admin-dashboard.html');
const jsPaths = [
  path.join(__dirname, '..', 'public', 'admin-dashboard.js'),
  path.join(__dirname, '..', 'public', 'workflow-ui.js'),
  path.join(__dirname, '..', 'public', 'procurement-ui.js'),
  path.join(__dirname, '..', 'public', 'expense-payments.js'),
  path.join(__dirname, '..', 'public', 'step-up.js')
];

const html = fs.readFileSync(htmlPath, 'utf8');
const js = jsPaths.map((file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').join('\n');
const globalBrandJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'global-brand.js'), 'utf8');
const globalBrandCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'global-brand.css'), 'utf8');
const globalBrandRenderer = fs.readFileSync(path.join(__dirname, '..', 'services', 'globalBrandRenderer.js'), 'utf8');
const failures = [];

// Every inline click handler must point at a callable function shipped by the page.
const handlerNames = [...html.matchAll(/onclick\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
for (const name of new Set(handlerNames)) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`function\\s+${escaped}\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=`),
    new RegExp(`window\\.${escaped}\\s*=`)
  ];
  if (!patterns.some((pattern) => pattern.test(js))) failures.push(`onclick handler is missing: ${name}`);
}

// Sidebar/quick navigation must target real sections.
const sectionIds = new Set([...html.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]));
for (const match of html.matchAll(/data-section=["']([^"']+)["']/gi)) {
  if (!sectionIds.has(match[1])) failures.push(`data-section target is missing: ${match[1]}`);
}

// Duplicate IDs make getElementById-based button handlers unpredictable, especially on mobile Safari.
const idCounts = new Map();
for (const match of html.matchAll(/\bid=["']([^"']+)["']/gi)) idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
for (const [id, count] of idCounts) if (count > 1) failures.push(`duplicate element id: ${id} (${count})`);

// A visible button needs an activation mechanism unless it is intentionally disabled or a form submit.
for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
  const attrs = match[1];
  if (/\bdisabled\b/i.test(attrs)) continue;
  if (/\btype=["']submit["']/i.test(attrs)) continue;
  const hasInline = /\bonclick\s*=/i.test(attrs);
  const hasSection = /\bdata-section\s*=/i.test(attrs);
  const hasMobileAction = /\bdata-mobile-menu-action\s*=/i.test(attrs);
  const hasProcurementAction = /\bdata-procurement-(?:action|tab|refresh)\b/i.test(attrs)
    && /data-procurement-(?:action|tab|refresh)/.test(js);
  const id = (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1];
  const className = (attrs.match(/\bclass=["']([^"']+)["']/i) || [])[1] || '';
  const hasIdListener = id && (new RegExp(`getElementById\\(['\"]${id}['\"]\\)`).test(js) || new RegExp(`#${id}\\b`).test(js));
  const hasClassListener = className.split(/\s+/).filter(Boolean).some((cls) => new RegExp(`\\.${cls}\\b`).test(js));
  if (!(hasInline || hasSection || hasMobileAction || hasProcurementAction || hasIdListener || hasClassListener)) {
    failures.push(`button has no detectable activation path${id ? `: #${id}` : ''}: ${attrs.trim().slice(0, 120)}`);
  }
}

// The global brand layer must provide one consistent loader across all rendered pages and slow app work.
if (!globalBrandRenderer.includes('id="vvGlobalBrandLoader"')) failures.push('global brand renderer is not injecting the global loader');
if (!globalBrandRenderer.includes('vv-brand-orbit-ring-one')) failures.push('global loader orbital markup is missing');
if (!globalBrandRenderer.includes('20260918-global-loader')) failures.push('global loader asset version was not advanced');
if (!globalBrandJs.includes('window.fetch = function voxelVedaTrackedFetch')) failures.push('slow fetch requests are not connected to the global loader');
if (!globalBrandJs.includes('NativeXHR.prototype.send')) failures.push('XHR requests are not connected to the global loader');
if (!globalBrandJs.includes('API_DELAY_MS = 520')) failures.push('loader must keep a delay threshold to prevent flashing on fast requests');
if (!globalBrandJs.includes('Preparing your workspace…')) failures.push('initial workspace loading state is missing');
if (!globalBrandJs.includes('VoxelVedaBrandLoader')) failures.push('global loader API is missing');
if (!globalBrandCss.includes('--vv-brand-overlay-bg:#090e16')) failures.push('premium dark global loader background is missing');
if (!globalBrandCss.includes('vvBrandScan')) failures.push('global loader scan-line animation is missing');
if (!globalBrandCss.includes('vv-brand-loader-logo')) failures.push('canonical logo stage styling is missing');

if (failures.length) {
  console.error('Admin button activation audit failed:');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`Admin button activation audit passed. ${handlerNames.length} inline handler references validated.`);
