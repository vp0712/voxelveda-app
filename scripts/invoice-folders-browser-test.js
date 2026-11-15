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
  return fixtures.makeServer(path.join(root, 'public'), fs.readFileSync(path.join(root, 'public/logo.png')), async (app, { auth, pageAuth, brand }) => {
    app.get('/client', pageAuth(), (_req, res) => res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(root, 'public/client-portal.html'), 'utf8'))));
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
    app.get('/api/invoice', auth, finance, (req, res) => {
      invoiceRequests.push({ path: '/', user: req.user.id, query: { ...req.query } });
      if (req.query.folder && !/^[a-f0-9]{64}$/.test(req.query.folder)) return res.status(422).json({ message: 'Select a valid company folder.' });
      const all = selected(req.user, req.query), page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
      res.json({ invoices: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit, pages: Math.ceil(all.length / limit), summary: { total_value: all.length * 110, paid_value: 0, balance_value: all.length * 110 } });
    });
  });
}
const surfaces = {
  admin: { id: 9881, route: '/admin', section: 'invoiceSection', host: '#invoiceCompanyFolders', rows: '#invoiceTableBody tr[data-invoice-id]', table: '#invoiceTableBody' },
  staff: { id: 9882, route: '/portal/staff', section: 'staffInvoiceSection', host: '#staffInvoiceCompanyFolders', rows: '#staffInvoiceTableBody tr', table: '#staffInvoiceTableBody' },
  client: { id: 9883, route: '/client', host: '#clientInvoiceCompanyFolders', rows: '#clientRecordList .client-record', table: '#clientRecordList' }
};
async function openSurface(browser, fixture, type) {
  const surface = surfaces[type], context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'vv_session', value: session(surface.id), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.origin + surface.route);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('user') || '{}').id > 0);
  if (surface.section) await page.evaluate(section => (window.goSection || window.goStaffSection)(section), surface.section);
  const host = page.locator(surface.host);
  await host.locator('[data-invoice-folder]').first().waitFor();
  return { context, page, host, surface, errors };
}
async function waitRows(page, surface, count) {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector: surface.rows, expected: count });
}
async function selectedRows(page, surface) {
  await page.waitForFunction(({ rows, table, expected }) => {
    const value = document.querySelector(table)?.textContent || '';
    return document.querySelectorAll(rows).length === expected && /INV-ACME-/.test(value) &&
      !/INV-(?:SEPARATE|LONG|MISSING|OTHER|UNKNOWN|OWN-SECOND)-/.test(value);
  }, { rows: surface.rows, table: surface.table, expected: surface.id === 9883 ? 20 : 25 });
  const text = await page.locator(surface.table).innerText();
  assert.match(text, /INV-ACME-/);
  assert(!/INV-(?:SEPARATE|LONG|MISSING|OTHER|UNKNOWN|OWN-SECOND)-/.test(text), 'A company folder contains only its exact authorised invoice selection.');
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
  await selectedRows(page, state.surface);
  assert.match(await host.locator('[data-invoice-folder-title]').innerText(), /Acme Engineering/i);
  assert.equal(await host.locator('.vv-invoice-folder-grid:visible').count(), 0, 'Selected folders show a compact breadcrumb, without a duplicate company grid.');
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
    proof.layouts.push({ portal: type, width, theme, no_page_overflow: true, accessible_controls: controls.length });
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
    await selectedRows(page, surface);
    assert.match(await state.host.locator('[data-invoice-folder-title]').innerText(), /Acme Engineering/i);
    await Promise.all([
      page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoice' && !url.searchParams.has('folder') && response.status() === 200; }),
      page.goForward({ waitUntil: 'domcontentloaded' })
    ]);
    await state.host.locator('[data-invoice-folder-search]').waitFor({ state: 'visible' });
    await selectAlpha(state);
    proof.checks.push(type + ': browser Back restores the exact company and Forward restores All invoices through fresh authorised API reads.');
    const firstPage = await page.locator(surface.rows).allTextContents();
    if (type === 'staff') {
      assert.match(await page.locator('#staffInvoicePageInfo').innerText(), /61/);
      await page.locator('#staffInvoiceNext').click();
    } else if (type === 'client') await page.locator('#clientRecordList section').last().getByRole('button', { name: 'Next', exact: true }).click();
    else {
      await page.locator('[data-register-next="invoices"]').click();
    }
    await page.waitForFunction(({ selector, first }) => JSON.stringify([...document.querySelectorAll(selector)].map(node => node.textContent)) !== JSON.stringify(first), { selector: surface.rows, first: firstPage });
    await selectedRows(page, surface);
    assert.notDeepEqual(await page.locator(surface.rows).allTextContents(), firstPage, 'Invoice paging advances within the exact folder.');
    proof.checks.push(type + ': company selection counts all 61 records, confines every row, and paginates beyond the first invoice page.');
    await searchInvoices(state, type, 'INV-ACME-0001');
    await waitRows(page, surface, 1);
    assert.match(await page.locator(surface.table).innerText(), /INV-ACME-0001/);
    assert.equal(await page.locator(surface.rows).count(), 1, 'Existing invoice search intersects the selected folder instead of resetting it.');
    await searchInvoices(state, type, '');
    await selectedRows(page, surface);
    proof.checks.push(type + ': existing invoice search composes with the selected company; clearing search retains its exact folder and full count.');
    await page.reload();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('user') || '{}').id > 0);
    await page.locator(surface.host).locator('[data-invoice-folder-title]').waitFor();
    await selectedRows(page, surface);
    assert(new URL(page.url()).search.includes('folder'), 'Folder state survives reload using the established navigation URL.');
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
