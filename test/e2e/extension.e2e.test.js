/**
 * End-to-end test: load the built extension (dist/) in Chromium, serve a
 * Datadog-like navbar on a Datadog URL and mock /api/v2/current_user, then
 * check which navbar entries the extension hides.
 *
 * Run with: npm run test:e2e (builds dist/ first)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { buildNavbarHtml } = require('./navbar-fixture');
const { roles } = require('../fixtures/datadog-permissions.json');

const EXTENSION_DIR = path.join(__dirname, '..', '..', 'dist');
const ORIGIN = 'https://app.datadoghq.eu';
const HIDDEN_SELECTOR = '.dd-smart-menu-collapsed, .dd-smart-menu-hidden';

function currentUserPayload(permissions, roleName) {
  return {
    data: { type: 'users', id: 'test-user', attributes: { email: 'e2e@example.com', name: 'E2E User' } },
    included: [
      { type: 'roles', id: 'role-1', attributes: { name: roleName } },
      ...permissions.map((name, i) => ({ type: 'permissions', id: `perm-${i}`, attributes: { name } }))
    ]
  };
}

/**
 * Open the fixture page with the extension loaded and the given permissions,
 * and return the visibility of every navbar link and top-level entry.
 */
async function runScenario(permissions, roleName = 'E2E Role') {
  assert.ok(fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json')), 'dist/ is missing: run npm run build first');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-smart-menu-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
  });

  try {
    // Wait for the service worker so onInstalled has stored the default settings.
    if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker');

    await context.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v2/current_user') {
        return route.fulfill({ json: currentUserPayload(permissions, roleName) });
      }
      return route.fulfill({ contentType: 'text/html', body: buildNavbarHtml() });
    });

    const page = await context.newPage();
    const detected = page.waitForEvent('console', {
      predicate: msg => msg.text().includes('[Datadog Smart Menu] Total RBAC permissions'),
      timeout: 15000
    });
    await page.goto(`${ORIGIN}/dashboard/lists`);
    await detected;
    // Filters are applied right after detection; give the DOM a moment to settle.
    await page.waitForTimeout(500);

    return await page.evaluate((hiddenSelector) => {
      const isHidden = el => !!el.closest(hiddenSelector);
      const links = {};
      document.querySelectorAll('[data-menu] a[href]').forEach((a) => {
        const key = `${a.closest('[data-menu]').dataset.menu} > ${a.textContent.trim()} ${a.getAttribute('href')}`;
        links[key] = !isHidden(a);
      });
      const menus = {};
      document.querySelectorAll('[data-menu]').forEach((li) => { menus[li.dataset.menu] = !isHidden(li); });
      return { links, menus };
    }, HIDDEN_SELECTOR);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

const visibleHref = (state, href) => Object.entries(state.links).filter(([k]) => k.endsWith(` ${href}`)).map(([, v]) => v);

test('Datadog Admin Role: nothing is hidden', async () => {
  const state = await runScenario(roles['Datadog Admin Role'], 'Datadog Admin Role');
  const hidden = Object.entries(state.links).filter(([, visible]) => !visible).map(([k]) => k);
  assert.deepEqual(hidden, []);
});

test('Datadog Read Only Role: admin pages hidden, telemetry kept', async () => {
  const state = await runScenario(roles['Datadog Read Only Role'], 'Datadog Read Only Role');
  for (const href of ['/logs', '/dashboard/lists', '/apm/home', '/monitors/manage', '/metric/explorer']) {
    assert.ok(visibleHref(state, href).every(Boolean), `${href} should be visible`);
  }
  // Plan & Usage and Audit Trail live in the account popover, outside the sidebar.
  for (const href of ['/billing', '/audit-trail', '/sensitive-data-scanner/configuration/telemetry']) {
    assert.ok(visibleHref(state, href).length > 0, `${href} missing from fixture`);
    assert.ok(visibleHref(state, href).every(v => !v), `${href} should be hidden`);
  }
});

test('logs-only user: unrelated top-level entries are hidden', async () => {
  const state = await runScenario(['logs_read_data', 'dashboards_read']);
  assert.equal(state.menus.Logs, true);
  assert.equal(state.menus.Dashboards, true);
  for (const menu of ['Monitoring', 'Infrastructure', 'Security', 'Metrics', 'Errors', 'Software Delivery']) {
    assert.equal(state.menus[menu], false, `${menu} should be hidden`);
  }
  // Pages without a dedicated permission stay visible, and keep their
  // top-level entry visible (Integrations > Marketplace).
  assert.equal(state.menus['Data Observability'], true);
  assert.ok(visibleHref(state, '/integrations').every(v => !v), 'Integrations page should be hidden');
  assert.ok(visibleHref(state, '/marketplace').every(Boolean), 'Marketplace should be visible');
  assert.equal(state.menus.Integrations, true);
});

test('look-alike permissions do not reveal unrelated menus', async () => {
  // rum_apps_read used to reveal Automation through the "apps_" substring.
  const state = await runScenario(['rum_apps_read', 'dashboards_read']);
  assert.equal(state.menus.Automation, false);
  assert.ok(visibleHref(state, '/rum/list').every(Boolean), 'RUM should be visible');
});

test('no permissions returned: menu stays unfiltered', async () => {
  const state = await runScenario([]);
  const hidden = Object.entries(state.links).filter(([, visible]) => !visible).map(([k]) => k);
  assert.deepEqual(hidden, []);
});
