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

const ORIGIN = 'https://app.datadoghq.eu';

function page(apiPath) {
  return `<!doctype html><html><body><h1>Page</h1><script>
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
      case '/logs':
        return route.fulfill({ contentType: 'text/html', body: page('/api/v1/logs-queries') });
      case '/monitors/manage':
        return route.fulfill({ contentType: 'text/html', body: page('/api/v1/monitor') });
      case '/billing':
        return route.fulfill({ contentType: 'text/html', body: "<p>You don't have permission to view this page.</p>" });
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

    const logs = await browser.probe('/logs');
    assert.equal(logs.accessible, false);
    assert.deepEqual(logs.missing, ['logs_read_data']);
    assert.deepEqual(logs.evidence.deniedApis, ['/api/v1/logs-queries']);

    const monitors = await browser.probe('/monitors/manage');
    assert.equal(monitors.accessible, true);

    const billing = await browser.probe('/billing');
    assert.equal(billing.accessible, false, 'a "no permission" page counts as denied');
    assert.equal(billing.evidence.pageDenied, true);

    await assert.rejects(browser.probe('/expired'), /session has expired/);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
