/**
 * Offline tests of the RBAC audit: a fake Datadog decides which permissions
 * each page needs; the discovery must find them, and the comparison must flag
 * every menu that the extension shows or hides wrongly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverRequirements, verifyCandidates } = require('../scripts/lib/rbac-discovery');
const { compareMapping, prng } = require('../scripts/lib/rbac-compare');
const { apiBase, extractMissingPermissions } = require('../scripts/rbac-audit');

/**
 * Fake Datadog: each route has a list of alternative permission sets; a page
 * opens when one set is held, otherwise it reports the first missing
 * permission of the first set (like a 403 "Missing required permission").
 */
function fakeDatadog(rules) {
  let held = new Set();
  const calls = { apply: 0 };
  return {
    calls,
    applyPermissions: async (names) => {
      calls.apply++;
      held = new Set(names.filter(n => n !== 'not_grantable'));
      return { rejected: names.filter(n => n === 'not_grantable') };
    },
    probe: async (route) => {
      const sets = rules[route];
      if (sets === 'silent') return { accessible: false, missing: [] };
      if (!sets || sets.length === 0) return { accessible: true, missing: [] };
      if (sets.some(set => set.every(p => held.has(p)))) return { accessible: true, missing: [] };
      return { accessible: false, missing: [sets[0].find(p => !held.has(p))] };
    }
  };
}

test('discovery finds the permissions each page needs, one missing permission at a time', async () => {
  const dd = fakeDatadog({
    '/marketplace': [],
    '/logs': [['logs_read_data', 'logs_read_index_data']],
    '/logs/livetail': [['logs_read_data', 'logs_read_index_data', 'logs_live_tail']],
    '/monitors/manage': [['monitors_read']],
    '/dashboard/lists': [['dashboards_read']],
    '/mystery': 'silent',
    '/locked': [['not_grantable']]
  });
  const entries = await discoverRequirements({ routes: Object.keys({
    '/marketplace': 1, '/logs': 1, '/logs/livetail': 1, '/monitors/manage': 1, '/dashboard/lists': 1, '/mystery': 1, '/locked': 1
  }), ...dd });
  const byRoute = Object.fromEntries(entries.map(e => [e.route, e]));

  assert.equal(byRoute['/marketplace'].status, 'open');
  assert.deepEqual(byRoute['/logs'].requires, ['logs_read_data', 'logs_read_index_data']);
  assert.deepEqual(byRoute['/logs/livetail'].requires, ['logs_live_tail', 'logs_read_data', 'logs_read_index_data']);
  assert.deepEqual(byRoute['/monitors/manage'].sufficient, [['monitors_read']]);
  assert.equal(byRoute['/mystery'].status, 'unknown');
  assert.equal(byRoute['/locked'].status, 'unknown');
  assert.match(byRoute['/locked'].reason, /could not grant/);
  // Routes needing the same set share one role update.
  assert.ok(dd.calls.apply <= 7, `too many role updates: ${dd.calls.apply}`);
});

test('verification records which single permissions open a page', async () => {
  const dd = fakeDatadog({ '/apm/traces': [['apm_read'], ['apm_service_catalog_read']] });
  const entries = await discoverRequirements({ routes: ['/apm/traces'], ...dd });
  await verifyCandidates({
    entries,
    candidates: new Map([['apm_service_catalog_read', ['/apm/traces']], ['dbm_read', ['/apm/traces']]]),
    ...dd
  });
  assert.deepEqual(entries[0].sufficient, [['apm_read'], ['apm_service_catalog_read']]);
  assert.deepEqual(entries[0].insufficient, [['dbm_read']]);
});

// A tiny extension model for the comparison tests.
const menus = {
  permissionMatches: (pattern, name) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern),
  findMenuForHref: href => ({ '/logs': 'logs', '/logs/livetail': 'logs', '/apm/traces': 'apm', '/marketplace': 'marketplace' }[href]
    ? { id: { '/logs': 'logs', '/logs/livetail': 'logs', '/apm/traces': 'apm', '/marketplace': 'marketplace' }[href],
        permissions: { logs: ['logs_*'], apm: ['apm_read'], marketplace: null }[{ '/logs': 'logs', '/logs/livetail': 'logs', '/apm/traces': 'apm', '/marketplace': 'marketplace' }[href]] }
    : null),
  mapPermissionsToMenus(perms) {
    const out = ['marketplace'];
    if (perms.some(p => p.startsWith('logs_'))) out.push('logs');
    if (perms.includes('apm_read')) out.push('apm');
    return out;
  }
};
const universe = ['logs_read_data', 'logs_read_index_data', 'logs_live_tail', 'logs_write_pipelines', 'apm_read', 'apm_service_catalog_read', 'dbm_read'];

test('comparison flags links shown to users who would get a 403', () => {
  const matrix = [
    { route: '/logs', status: 'requires', requires: ['logs_read_data', 'logs_read_index_data'], sufficient: [['logs_read_data', 'logs_read_index_data']] }
  ];
  const { mismatches } = compareMapping({ matrix, menus, universe, iterations: 200 });
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].type, 'shown-but-denied');
  assert.equal(mismatches[0].example.length, 1, 'the example role should be minimal');
});

test('comparison flags pages hidden from users who can open them', () => {
  const matrix = [
    { route: '/apm/traces', status: 'requires', requires: ['apm_read'], sufficient: [['apm_read'], ['apm_service_catalog_read']] }
  ];
  const { mismatches } = compareMapping({ matrix, menus, universe, iterations: 200 });
  assert.deepEqual(mismatches.map(m => [m.type, m.example]), [['hidden-but-accessible', ['apm_service_catalog_read']]]);
});

test('comparison passes when the extension matches the matrix', () => {
  const matrix = [
    { route: '/marketplace', status: 'open', requires: [], sufficient: [] },
    { route: '/apm/traces', status: 'requires', requires: ['apm_read'], sufficient: [['apm_read']] },
    { route: '/logs/livetail', status: 'unknown', requires: [] }
  ];
  const result = compareMapping({ matrix, menus, universe, iterations: 500 });
  assert.equal(result.routes, 2, 'unknown routes are not compared');
  assert.deepEqual(result.mismatches, []);
});

test('random roles are reproducible from the seed', () => {
  const a = prng(7), b = prng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('missing permissions are read from Datadog 403 messages', () => {
  assert.deepEqual(extractMissingPermissions('{"errors":["Forbidden: Missing required permission: \'logs_read_data\'"]}'), ['logs_read_data']);
  assert.deepEqual(extractMissingPermissions('Missing required permissions: [monitors_read, slos_read]').sort(), ['monitors_read', 'slos_read']);
  assert.deepEqual(extractMissingPermissions('{"errors":["Forbidden"]}'), []);
});

test('API base URL follows the Datadog site', () => {
  assert.equal(apiBase('datadoghq.eu'), 'https://api.datadoghq.eu');
  assert.equal(apiBase('datadoghq.com'), 'https://api.datadoghq.com');
  assert.equal(apiBase('us3.datadoghq.com'), 'https://api.us3.datadoghq.com');
  assert.equal(apiBase(undefined), 'https://api.datadoghq.eu');
});

test('baseline permissions are held by every compared role', () => {
  // The org keeps logs_read_index_data in every role: /logs only needs logs_read_data on top.
  const matrix = [
    { route: '/logs', status: 'requires', requires: ['logs_read_data'], sufficient: [['logs_read_data']] },
    { route: '/apm/traces', status: 'open', requires: [], sufficient: [] }
  ];
  const result = compareMapping({ matrix, menus, universe, baseline: ['logs_read_index_data'], iterations: 300 });
  const types = result.mismatches.map(m => `${m.route} ${m.type} [${m.example.join(',')}]`);
  // The baseline alone shows Logs (logs_* matches) although /logs needs logs_read_data.
  assert.ok(types.includes('/logs shown-but-denied []'), types.join('\n'));
  // /apm/traces opens with the baseline only, but the extension hides APM without apm_read.
  assert.ok(types.includes('/apm/traces hidden-but-accessible []'), types.join('\n'));
  assert.ok(result.mismatches.every(m => !m.example.includes('logs_read_index_data')), 'examples exclude the baseline');
});

test('APIs denied on most pages are ignored, page-specific denials are kept', async () => {
  // Raw probe results like the real browser: every page gets a 403 on the
  // org API (page chrome); /logs also gets a 403 naming logs_read_data.
  let held = new Set();
  const routes = Array.from({ length: 12 }, (_, i) => `/page-${i}`).concat('/logs');
  const result = await discoverRequirements({
    routes,
    applyPermissions: async (names) => { held = new Set(names); return { rejected: [] }; },
    probe: async (route) => ({
      denied: [
        { api: '/api/v1/org/abc', missing: [] },
        ...(route === '/logs' && !held.has('logs_read_data') ? [{ api: '/api/v2/logs/events', missing: ['logs_read_data'] }] : [])
      ],
      pageDenied: false
    })
  });
  const byRoute = Object.fromEntries(result.map(e => [e.route, e]));
  assert.equal(byRoute['/page-0'].status, 'open');
  assert.deepEqual(byRoute['/logs'].requires, ['logs_read_data']);
  assert.equal(byRoute['/logs'].status, 'requires');
});

test('caller-provided noise APIs are ignored even in small batches', async () => {
  const result = await discoverRequirements({
    routes: ['/a'],
    applyPermissions: async () => ({ rejected: [] }),
    noise: () => new Set(['/api/v2/incidents/search-incidents']),
    probe: async () => ({ denied: [{ api: '/api/v2/incidents/search-incidents', missing: ['incident_read'] }], pageDenied: false })
  });
  assert.equal(result[0].status, 'open');
});
