/**
 * Browser side of the RBAC audit against a fake Datadog served by Playwright:
 * pages that get a 403 from the API are denied, with the missing permission
 * read from the response; other pages are accessible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBrowser } = require('../../scripts/rbac-audit');
const { classify } = require('../../scripts/lib/rbac-discovery');

const ORIGIN = 'https://app.datadoghq.eu';

function page(apiPath) {
  return `<!doctype html><html><body>
    <nav>Banner: you don't have permission to view incidents</nav>
    <main id="single-page-app_layout_page__main-content"><h1>Page</h1></main>
    <script>
      fetch('/api/v1/org/test-org');
      fetch('/api/ui/custom-banner');
      fetch(${JSON.stringify(apiPath)}).then(r => r.text()).then(t => { document.body.dataset.done = '1'; });
    </script></body></html>`;
}

async function fakeDatadog(context) {
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    switch (url.pathname) {
      case '/api/v2/current_user':
        return route.fulfill({ json: { data: { id: 'test-user' }, included: [{ type: 'permissions', attributes: { name: 'dashboards_read' } }] } });
      case '/api/v1/logs-queries':
        return route.fulfill({ status: 403, json: { errors: ["Forbidden: Missing required permission: 'logs_read_data'"] } });
      case '/api/v1/monitor':
        return route.fulfill({ json: [] });
      case '/api/ui/custom-banner':
      case '/api/v1/org/test-org':
        // Background call made by every page, denied for a near-empty role.
        return route.fulfill({ status: 403, json: { errors: ['Forbidden'] } });
      case '/logs':
        return route.fulfill({ contentType: 'text/html', body: page('/api/v1/logs-queries') });
      case '/monitors/manage':
        return route.fulfill({ contentType: 'text/html', body: page('/api/v1/monitor') });
      case '/billing':
        return route.fulfill({ contentType: 'text/html', body: "<main><p>You don't have permission to view this page.</p></main>" });
      case '/personal-settings/profile':
        return route.fulfill({ contentType: 'text/html', body: page('/api/v1/monitor') });
      case '/logs/flex-logs-controls':
        return route.fulfill({ contentType: 'text/html', body: '<main>Arf. 404: Page Not Found</main>' });
      case '/logs/indexes':
        return route.fulfill({ contentType: 'text/html', body: '<main>An error occurred while loading the page. Try to refresh in a few seconds</main>' });
      case '/expired':
        return route.fulfill({ status: 302, headers: { location: `${ORIGIN}/account/login` } });
      default:
        return route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' });
    }
  });
}

test('probe detects 403s, missing permissions and expired sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbac-probe-'));
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }));
  const browser = await createBrowser({ site: 'datadoghq.eu', statePath, setupContext: fakeDatadog });
  try {
    const me = await browser.currentUser();
    assert.equal(me.id, 'test-user');
    assert.deepEqual(me.permissions, ['dashboards_read']);

    // The reference page reveals background calls denied everywhere; the org
    // call is already known as background, so only the new one is reported.
    assert.deepEqual(await browser.calibrate(), ['/api/ui/custom-banner']);
    assert.deepEqual(await browser.calibrate(), [], 'already learned');
    const noise = browser.noise();

    const logs = classify(await browser.probe('/logs'), noise);
    assert.equal(logs.accessible, false);
    assert.deepEqual(logs.missing, ['logs_read_data']);
    assert.deepEqual(logs.evidence.deniedApis, ['/api/v1/logs-queries']);
    assert.deepEqual(logs.evidence.ignoredApis.sort(), ['/api/ui/custom-banner', '/api/v1/org/test-org']);

    const monitors = classify(await browser.probe('/monitors/manage'), noise);
    assert.equal(monitors.accessible, true, 'the background 403 and the banner outside <main> are ignored');

    const billing = classify(await browser.probe('/billing'), noise);
    assert.equal(billing.accessible, false, 'a "no permission" page counts as denied');
    assert.equal(billing.evidence.pageDenied, true);
    assert.ok(browser.debug.some(d => d.api === '/api/v1/logs-queries' && /logs_read_data/.test(d.body)));

    const missingPage = classify(await browser.probe('/logs/flex-logs-controls'), noise);
    assert.equal(missingPage.notFound, true, 'a 404 page is not "open"');

    const errorPage = classify(await browser.probe('/logs/indexes'), noise);
    assert.equal(errorPage.accessible, false, 'a page that fails to load counts as denied');

    await assert.rejects(browser.probe('/expired'), /session has expired/);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
