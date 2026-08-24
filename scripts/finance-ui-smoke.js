const { chromium } = require('playwright');
const fs = require('fs');

const baseUrl = String(process.env.UI_BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
const email = process.env.UI_ADMIN_EMAIL || 'admin@test.com';
const password = process.env.UI_ADMIN_PASSWORD || '123456';

const viewports = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function authenticate(page) {
  const response = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { email, password }
  });
  const payload = await response.json();
  assert(response.ok() && payload.token && payload.user, `Login failed: ${payload.message || response.status()}`);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('role', user.role);
  }, payload);
}

async function bodyMetrics(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
}

async function assertNoPageOverflow(page, label) {
  const metrics = await bodyMetrics(page);
  assert(
    metrics.scrollWidth <= metrics.clientWidth + 1 && metrics.bodyScrollWidth <= metrics.clientWidth + 1,
    `${label} has page overflow: ${JSON.stringify(metrics)}`
  );
}

async function openFinance(page, viewport) {
  const financeNav = page.locator('[data-section="financeSection"]');
  if (viewport.width < 1024) {
    const menu = page.locator('[data-mobile-menu-action="toggle"]');
    await menu.click();
    await page.waitForTimeout(150);
    assert(await page.locator('body').evaluate((el) => el.classList.contains('mobile-menu-open')), `${viewport.name}: mobile menu did not open`);
    await financeNav.click();
    await page.waitForTimeout(180);
    assert(!(await page.locator('body').evaluate((el) => el.classList.contains('mobile-menu-open'))), `${viewport.name}: mobile menu did not close after navigation`);
  } else {
    await financeNav.click();
  }
  await page.locator('#financeSection:not(.hidden-section)').waitFor({ state: 'visible' });
}

async function assertDialogFits(page, viewport, label) {
  const metrics = await page.locator('.dialog-panel').evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const body = panel.querySelector('#dialogBody');
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      panelClientWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      bodyClientWidth: body?.clientWidth || 0,
      bodyScrollWidth: body?.scrollWidth || 0,
      overflowX: getComputedStyle(panel).overflowX
    };
  });
  assert(metrics.left >= -1 && metrics.right <= viewport.width + 1, `${viewport.name}: ${label} is wider than viewport`);
  assert(metrics.top >= -1 && metrics.bottom <= viewport.height + 1, `${viewport.name}: ${label} is taller than viewport`);
  assert(metrics.bodyScrollWidth <= metrics.bodyClientWidth + 1, `${viewport.name}: ${label} body scrolls horizontally`);
  assert(metrics.overflowX === 'hidden', `${viewport.name}: ${label} panel does not contain horizontal overflow`);
}

async function exerciseViewport(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/chart\.js|cdn\.jsdelivr\.net/i.test(text)) return;
    if (/Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED/i.test(text)) return;
    errors.push(`console: ${text}`);
  });

  try {
    await authenticate(page);
    await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded' });
    await page.locator('#dashboardSection').waitFor({ state: 'visible' });
    await assertNoPageOverflow(page, `${viewport.name} dashboard`);
    await openFinance(page, viewport);
    await assertNoPageOverflow(page, `${viewport.name} finance overview`);

    for (const tab of ['Ledger', 'Supplier Bills', 'Banking', 'Period Control', 'Overview']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(120);
      await assertNoPageOverflow(page, `${viewport.name} ${tab}`);
    }

    await page.getByRole('button', { name: 'Supplier Bills', exact: true }).click();
    await page.getByRole('button', { name: 'Add Supplier Bill', exact: true }).click();
    await page.locator('.dialog-backdrop.active').waitFor({ state: 'visible' });
    await assertDialogFits(page, viewport, 'supplier bill dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Banking', exact: true }).click();
    await page.getByRole('button', { name: 'Add Account', exact: true }).click();
    await page.locator('.dialog-backdrop.active').waitFor({ state: 'visible' });
    await assertDialogFits(page, viewport, 'bank account dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    assert(errors.length === 0, `${viewport.name} browser errors:\n${errors.join('\n')}`);
    console.log(`PASS ${viewport.name}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const installedChrome = process.env.PLAYWRIGHT_CHROME_PATH
    || (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: installedChrome });
  try {
    for (const viewport of viewports) await exerciseViewport(browser, viewport);
    console.log(`Finance UI smoke passed at ${viewports.length} responsive breakpoints.`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
