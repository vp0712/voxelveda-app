'use strict';
// Exercise the actual retained invoice renderer, routes and permissions using
// the existing isolated SQL fixture. Never connects to production or sends mail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const phase = process.env.VV_COMPACT_PHASE || 'after';
assert(['before', 'after'].includes(phase), 'Choose the before or after action presentation.');
const source = path.resolve(process.env.VV_COMPACT_SOURCE_ROOT || path.join(__dirname, '..'));
const out = process.env.UI_PROOF_DIR || '/tmp/voxelveda-compact-actions/' + phase;
process.env.UI_PROOF_DIR = out;
// Both phases use exactly the same original fixture generator, source records
// and filters. This test substitutes only its own browser scenario; the normal
// restored-workflow and responsive-invoice gates continue to run separately.
process.env.VV_RESPONSIVE_MATRIX = 'after';
const widths = [320, 360, 390, 430, 768, 1024, 1440];
const visualWidths = new Set([390, 1440]);

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function invoiceData(row) {
  return row.evaluate(el => ({
    id: el.getAttribute('data-invoice-id'),
    reference: el.querySelector('.invoice-reference')?.textContent.trim(),
    customer: el.querySelector('.invoice-customer')?.textContent.trim(),
    date: el.querySelector('.invoice-date')?.textContent.trim(),
    status: el.querySelector('.invoice-status')?.textContent.trim(),
    amounts: [...el.querySelectorAll('.invoice-amount')].map(n => n.textContent.trim())
  }));
}

require(path.join(source, 'scripts/responsive-workspace-scenario.js')).run = async ({ page, context, origin, records }) => {
  fs.mkdirSync(out, { recursive: true });
  const proof = { fixture_only: true, phase, source_commit: process.env.VV_COMPACT_SOURCE_COMMIT || null,
    records: [], layouts: [], scenarios: [], private_live_workflows_tested: false, physical_device_tested: false };
  // Keep the two same saved fixture invoices in both phases, then reload through
  // the real API/controller. No page-only financial values are fabricated.
  records.splice(2);
  await page.evaluate(() => goSection('invoiceSection'));
  await page.waitForFunction(() => document.querySelector('#invoiceTableBody')?.textContent.includes('INV-TEST-0091'));
  await page.evaluate(() => loadInvoices());
  await page.waitForFunction(() => document.querySelectorAll('#invoiceTableBody [data-invoice-id]').length === 2);
  const api = await context.request.get(origin + '/api/invoice');
  assert.equal(api.status(), 200);
  const apiData = await api.json();
  const responseArrays = [apiData, ...Object.values(apiData || {})].filter(Array.isArray);
  const apiRows = responseArrays.find(rows => rows.length === 2 && rows.every(row => [91, 92].includes(Number(row.id))));
  assert.ok(apiRows, 'Both visible records come from the actual authorised fixture API, under its retained response envelope.');

  for (const theme of ['light', 'dark']) for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(value => VoxelTheme.set(value), theme);
    await page.evaluate(() => { for (const node of document.querySelectorAll('#invoiceSection *')) if (node.scrollLeft) node.scrollLeft = 0; });
    if (phase === 'after') {
      await page.waitForFunction(() => typeof window.VoxelActionIcons?.enhance === 'function');
      await page.evaluate(() => VoxelActionIcons.enhance(document.getElementById('invoiceSection')));
      assert.equal(await page.locator('#invoiceTableBody .record-action-menu').count(), 0,
        'All permitted row actions are direct controls, with no record More disclosure.');
    }
    await settle(page);
    const rows = page.locator('#invoiceTableBody [data-invoice-id]');
    const data = await Promise.all((await rows.all()).map(invoiceData));
    if (!proof.records.length) proof.records = data;
    else assert.deepEqual(data, proof.records, 'Theme and viewport changes preserve every displayed invoice field.');
    const measuredRows = [];
    for (const item of await rows.all()) {
      if (phase === 'before') {
        // The original menu permits only one expanded row at a time. Measure
        // each record with its own real More menu open, matching the reference.
        const menu = item.locator('.record-action-menu');
        if (await menu.count() && !await menu.evaluate(node => node.open)) await menu.locator('summary').click();
        await settle(page);
      }
      measuredRows.push(await item.evaluate(row => {
        const actions = row.querySelector('.invoice-actions'), rect = row.getBoundingClientRect(), actionRect = actions.getBoundingClientRect();
        return { id: row.dataset.invoiceId, height: rect.height, actionHeight: actionRect.height,
          actions: [...actions.querySelectorAll('button,a')].filter(button => button.getClientRects().length).map(button => {
            const bounds = button.getBoundingClientRect(), style = getComputedStyle(button), before = getComputedStyle(button, '::before');
            return { label: button.getAttribute('aria-label') || button.textContent.trim(), text: button.textContent.trim(),
              title: button.title, icon: button.dataset.vvActionIcon || null, className: button.className,
              width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right,
              fontSize: style.fontSize, mask: before.maskImage || before.webkitMaskImage, disabled: button.disabled };
          }) };
      }));
      if (visualWidths.has(width)) {
        await page.mouse.move(0, 0);
        const id = await item.getAttribute('data-invoice-id');
        await item.screenshot({path:path.join(out, `${phase}-invoice-${id === '92' ? 'approved' : 'draft'}-${width}-${theme}.png`), animations:'disabled'});
      }
    }
    const layout = {width, scrollWidth:await page.evaluate(() => document.documentElement.scrollWidth), rows:measuredRows};
    assert(layout.scrollWidth <= width + 1, theme + '/' + width + ': no horizontal page overflow');
    if (phase === 'after') for (const row of layout.rows) for (const button of row.actions) {
      assert(button.icon, 'Every invoice action declares its own semantic icon: ' + button.text);
      assert(button.label && button.title, 'Icon-only controls retain an accessible name and tooltip.');
      assert(button.mask && button.mask !== 'none', 'A recognisable SVG mask is rendered for ' + button.text);
      assert(button.width >= 43 && button.height >= 43, 'Suitable touch target for ' + button.text);
      assert(button.width <= 48 && button.height <= 48, 'An action stays compact: ' + JSON.stringify(button));
      if (width >= 701 && !(button.left >= -1 && button.right <= width + 1)) {
        // The existing tablet/desktop register has a local table scroller.
        // Nonzero layout bounds do not mean the clipped column is visible.
        // Prove every direct action is reachable without scrolling the page.
        const control = page.locator(`[data-invoice-id="${row.id}"] .invoice-actions`).getByRole('button', {name:button.label,exact:true});
        const scrollable = await control.evaluate(node => {
          for (let parent=node.parentElement;parent;parent=parent.parentElement) {
            if (/(?:auto|scroll)/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
          }
          return false;
        });
        assert(scrollable, 'An offscreen register action must belong to a local accessible scroller');
        await control.focus(); await control.scrollIntoViewIfNeeded();
        const visible = await control.boundingBox();
        assert(visible && visible.x >= -1 && visible.x + visible.width <= width + 1, 'Focus reveals the complete direct action: ' + button.text);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollLeft), 0, 'Only the table scrolls horizontally, never the page');
      } else if (!(button.left >= -1 && button.right <= width + 1)) {
        fs.writeFileSync(path.join(out, 'failed-layout.json'), JSON.stringify({ theme, ...layout }, null, 2));
        await page.screenshot({ path: path.join(out, 'failed-layout.png'), fullPage: true });
        assert.fail('Visible action is within the page: ' + JSON.stringify({label:button.text,width,theme,left:button.left,right:button.right,invoice:row.id}));
      }
    }
    proof.layouts.push({ theme, ...layout });
  }

  if (phase === 'after') {
    const beforeFile = process.env.VV_COMPACT_BEFORE_PROOF || path.join(path.dirname(out), 'before', 'compact-actions.json');
    assert(fs.existsSync(beforeFile), 'Capture the exact preserved baseline first: ' + beforeFile);
    const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
    assert.deepEqual(proof.records, before.records, 'Before/after use the same saved records, values and filters.');
    for (const width of [320, 360, 390, 430]) for (const theme of ['light', 'dark']) {
      const current = proof.layouts.find(row => row.width === width && row.theme === theme);
      const original = before.layouts.find(row => row.width === width && row.theme === theme);
      for (const row of current.rows) {
        const old = original.rows.find(other => other.id === row.id);
        assert(row.actionHeight < old.actionHeight, 'Icons reduce the expanded phone action area for invoice ' + row.id);
        assert(row.height < old.height, 'The phone invoice card is shorter while preserving its fields.');
      }
    }
    proof.scenarios.push('Same saved API fixture and filters; expanded More replaced by direct compact actions; shorter phone cards and action areas');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => VoxelTheme.set('light'));
    const invoice = page.locator('[data-invoice-id="91"]');
    await invoice.getByRole('button', { name: 'View invoice', exact: true }).click();
    await page.locator('#dialogBackdrop.active').waitFor();
    assert.match(await page.locator('#dialogTitle').innerText(), /INV-TEST-0091/);
    assert.equal(await page.locator('#dialogPrimaryBtn').innerText(), 'Close', 'Read-only Close remains explicit.');
    assert.equal(await page.locator('#dialogPrimaryBtn').getAttribute('data-vv-action-icon'), null);
    await page.locator('#dialogPrimaryBtn').click();
    proof.scenarios.push('Eye action retains original invoice record callback and explicit read-only Close');

    await page.evaluate(() => {
      window.__compactEmailSources = [];
      window.VoxelDocumentEmail.open = source => { window.__compactEmailSources.push(source); return true; };
    });
    await page.locator('[data-invoice-id="92"] [data-vv-action-icon="email"]').click();
    const emailSources = await page.evaluate(() => window.__compactEmailSources);
    assert.equal(emailSources.length, 1);
    assert.equal(emailSources[0].type, 'invoice'); assert.equal(Number(emailSources[0].record_id), 92);
    proof.scenarios.push('Envelope invokes the existing source-bound invoice email callback once; no external message sent');

    // Test shared presentation boundaries independently of business handlers.
    // Data/DOM text is retained, including nested labels and dynamic busy text.
    await page.evaluate(() => {
      const fixture = document.createElement('section'); fixture.id = 'compactBoundaryFixture';
      fixture.innerHTML = '<div class="vv-action-toolbar"><button id="compactCallback" type="button" data-vv-action-icon="view">View <span>retained record</span></button><button id="compactBusy" type="button" data-vv-action-icon="email">Email record</button><button id="compactBadge" type="button" data-vv-action-icon="email" aria-label="Alerts, 2 unread">Alerts<span class="notification-badge">2</span></button><button id="compactHidden" hidden data-vv-action-icon="edit">Hidden editor</button><button id="compactStyleHidden" style="display:none" data-vv-action-icon="archive">Hidden archiver</button></div><div hidden><button id="compactParentHidden" data-vv-action-icon="delete">Hidden delete</button></div><form><label>Existing field <input value="Retained unsaved value"></label><button id="compactSave" type="submit">Save</button><button id="compactCancel" type="button">Cancel</button></form><div id="compactMixedToolbar" class="vv-action-toolbar" style="max-width:260px"><button type="button" data-vv-action-icon="pdf">PDF</button><button id="compactImport" type="button" class="primary-btn">Confirm import after reviewing all mapped source rows</button><button type="button" data-vv-action-icon="archive">Archive</button></div>';
      document.getElementById('invoiceSection').append(fixture); window.__compactCallbackCount = 0;
      document.getElementById('compactCallback').addEventListener('click', () => window.__compactCallbackCount++);
      VoxelActionIcons.enhance(fixture);
    });
    for (const id of ['compactHidden', 'compactStyleHidden', 'compactParentHidden']) assert.equal(await page.locator('#' + id).isVisible(), false,
      'Presentation never exposes hidden/permission-filtered controls: ' + id);
    assert.equal(await page.locator('#compactCallback').textContent(), 'View retained record');
    await page.getByRole('button', { name: 'View retained record', exact: true }).click();
    assert.equal(await page.evaluate(() => __compactCallbackCount), 1, 'The original event listener remains bound once.');
    await page.locator('#compactCallback').focus();
    assert.equal(await page.locator('#compactCallback').evaluate(el => document.activeElement === el), true);
    await page.getByRole('tooltip').waitFor({ state: 'visible' });
    assert.match(await page.getByRole('tooltip').innerText(), /View retained record/);
    await page.keyboard.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#compactBusy').evaluate(el => document.activeElement === el), true, 'Tab reaches the next icon action.');
    await page.evaluate(() => { const button = document.getElementById('compactBusy'); button.textContent = 'Sending…'; button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    await page.waitForFunction(() => document.getElementById('compactBusy').getAttribute('aria-label')?.includes('Sending'));
    assert.equal(await page.locator('#compactBusy').isDisabled(), true);
    assert.equal(await page.locator('#compactBusy').textContent(), 'Sending…');
    await page.evaluate(() => {
      const button = document.getElementById('compactBadge');
      button.querySelector('.notification-badge').textContent = '3';
      button.setAttribute('aria-label', 'Alerts, 3 unread');
    });
    await settle(page);
    assert.equal(await page.locator('#compactBadge').getAttribute('aria-label'), 'Alerts, 3 unread', 'Externally managed unread names remain authoritative.');
    assert.equal(await page.locator('#compactBadge .notification-badge').innerText(), '3');
    const badge = await page.locator('#compactBadge .notification-badge').evaluate(el => ({ font:parseFloat(getComputedStyle(el).fontSize), width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height }));
    assert(badge.font > 0 && badge.width > 0 && badge.height > 0, 'Unread badge remains readable beside its icon.');
    assert.equal(await page.locator('#compactImport').getAttribute('data-vv-action-icon'), null, 'A review/confirmation action is not implicitly turned into an icon.');
    const mixed = await page.locator('#compactImport').evaluate(el => {
      const rect = el.getBoundingClientRect(), group = el.parentElement.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(el);
      return { font:parseFloat(getComputedStyle(el).fontSize), rect:rect.toJSON(), group:group.toJSON(), textRects:[...range.getClientRects()].map(r => r.toJSON()) };
    });
    assert(mixed.font > 0 && mixed.rect.width > 44, 'A mixed toolbar preserves the full-width confirmation label.');
    assert(mixed.rect.left >= mixed.group.left - 1 && mixed.rect.right <= mixed.group.right + 1, 'Mixed toolbar confirmation fits its local width.');
    assert(mixed.textRects.every(r => r.left >= mixed.rect.left - 1 && r.right <= mixed.rect.right + 1 && r.top >= mixed.rect.top - 1 && r.bottom <= mixed.rect.bottom + 1), 'Long import confirmation wraps within its own button without clipping.');
    for (const id of ['compactSave', 'compactCancel']) assert.equal(await page.locator('#' + id).getAttribute('data-vv-action-icon'), null,
      'Form confirmation labels are not generically compacted.');
    assert.equal(await page.locator('#compactBoundaryFixture input').inputValue(), 'Retained unsaved value');
    assert.equal(await page.locator('.sidebar .vv-icon-action').count(), 0, 'Current sidebar is outside action presentation.');
    assert.equal(await page.locator('.vv-chart-data .vv-icon-action').count(), 0, 'Approved chart interactions are outside action presentation.');
    proof.scenarios.push('Hidden permissions, unchanged DOM text/listeners, keyboard/tooltip/Escape, dynamic busy state, externally managed unread badges, mixed confirmation toolbars and untouched form values/sidebar/chart controls');
  }
  fs.writeFileSync(path.join(out, 'compact-actions.json'), JSON.stringify(proof, null, 2));
  console.log('COMPACT_ACTION_BROWSER_OK ' + phase + ': 14 theme/width cases; real renderer/controller fixture; no production writes or email.');
};

require(path.join(source, 'scripts/restored-ui-browser-test.js'));
