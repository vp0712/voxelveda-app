'use strict';
// Real retained portal assets and real cookie/JWT/CSP authentication. These
// invoice responses are synthetic fixtures; the separate MySQL fixture checks
// the production grouping/controller SQL against the actual database engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const fixtures = require('./staff-mobile-browser-test');
const { hasPermission } = require('../services/authorizationService');
const { customerScoped, customerEmail } = require('../services/customerRecordScope');
const engines = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const engine = process.env.VV_INVOICE_FOLDER_BROWSER_ENGINE || process.env.VV_INVOICE_FOLDER_ENGINE || 'chromium';
assert(['chromium', 'webkit'].includes(engine), 'Use a supported real browser engine.');
const root = path.resolve(__dirname, '..');
const out = process.env.UI_PROOF_DIR || '/tmp/voxelveda-invoice-folders-' + engine;
fs.mkdirSync(out, { recursive: true });
const accounts = [
  { id: 9881, name: 'Synthetic invoice administrator', username: 'synthetic.invoice.admin', email: 'invoice-admin@example.invalid', role: 'super_admin', mfa_enabled: 1, permissions: [] },
  { id: 9882, name: 'Synthetic permitted sales employee', username: 'synthetic.invoice.sales', email: 'invoice-sales@example.invalid', role: 'sales', mfa_enabled: 0, permissions: ['VIEW_FINANCE'] },
  { id: 9883, name: 'Synthetic own-scope client', username: 'synthetic.invoice.client', email: 'alpha@example.invalid', role: 'client', mfa_enabled: 0, permissions: ['VIEW_FINANCE'] },
  { id: 9884, name: 'Synthetic restricted staff', username: 'synthetic.invoice.denied', email: 'invoice-denied@example.invalid', role: 'integration_fixture', mfa_enabled: 0, permissions: [] }
];
for (const account of accounts) fixtures.identities.set(account.id, { ...account, active: 1, account_status: 'ACTIVE', session_version: 1 });
const key = label => crypto.createHash('sha256').update('synthetic-company-key:' + label).digest('hex');
const groups = [
  { key: key('alpha'), name: 'Acme Engineering Pty Ltd', email: 'alpha@example.invalid', count: 61, prefix: 'ACME' },
  { key: key('beta'), name: 'Acme Engineering Pty Ltd', email: 'separate-company@example.invalid', count: 4, prefix: 'SEPARATE' },
  { key: key('long'), name: 'Synthetic <img src=x onerror="window.__invoiceFolderXss=1"> manufacturing company with a very long registered name and reference', email: 'long-manufacturing-contact@example.invalid', count: 2, prefix: 'LONG' },
  { key: key('missing-email'), name: 'Synthetic company without a saved email', email: '', count: 3, prefix: 'MISSING', missing_email: true },
  ...Array.from({ length: 9 }, (_, i) => ({ key: key('other-' + i), name: 'Synthetic supplier company ' + i, email: 'company-' + i + '@example.invalid', count: 1, prefix: 'OTHER-' + i })),
  { key: key('unknown-1'), name: 'Unassigned invoice', email: '', count: 1, prefix: 'UNKNOWN-1', unassigned: true, missing_email: true },
  { key: key('unknown-2'), name: 'Unassigned invoice', email: '', count: 1, prefix: 'UNKNOWN-2', unassigned: true, missing_email: true },
  { key: key('alpha-alternate-label'), name: 'Synthetic Acme delivery division', email: 'alpha@example.invalid', count: 2, prefix: 'OWN-SECOND' }
];
let nextId = 62000;
const records = groups.flatMap(group => Array.from({ length: group.count }, (_, i) => ({
  id: nextId++, invoice_no: 'INV-' + group.prefix + '-' + String(i + 1).padStart(4, '0'),
  customer_name: group.unassigned ? '' : group.name, customer_email: group.email,
  total: 110, paid_amount: 0, recorded_payment_amount: 0, balance_due: 110,
  payment_state: 'unpaid', payment_review_required: false, status: i % 2 ? 'draft' : 'approved',
  deleted: 0, created_at: '2026-11-01T09:00:00.000Z', document_revision: 1, fixture_folder: group.key
})));
const invoiceRequests = [], invoiceWrites = [];
let folderFailure = false, hold = null;
const transportGates = new Map();
function transportGate(kind, user) {
  const id = kind + ':' + user;
  let enter, release;
  const gate = { entered: new Promise(resolve => { enter = resolve; }), wait: new Promise(resolve => { release = resolve; }), requests: 0,
    enter() { this.requests++; enter(); }, release() { transportGates.delete(id); release(); } };
  transportGates.set(id, gate);
  return gate;
}
async function waitForTransport(kind, user) {
  const gate = transportGates.get(kind + ':' + user);
  if (gate) { gate.enter(); await gate.wait; }
}
function session(id) {
  const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });
  fixtures.sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { id: 'invoice-folder-fixture-' + id, user_id: id, session_version: 1, assurance_level: 2 });
  return token;
}
function selected(user, query) {
  return records.filter(row => Boolean(Number(row.deleted)) === (query.archived === 'true'))
    .filter(row => !customerScoped(user) || customerEmail(user) && row.customer_email.toLowerCase() === customerEmail(user))
    .filter(row => !query.folder || row.fixture_folder === query.folder)
    .filter(row => !query.search || [row.invoice_no, row.customer_name, row.customer_email].some(value => value.toLowerCase().includes(String(query.search).toLowerCase())))
    .filter(row => !query.status || row.status === query.status)
    .filter(row => !query.payment_state || row.payment_state === query.payment_state)
    .filter(row => !query.from || row.created_at.slice(0, 10) >= query.from)
    .filter(row => !query.to || row.created_at.slice(0, 10) <= query.to);
}
function folderData(user, query) {
  const rows = selected(user, query), search = String(query.company_search || '').toLowerCase();
  const folders = groups.map(group => ({ ...group, invoice_count: rows.filter(row => row.fixture_folder === group.key).length }))
    .filter(group => group.invoice_count && (!search || [group.name, group.email].some(value => value.toLowerCase().includes(search))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  const page = Number(query.page || 1), limit = Number(query.limit || 6);
  return { folders: folders.slice((page - 1) * limit, page * limit).map(group => ({ ...group, currency: 'AUD', latest_invoice_at: '2026-11-01T09:00:00.000Z', total_value: group.invoice_count * 110, paid_value: 0, balance_value: group.invoice_count * 110 })),
    total: folders.length, invoice_total: folders.reduce((sum, group) => sum + group.invoice_count, 0), page, limit, pages: Math.ceil(folders.length / limit) };
}
async function makeServer() {
  return fixtures.makeServer(path.join(root, 'public'), fs.readFileSync(path.join(root, 'public/logo.png')), async (app, { auth, pageAuth, authController, brand }) => {
    app.get('/client', pageAuth(), (_req, res) => res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(root, 'public/client-portal.html'), 'utf8'))));
    app.get('/api/auth/me', auth, async (req, res) => { await waitForTransport('auth', req.user.id); return authController.me(req, res); });
    const finance = (req, res, next) => hasPermission(req.user, 'VIEW_FINANCE') ? next() : res.status(403).json({ message: 'Synthetic invoice access restricted.' });
    app.use('/api/invoice', (req, _res, next) => { if (!['GET', 'HEAD'].includes(req.method)) invoiceWrites.push({ path: req.path, method: req.method }); next(); });
    app.get('/api/invoice/folders', auth, finance, async (req, res) => {
      invoiceRequests.push({ path: '/folders', user: req.user.id, query: { ...req.query } });
      if (folderFailure) return res.status(503).json({ message: 'Synthetic company-folder service unavailable.' });
      if (req.query.folder && !/^[a-f0-9]{64}$/.test(req.query.folder)) return res.status(422).json({ message: 'Select a valid company folder.' });
      const body = folderData(req.user, req.query);
      if (hold && Number(req.user.id) === hold.user) { const captured = hold; hold = null; captured.enter(body); await captured.wait; captured.delivered = true; }
      return res.json(body);
    });
    app.get('/api/invoice', auth, finance, async (req, res) => {
      invoiceRequests.push({ path: '/', user: req.user.id, query: { ...req.query } });
      if (req.query.folder && !/^[a-f0-9]{64}$/.test(req.query.folder)) return res.status(422).json({ message: 'Select a valid company folder.' });
      const all = selected(req.user, req.query), page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
      await waitForTransport('invoice', req.user.id);
      res.json({ invoices: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit, pages: Math.ceil(all.length / limit), summary: { total_value: all.length * 110, paid_value: 0, balance_value: all.length * 110 } });
    });
  });
}
const surfaces = {
  admin: { id: 9881, route: '/admin?view=invoices', section: 'invoiceSection', host: '#invoiceCompanyFolders', rows: '#invoiceTableBody tr[data-invoice-id]', table: '#invoiceTableBody' },
  staff: { id: 9882, route: '/portal/staff?view=invoices', section: 'staffInvoiceSection', host: '#staffInvoiceCompanyFolders', rows: '#staffInvoiceTableBody tr', table: '#staffInvoiceTableBody' },
  client: { id: 9883, route: '/client', host: '#clientInvoiceCompanyFolders', rows: '#clientRecordList .client-record', table: '#clientRecordList' }
};
async function frameCheckpoint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function stableObservation(page, collect, args, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    // Poll only a synchronous browser predicate. An async predicate can be
    // accepted as a truthy Promise before its resolved false value is known.
    const handle = await page.waitForFunction(collect, args, { timeout: Math.max(1, deadline - Date.now()) });
    const before = await handle.jsonValue();
    await handle.dispose();
    if (!before) continue;
    // page.evaluate correctly awaits this paint barrier. Verify a second
    // atomic read under the same overall 30-second observation budget.
    await frameCheckpoint(page);
    const after = await page.evaluate(collect, args);
    if (after && JSON.stringify(before) === JSON.stringify(after)) return after;
  }
  throw new Error('Timed out observing a stable ' + description + '.');
}
function collectSurfaceReady({ id, name, email, section }) {
  const client = !section;
  const authoritative = client ? (typeof vvClientUser === 'object' ? vvClientUser : null) : (typeof currentUser === 'object' ? currentUser : null);
  const cached = JSON.parse(localStorage.getItem('user') || '{}');
  if (Number(authoritative?.id) !== id || Number(cached.id) !== id || authoritative.email !== email) return false;
  // These labels are initialized as Loading in each new document and are
  // written only after its controller consumes the fresh /auth/me result.
  // currentUser/localStorage alone can both contain the previous document.
  const identity = document.getElementById(client ? 'clientWelcome' : section === 'invoiceSection' ? 'adminInfo' : 'staffInfo')?.textContent || '';
  if (!identity.includes(name) || !client && !identity.includes(email)) return false;
  if (section) {
    const panel = document.getElementById(section), navigation = document.querySelector('.sidebar .nav-btn[data-section="' + section + '"]');
    if (!panel || !navigation || panel.classList.contains('hidden-section') || !panel.getClientRects().length ||
      navigation.classList.contains('hidden-section') || !navigation.classList.contains('active')) return false;
  }
  if (document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible')) return false;
  return { id: Number(authoritative.id), email: authoritative.email, identity, section: section || 'client' };
}
async function waitForSurfaceReady(page, surface) {
  const account = accounts.find(item => item.id === surface.id);
  return stableObservation(page, collectSurfaceReady,
    { id: surface.id, name: account.name, email: account.email, section: surface.section }, 'authenticated invoice page');
}
async function openSurface(browser, fixture, type) {
  const surface = surfaces[type], context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'vv_session', value: session(surface.id), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.origin + surface.route);
  // The supported requested-view URL lets the actual authenticated boot choose
  // its page. Cached localStorage identity is published before queued initial
  // navigation; calling goSection at that point races those real boot timers.
  // Observe the fresh controller identity and permitted selected page instead
  // of forcing a hidden section or replacing the boot lifecycle.
  await waitForSurfaceReady(page, surface);
  const host = page.locator(surface.host);
  await host.locator('[data-invoice-folder]').first().waitFor({ state: 'visible' });
  return { context, page, host, surface, errors };
}
function collectCommittedRows({ rows, table, host, section, id, expected, folder, reference }) {
  const element = document.querySelector(table), panel = section ? document.getElementById(section) : element;
  const folderHost = document.querySelector(host);
  if (!element || !panel?.getClientRects().length || !element.getClientRects().length || panel.classList.contains('hidden-section') ||
    folderHost?.getAttribute('aria-busy') === 'true') return false;
  const selection = id === 9881 ? (typeof registerFilters === 'object' ? registerFilters.invoices?.folder : '') : new URLSearchParams(location.search).get('invoice_folder');
  if (selection !== folder) return false;
  const text = element.innerText;
  const rowTexts = [...document.querySelectorAll(rows)].map(node => node.textContent);
  if (rowTexts.length !== expected || !text.includes(reference) || /Loading (?:invoices|authorised records)/i.test(text) ||
    /INV-(?:SEPARATE|LONG|MISSING|OTHER|UNKNOWN|OWN-SECOND)-/.test(text)) return false;
  const sequence = id === 9881 ? (typeof invoiceLoadSequence === 'number' ? invoiceLoadSequence : null)
    : id === 9882 ? (typeof staffInvoiceLoadSequence === 'number' ? staffInvoiceLoadSequence : null)
    : (typeof clientRecordEpoch === 'number' ? clientRecordEpoch : null);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return false;
  return { text, rowTexts, sequence, folder: selection, count: rowTexts.length,
    title: folderHost?.querySelector('[data-invoice-folder-title]')?.textContent || '',
    gridVisible: Boolean(folderHost?.querySelector('.vv-invoice-folder-grid')?.getClientRects().length) };
}
async function committedRows(page, surface, expected = surface.id === 9883 ? 20 : 25, reference = 'INV-ACME-') {
  const snapshot = await stableObservation(page, collectCommittedRows,
    { rows: surface.rows, table: surface.table, host: surface.host, section: surface.section, id: surface.id, expected, folder: groups[0].key, reference }, 'committed invoice selection');
  // Assert one immutable browser snapshot. A later legitimate refresh must not
  // turn a validated record read into a separate RPC reading its Loading row.
  assert.equal(snapshot.count, expected);
  assert.equal(snapshot.folder, groups[0].key);
  assert.match(snapshot.text, /INV-ACME-/);
  assert(snapshot.text.includes(reference));
  assert(!/Loading (?:invoices|authorised records)/i.test(snapshot.text));
  assert(!/INV-(?:SEPARATE|LONG|MISSING|OTHER|UNKNOWN|OWN-SECOND)-/.test(snapshot.text), 'A company folder contains only its exact authorised invoice selection.');
  return snapshot;
}
async function selectedRows(page, surface) {
  return committedRows(page, surface);
}
async function selectAlpha(state) {
  const { page, host } = state;
  const search = host.locator('[data-invoice-folder-search]');
  await search.fill('alpha@example.invalid');
  await host.locator('form button[type=submit]').click();
  await host.locator('[data-invoice-folder="' + groups[0].key + '"]').waitFor();
  await Promise.all([
    page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoice' && url.searchParams.get('folder') === groups[0].key && response.status() === 200; }),
    host.locator('[data-invoice-folder="' + groups[0].key + '"]').click()
  ]);
  const snapshot = await selectedRows(page, state.surface);
  assert.match(snapshot.title, /Acme Engineering/i);
  assert.equal(snapshot.gridVisible, false, 'Selected folders show a compact breadcrumb, without a duplicate company grid.');
  return snapshot;
}
async function clearFolder(state) {
  await state.host.locator('[data-invoice-folder-all]').click();
  await state.host.locator('[data-invoice-folder-search]').waitFor({ state: 'visible' });
  await state.host.locator('[data-invoice-folder]').first().waitFor();
}
async function searchInvoices(state, type, search) {
  const input = state.page.locator(type === 'admin' ? '[data-register-search="invoices"]' : type === 'staff' ? '#staffInvoiceSearch' : 'input[aria-label="Search Invoice records"]');
  const response = state.page.waitForResponse(item => {
    const url = new URL(item.url());
    return url.pathname === '/api/invoice' && url.searchParams.get('folder') === groups[0].key && (url.searchParams.get('search') || '') === search && item.status() === 200;
  });
  await input.fill(search);
  if (type === 'client') await input.locator('..').locator('button[type=submit]').click();
  await response;
}
function colorChannels(value) {
  const channels = String(value).match(/[\d.]+/g)?.map(Number);
  assert(channels?.length >= 3 && channels.every(Number.isFinite), 'A real computed RGB colour is required: ' + value);
  assert(channels.length < 4 || channels[3] === 1, 'The tested icon, surface and boundary must be opaque: ' + value);
  return channels.slice(0, 3);
}
function graphicalContrast(foreground, background) {
  const luminance = value => colorChannels(value).map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
async function verifyFolderSearchContrast(state, type, width, theme) {
  const button = state.host.locator('.vv-invoice-folder-search > button[type="submit"]'), observations = [];
  await state.page.mouse.move(0, 0);
  await button.evaluate(node => node.blur());
  for (const mode of ['normal', 'keyboard-focus']) {
    if (mode === 'keyboard-focus') { await state.page.keyboard.press('Tab'); await button.focus(); }
    const observed = await button.evaluate(node => {
      const style = getComputedStyle(node), glyph = getComputedStyle(node, '::before');
      let parentSurface = null;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const value = getComputedStyle(parent).backgroundColor, channels = value.match(/[\d.]+/g)?.map(Number);
        if (channels?.length === 3 || channels?.length === 4 && channels[3] === 1) { parentSurface = value; break; }
      }
      return { foreground: style.color, background: style.backgroundColor, border: style.borderTopColor,
        borderStyle: style.borderTopStyle, borderWidth: parseFloat(style.borderTopWidth),
        glyph: { color: glyph.backgroundColor, mask: glyph.maskImage, webkitMask: glyph.webkitMaskImage,
          opacity: Number(glyph.opacity), width: parseFloat(glyph.width), height: parseFloat(glyph.height) },
        focusVisible: node.matches(':focus-visible'), outline: style.outlineColor,
        outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), parentSurface };
    });
    const label = `${type} ${width}px ${theme} ${mode}: `;
    assert([observed.glyph.mask, observed.glyph.webkitMask].some(value => value && value !== 'none') &&
      observed.glyph.opacity === 1 && observed.glyph.width >= 16 && observed.glyph.height >= 16,
    label + 'the search control must render its actual visible graphical icon.');
    const iconRatio = graphicalContrast(observed.glyph.color, observed.background);
    const foregroundRatio = graphicalContrast(observed.foreground, observed.background);
    const borderRatio = graphicalContrast(observed.border, observed.background);
    assert(iconRatio >= 3 && foregroundRatio >= 3, label + 'search icon contrast must be at least 3:1: ' + JSON.stringify(observed));
    assert(observed.borderStyle !== 'none' && observed.borderWidth >= 1 && borderRatio >= 3,
      label + 'search boundary contrast must be at least 3:1: ' + JSON.stringify(observed));
    let outlineRatio = null;
    if (mode === 'keyboard-focus') {
      outlineRatio = graphicalContrast(observed.outline, observed.parentSurface);
      assert(observed.focusVisible && observed.outlineStyle !== 'none' && observed.outlineWidth >= 2 && outlineRatio >= 3,
        label + 'keyboard focus must have a visible contrasting outline: ' + JSON.stringify(observed));
    }
    observations.push({ mode, icon_ratio: iconRatio, foreground_ratio: foregroundRatio,
      border_ratio: borderRatio, outline_ratio: outlineRatio, computed: observed });
  }
  await button.evaluate(node => node.blur());
  return observations;
}
async function responsive(state, type, proof) {
  const widths = type === 'admin' ? [320, 360, 390, 430, 768, 1024, 1440] : [320, 390, 768, 1440];
  for (const width of widths) for (const theme of ['light', 'dark']) {
    await state.page.setViewportSize({ width, height: 844 });
    await state.page.evaluate(value => window.VoxelTheme?.set(value), theme);
    await state.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert(await state.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), type + ' ' + width + ' ' + theme + ': no horizontal page overflow');
    const controls = await state.host.locator('button:visible').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height, name: node.getAttribute('aria-label') || node.textContent.trim(), disabled: node.disabled }; }));
    for (const control of controls) {
      assert(control.name, 'Every folder icon/button retains an accessible name.');
      assert(control.width >= 44 && control.height >= 44,
        `${type} ${width}px ${theme}: ${JSON.stringify(control)} must retain a 44px touch target.`);
    }
    const searchContrast = await verifyFolderSearchContrast(state, type, width, theme);
    proof.layouts.push({ portal: type, width, theme, no_page_overflow: true, accessible_controls: controls.length,
      search_control_contrast: searchContrast });
    if ([390, 1440].includes(width)) {
      await state.host.scrollIntoViewIfNeeded();
      await state.page.waitForFunction(() => !document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible'));
      await state.page.screenshot({ path: path.join(out, type + '-folders-' + width + '-' + theme + '.png'), fullPage: true });
    }
  }
  await state.page.setViewportSize({ width: 844, height: 390 });
  assert(await state.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  proof.layouts.push({ portal: type, width: 844, height: 390, landscape: true, no_page_overflow: true });
}
async function reloadWithDelayedBootstrap(state, type, proof) {
  const { page, surface } = state;
  const authentication = transportGate('auth', surface.id), invoices = transportGate('invoice', surface.id);
  let readyResolved = false, rowsResolved = false;
  try {
    await page.reload();
    await authentication.entered;
    const staleReadiness = await page.evaluate(({ id, section }) => {
      const cached = JSON.parse(localStorage.getItem('user') || '{}');
      const label = document.getElementById(!section ? 'clientWelcome' : section === 'invoiceSection' ? 'adminInfo' : 'staffInfo')?.textContent || '';
      return { cachedIdentity: Number(cached.id) === id, freshLabelLoading: /Loading/i.test(label) };
    }, { id: surface.id, section: surface.section });
    assert.equal(staleReadiness.cachedIdentity, true, 'Reload deliberately retains the valid previous-document account cache.');
    assert.equal(staleReadiness.freshLabelLoading, true, 'The fresh controller identity remains pending while its real HTTP response is held.');
    const ready = waitForSurfaceReady(page, surface).then(() => { readyResolved = true; });
    await frameCheckpoint(page);
    assert.equal(readyResolved, false, 'Cached identity alone must not satisfy authenticated reload readiness.');
    authentication.release();
    await invoices.entered;
    const committed = selectedRows(page, surface).then(value => { rowsResolved = true; return value; });
    await frameCheckpoint(page);
    assert.equal(rowsResolved, false, 'A held invoice HTTP response cannot pass the committed-record snapshot check.');
    assert.match(await page.locator(surface.table).innerText(), /Loading (?:invoices|authorised records)/i,
      'The adversarial fixture genuinely exposes the application loading state, rather than replacing its DOM.');
    invoices.release();
    await ready;
    const snapshot = await committed;
    assert.match(snapshot.title, /Acme Engineering/i);
    assert(new URL(page.url()).search.includes('folder'), 'Folder state survives reload using the established navigation URL.');
    proof.checks.push(type + ': delayed authenticated bootstrap rejects the retained cached-user readiness; delayed invoice transport rejects Loading rows; a stable committed snapshot preserves the selected company after real reload.');
    return snapshot;
  } finally { authentication.release(); invoices.release(); }
}
async function verifyPortal(browser, fixture, type, proof) {
  const state = await openSurface(browser, fixture, type);
  try {
    const { page, host, surface } = state;
    assert.equal(await host.locator('[data-invoice-folders]').count(), 0, 'One shared host contains the folder view; no nested competing folder panel.');
    await responsive(state, type, proof);
    await page.setViewportSize({ width: 390, height: 844 });
    if (type === 'admin') {
      assert.equal(await host.locator('[data-invoice-folder-next]').isEnabled(), true, 'All companies are reachable through server folder pagination.');
      const before = await host.locator('[data-invoice-folder]').evaluateAll(nodes => nodes.map(node => node.dataset.invoiceFolder));
      await host.locator('[data-invoice-folder-next]').click();
      await page.waitForFunction(({ selector, prior }) => { const keys = [...document.querySelector(selector).querySelectorAll('[data-invoice-folder]')].map(node => node.dataset.invoiceFolder); return keys.length && JSON.stringify(keys) !== JSON.stringify(prior); }, { selector: surface.host, prior: before });
      proof.checks.push('Company folder paging reaches companies outside the first server page.');
    }
    await selectAlpha(state);
    await clearFolder(state);
    await Promise.all([
      page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoice' && url.searchParams.get('folder') === groups[0].key && response.status() === 200; }),
      page.goBack({ waitUntil: 'domcontentloaded' })
    ]);
    const restored = await selectedRows(page, surface);
    assert.match(restored.title, /Acme Engineering/i);
    await Promise.all([
      page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoice' && !url.searchParams.has('folder') && response.status() === 200; }),
      page.goForward({ waitUntil: 'domcontentloaded' })
    ]);
    await state.host.locator('[data-invoice-folder-search]').waitFor({ state: 'visible' });
    const selected = await selectAlpha(state);
    proof.checks.push(type + ': browser Back restores the exact company and Forward restores All invoices through fresh authorised API reads.');
    const firstPage = selected.rowTexts;
    if (type === 'staff') {
      assert.match(await page.locator('#staffInvoicePageInfo').innerText(), /61/);
      await page.locator('#staffInvoiceNext').click();
    } else if (type === 'client') await page.locator('#clientRecordList section').last().getByRole('button', { name: 'Next', exact: true }).click();
    else {
      await page.locator('[data-register-next="invoices"]').click();
    }
    await page.waitForFunction(({ selector, first }) => JSON.stringify([...document.querySelectorAll(selector)].map(node => node.textContent)) !== JSON.stringify(first), { selector: surface.rows, first: firstPage });
    const nextPage = await selectedRows(page, surface);
    assert.notDeepEqual(nextPage.rowTexts, firstPage, 'Invoice paging advances within the exact folder.');
    proof.checks.push(type + ': company selection counts all 61 records, confines every row, and paginates beyond the first invoice page.');
    await searchInvoices(state, type, 'INV-ACME-0001');
    const searched = await committedRows(page, surface, 1, 'INV-ACME-0001');
    assert.match(searched.text, /INV-ACME-0001/);
    assert.equal(searched.count, 1, 'Existing invoice search intersects the selected folder instead of resetting it.');
    await searchInvoices(state, type, '');
    await selectedRows(page, surface);
    proof.checks.push(type + ': existing invoice search composes with the selected company; clearing search retains its exact folder and full count.');
    await reloadWithDelayedBootstrap(state, type, proof);
    proof.checks.push(type + ': selected company persists after a real page refresh.');
    state.host = page.locator(surface.host);
    await clearFolder(state);
    await state.host.locator('[data-invoice-folder-search]').fill('no matching synthetic company');
    await state.host.locator('form button[type=submit]').click();
    await page.waitForFunction(selector => document.querySelector(selector).textContent.includes('No'), surface.host);
    assert.equal(await state.host.locator('[data-invoice-folder]').count(), 0);
    assert.equal(await state.host.locator('[role=alert]').count(), 0, 'A successful empty company search is not a transport error.');
    proof.checks.push(type + ': genuine empty company search has no stale records or error state.');
    assert.equal(await page.evaluate(() => Boolean(window.__invoiceFolderXss)), false, 'Stored company markup is text, never executable HTML.');
    assert.deepEqual(state.errors, [], type + ': no page JavaScript errors.');
    proof.portals.push({ portal: type, fixture_identity: surface.id, grouping: true, selection: true, complete_invoice_paging: true, refresh: true, read_only: true });
  } finally { await state.context.close(); }
}
async function verifyRecovery(browser, fixture, proof) {
  const state = await openSurface(browser, fixture, 'admin');
  try {
    folderFailure = true;
    await state.host.locator('[data-invoice-folder-refresh]').click();
    await state.host.locator('[data-invoice-folder-retry]').waitFor();
    assert.match(await state.host.innerText(), /unavailable|could not|failed/i);
    assert(!/No company|No folders|No matching/.test(await state.host.innerText()), 'Failure is never represented as a successful empty folder list.');
    folderFailure = false;
    await state.host.locator('[data-invoice-folder-retry]').click();
    await state.host.locator('[data-invoice-folder]').first().waitFor();
    proof.checks.push('Folder outage retains a foreground actionable error; Retry restores current records without a false-empty state.');
    await state.host.locator('[data-invoice-folder-search]').fill(groups[2].email);
    await state.host.locator('form button[type=submit]').click();
    await state.host.locator('[data-invoice-folder="' + groups[2].key + '"]').click();
    await state.page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.textContent === value,
      { selector: '#invoiceCompanyFolders [data-invoice-folder-title]', value: groups[2].name });
    assert.equal(await state.page.evaluate(() => Boolean(window.__invoiceFolderXss)), false);
    let entered, release;
    const gate = { user: 9881, entered: new Promise(resolve => { entered = resolve; }), enter: value => entered(value), wait: new Promise(resolve => { release = resolve; }), delivered: false };
    hold = gate;
    const delayedResponse = state.page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoice/folders' && new URL(response.url()).searchParams.get('folder') === groups[2].key);
    await state.host.locator('[data-invoice-folder-refresh]').click();
    await gate.entered;
    const client = fixtures.identities.get(9883);
    await state.context.addCookies([{ name: 'vv_session', value: session(client.id), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    await state.page.evaluate(user => { const previous = localStorage.getItem('user'); localStorage.setItem('user', JSON.stringify(user)); window.dispatchEvent(new StorageEvent('storage', { key: 'user', oldValue: previous, newValue: JSON.stringify(user), storageArea: localStorage })); }, client);
    release();
    await (await delayedResponse).finished();
    await state.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await state.page.locator('[data-invoice-folder]').count(), 0, 'An account switch clears company cards before a delayed old-owner response can reappear.');
    assert(!(await state.host.textContent()).includes(groups[2].name), 'The selected previous-owner company identity is cleared as well as its cards.');
    await state.page.goto(fixture.origin + '/client');
    await state.page.locator('#clientInvoiceCompanyFolders [data-invoice-folder]').first().waitFor();
    assert(!/separate-company@example.invalid|long-manufacturing-contact@example.invalid|company-0@example.invalid/.test(await state.page.locator('#clientInvoiceCompanyFolders').innerText()));
    proof.checks.push('Account switching discards delayed previous-owner folders and reloads only the new authenticated client scope.');
  } finally { folderFailure = false; if (hold) hold = null; await state.context.close(); }
}
(async () => {
  const fixture = await makeServer(), browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH || process.env.VV_CHROMIUM_EXECUTABLE || process.env.VV_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox'] } : {}) });
  const proof = { fixture_only: true, production_record_changed: false, real_email_sent: false, physical_device: false, engine, portals: [], layouts: [], checks: [] };
  try {
    for (const type of ['admin', 'staff', 'client']) await verifyPortal(browser, fixture, type, proof);
    await verifyRecovery(browser, fixture, proof);
    const own = await browser.newContext();
    await own.addCookies([{ name: 'vv_session', value: session(9883), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    const folders = await (await own.request.get(fixture.origin + '/api/invoice/folders')).json();
    assert.equal(folders.total, 2); assert.equal(folders.invoice_total, 63);
    assert(folders.folders.every(folder => folder.email === 'alpha@example.invalid'));
    assert.equal((await (await own.request.get(fixture.origin + '/api/invoice?folder=' + groups[1].key)).json()).total, 0, 'A known foreign folder key cannot bypass client ownership.');
    await own.close();
    const denied = await browser.newContext();
    await denied.addCookies([{ name: 'vv_session', value: session(9884), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    assert.equal((await denied.request.get(fixture.origin + '/api/invoice/folders')).status(), 403);
    await denied.close();
    assert(invoiceRequests.some(request => request.path === '/' && request.query.folder && Number(request.query.page) === 2));
    assert.deepEqual(invoiceWrites, [], 'Folder browsing/search/paging/retry never mutates invoices, attachments or customer identities.');
    proof.checks.push('Actual cookie-authenticated APIs keep own-client folder metadata and contents isolated; VIEW_FINANCE denial is enforced. No invoice writes.');
    proof.result = 'passed';
    fs.writeFileSync(path.join(out, 'invoice-folders-browser.json'), JSON.stringify(proof, null, 2));
    console.log('Invoice company-folder browser proof passed (' + engine + '): ' + out);
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, engine, invoice_requests: invoiceRequests.slice(-20), completed: proof }, null, 2));
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => { fixture.server.close(resolve); fixture.server.closeAllConnections?.(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
