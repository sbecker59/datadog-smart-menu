/**
 * Offline tests of the RBAC audit: a fake Datadog decides which permissions
 * each page needs; the discovery must find them, and the comparison must flag
 * every menu that the extension shows or hides wrongly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverRequirements, verifyCandidates } = require('../scripts/lib/rbac-discovery');
const { compareMapping, prng } = require('../scripts/lib/rbac-compare');
const { apiBase, extractMissingPermissions, permissionsFromSentence } = require('../scripts/rbac-audit');

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
  const routes = Array.from({ length: 34 }, (_, i) => `/page-${i}`).concat('/logs');
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

/** Fake Datadog that never names the missing permission (like real 403s). */
function silentDatadog(rules) {
  let held = new Set();
  return {
    applyPermissions: async (names) => { held = new Set(names); return { rejected: [] }; },
    probe: async (route) => ({ accessible: rules[route].some(set => set.every(p => held.has(p))), missing: [] })
  };
}

test('elimination finds the permissions of pages that never name them', async () => {
  const dd = silentDatadog({
    '/logs/pipelines': [['logs_read_config', 'logs_read_data']],
    '/apm/traces': [['apm_read'], ['apm_service_catalog_read']],
    '/logs/onboarding': [['api_keys_read']]
  });
  const candidates = {
    '/logs/pipelines': ['logs_read_config', 'logs_read_data', 'logs_write_pipelines', 'logs_read_archives'],
    '/apm/traces': ['apm_read', 'apm_service_catalog_read', 'dbm_read'],
    '/logs/onboarding': ['logs_read_config', 'logs_read_data', 'logs_write_pipelines', 'logs_read_archives']
  };
  const entries = await discoverRequirements({ routes: Object.keys(candidates), candidatesFor: r => candidates[r], ...dd });
  const byRoute = Object.fromEntries(entries.map(e => [e.route, e]));

  assert.equal(byRoute['/logs/pipelines'].status, 'requires');
  assert.deepEqual(byRoute['/logs/pipelines'].requires, ['logs_read_config', 'logs_read_data']);
  assert.deepEqual(byRoute['/apm/traces'].sufficient, [['apm_read'], ['apm_service_catalog_read']], 'alternatives are found');
  assert.equal(byRoute['/logs/onboarding'].status, 'unknown');
  assert.match(byRoute['/logs/onboarding'].reason, /outside them/);
  assert.ok(entries.every(e => !('needsSearch' in e)));
});

test('pages without candidates stay unknown', async () => {
  const dd = silentDatadog({ '/mystery': [['secret_perm']] });
  const [entry] = await discoverRequirements({ routes: ['/mystery'], candidatesFor: () => [], ...dd });
  assert.equal(entry.status, 'unknown');
  assert.match(entry.reason, /no candidate/);
});

test('permission display names in "request access" texts map to permission names', () => {
  const names = new Map([['Logs Read Data', 'logs_read_data'], ['Logs Read', 'logs_read_legacy'], ['APM Read', 'apm_read']]);
  assert.deepEqual(permissionsFromSentence('Request access to permission Logs Read Data to view this page.', names), ['logs_read_data']);
  assert.deepEqual(permissionsFromSentence('Request access to view this page.', names), []);
});

test('known background calls are always ignored and 404 pages are set apart', async () => {
  const entries = await discoverRequirements({
    routes: ['/logs/indexes', '/logs/flex-logs-controls'],
    applyPermissions: async () => ({ rejected: [] }),
    probe: async (route) => route === '/logs/flex-logs-controls'
      ? { denied: [], notFound: true, pageDenied: false }
      : {
          denied: [
            { api: '/api/v1/org/p7do4xr0actwkywo', missing: [] },
            { api: '/api/ui/cmd-k/navigation-mappings', missing: [] },
            { api: '/api/v2/notifications/notify/0ce11d73-da2b-40ad-bbdc-eb5a05ae772e', missing: [] }
          ],
          pageDenied: false
        }
  });
  const byRoute = Object.fromEntries(entries.map(e => [e.route, e]));
  assert.equal(byRoute['/logs/indexes'].status, 'open', 'only background calls were denied');
  assert.equal(byRoute['/logs/flex-logs-controls'].status, 'not-found');
});

test('counter-check drops a permission that looked necessary because of one flaky probe', async () => {
  let held = new Set();
  let flaked = false;
  const needs = ['logs_read_data'];
  const entries = await discoverRequirements({
    routes: ['/logs/pipelines'],
    candidatesFor: () => ['logs_read_data', 'logs_write_facets', 'logs_write_pipelines'],
    applyPermissions: async (names) => { held = new Set(names); return { rejected: [] }; },
    probe: async () => {
      const ok = needs.every(p => held.has(p));
      // One false denial the first time logs_write_facets is missing.
      if (ok && !held.has('logs_write_facets') && held.has('logs_write_pipelines') && !flaked) {
        flaked = true;
        return { accessible: false, missing: [] };
      }
      return { accessible: ok, missing: [] };
    }
  });
  assert.ok(flaked, 'the flaky probe happened');
  assert.deepEqual(entries[0].requires, ['logs_read_data']);
  assert.deepEqual(entries[0].sufficient, [['logs_read_data']]);
});

/** Silent fake Datadog that counts role changes. */
function countingDatadog(rules) {
  let held = new Set();
  const calls = { apply: 0 };
  return {
    calls,
    applyPermissions: async (names) => { calls.apply++; held = new Set(names); return { rejected: [] }; },
    probe: async (route) => ({ accessible: rules[route](held), missing: [] })
  };
}
const logsCandidates = ['flex_logs_config_write', 'logs_delete_data', 'logs_generate_metrics', 'logs_live_tail', 'logs_modify_indexes',
  'logs_read_archives', 'logs_read_config', 'logs_read_data', 'logs_read_index_data', 'logs_read_workspaces', 'logs_write_archive_search',
  'logs_write_archives', 'logs_write_exclusion_filters', 'logs_write_facets', 'logs_write_forwarding_rules', 'logs_write_historical_view',
  'logs_write_pipelines', 'logs_write_processors', 'logs_write_workspaces'];

test('halving finds a necessary permission with far fewer role changes than candidates', async () => {
  const dd = countingDatadog({ '/logs/indexes': held => held.has('logs_read_data') });
  const [entry] = await discoverRequirements({ routes: ['/logs/indexes'], candidatesFor: () => logsCandidates, ...dd });
  assert.deepEqual(entry.sufficient, [['logs_read_data']]);
  assert.ok(dd.calls.apply < 15, `expected fewer role changes than the ${logsCandidates.length} candidates, got ${dd.calls.apply}`);
});

test('a necessary permission plus "one of these" alternatives is found', async () => {
  // Pipelines: logs_read_data AND (logs_read_config OR logs_write_pipelines).
  const dd = countingDatadog({
    '/logs/pipelines': held => held.has('logs_read_data') && (held.has('logs_read_config') || held.has('logs_write_pipelines'))
  });
  const [entry] = await discoverRequirements({ routes: ['/logs/pipelines'], candidatesFor: () => logsCandidates, ...dd });
  assert.equal(entry.status, 'requires');
  assert.deepEqual(entry.sufficient, [['logs_read_config', 'logs_read_data'], ['logs_read_data', 'logs_write_pipelines']]);
  assert.equal(entry.reason, undefined);
});

test('pages needing a permission outside their menu are solved by widening', async () => {
  // Explorer: logs_read_data AND apm_read, apm_read not among the Logs candidates.
  const universe = [...logsCandidates, 'apm_read', 'dbm_read', 'monitors_read', 'dashboards_read', 'api_keys_read'];
  const dd = countingDatadog({ '/logs': held => held.has('logs_read_data') && held.has('apm_read') });
  const [entry] = await discoverRequirements({
    routes: ['/logs'], candidatesFor: () => logsCandidates, widen: () => universe, ...dd
  });
  assert.equal(entry.status, 'requires');
  assert.deepEqual(entry.sufficient, [['apm_read', 'logs_read_data']]);
});

test('a false denial of the necessary set alone does not trigger an alternatives search', async () => {
  // The page needs aws_configuration_read only; the first probe of that set
  // alone is a false denial (Datadog still applying the role change).
  const candidates = ['aws_configuration_read', 'integrations_read', 'apm_read', 'dbm_read', 'logs_read_data', 'monitors_read'];
  let held = new Set();
  let applies = 0;
  let flaked = false;
  const [entry] = await discoverRequirements({
    routes: ['/integrations'],
    candidatesFor: () => candidates,
    applyPermissions: async (names) => { applies++; held = new Set(names); return { rejected: [] }; },
    probe: async () => {
      const ok = held.has('aws_configuration_read');
      if (ok && held.size === 1 && !flaked) { flaked = true; return { accessible: false, missing: [] }; }
      return { accessible: ok, missing: [] };
    }
  });
  assert.ok(flaked);
  assert.deepEqual(entry.sufficient, [['aws_configuration_read']]);
  assert.ok(applies < 12, `no alternatives search expected, got ${applies} role changes`);
});

test('progress is saved after each step for --resume', async () => {
  const snapshots = [];
  await discoverRequirements({
    routes: ['/a', '/b'],
    candidatesFor: () => ['p1', 'p2'],
    applyPermissions: async () => ({ rejected: [] }),
    probe: async route => ({ accessible: route === '/a', missing: [] }),
    onCheckpoint: entries => snapshots.push(entries.map(e => `${e.route}:${e.status}`))
  });
  assert.ok(snapshots.length >= 2, 'at least after round 0 and after the elimination');
  assert.deepEqual(snapshots[0], ['/a:open', '/b:unknown']);
});

test('a page that opens with almost any extra permission is capped and reported', async () => {
  const candidates = Array.from({ length: 40 }, (_, i) => `perm_${String(i).padStart(2, '0')}`).concat('base_perm');
  let held = new Set();
  let applies = 0;
  const [entry] = await discoverRequirements({
    routes: ['/odd'],
    candidatesFor: () => candidates,
    applyPermissions: async (names) => { applies++; held = new Set(names); return { rejected: [] }; },
    // Needs base_perm plus any other permission at all.
    probe: async () => ({ accessible: held.has('base_perm') && held.size >= 2, missing: [] })
  });
  assert.equal(entry.status, 'unknown');
  assert.match(entry.reason, /almost any extra permission/);
  assert.ok(applies < 40, `the search must stop early, got ${applies} role changes`);
});
