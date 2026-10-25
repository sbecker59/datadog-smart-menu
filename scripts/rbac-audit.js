#!/usr/bin/env node
/**
 * RBAC audit: measure which permissions each Datadog navbar page needs, on a
 * dedicated TEST organization, and write audit/route-permissions.json.
 *
 * How it works: a temporary role is created and given to a test user (their
 * other roles are removed for the run and restored afterwards). Starting from
 * an empty role, every navbar page is opened as the test user; when Datadog
 * answers 403 "Missing required permission: 'x'", x is granted and the page is
 * retried, until it opens. With --verify-mapping, each permission a menu
 * accepts is then tried alone on that menu's pages.
 *
 * Requirements (all in the test organization):
 *   DD_API_KEY, DD_APP_KEY   admin keys allowed to manage roles (user_access_manage)
 *   DD_SITE                  e.g. datadoghq.eu (default)
 *   --user-id <uuid>         the test user (not an admin), or DD_AUDIT_USER_ID
 *   --state <file>           the test user's browser session (default .auth/audit-user.json),
 *                            saved with: npm run capture:navbar -- --login --save-state .auth/audit-user.json
 *
 * Usage:
 *   npm run audit:rbac                                   # dry run: read-only checks and plan
 *   npm run audit:rbac -- --apply --allowed-org <public_id> [--verify-mapping]
 *   npm run audit:rbac -- --restore                      # restore the test user after a crash
 * Options: --only <path prefix>, --concurrency <n> (default 3), --out <file>,
 *          --resume: keep pages already solved in --out and audit the others,
 *          --settle <seconds> (default 30): wait after each role change, as
 *          Datadog applies it to API calls tens of seconds after current_user.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { siteUrl } = require('./capture-navbar');
const { discoverRequirements, verifyCandidates } = require('./lib/rbac-discovery');

require('../shared/menu-definitions.js');
const { DATADOG_MENUS, findMenuForHref, permissionMatches } = globalThis.DD_SMART_MENU;

const rootDir = path.join(__dirname, '..');
const RESTORE_FILE = path.join(rootDir, 'audit/.restore.json');
const DEFAULT_OUT = path.join(rootDir, 'audit/route-permissions.json');
const ROLE_PREFIX = 'dd-smart-menu-audit-';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i];
  }
  return args;
}

/** API base URL for a Datadog site: app.datadoghq.eu -> api.datadoghq.eu. */
function apiBase(site) {
  const host = new URL(siteUrl(site)).host.replace(/^app\./, '');
  return `https://api.${host}`;
}

/** Permission names reported in a 403 body or a "no access" page text. */
function extractMissingPermissions(text) {
  const names = new Set();
  const patterns = [
    /missing required permissions?:?\s*\[?\s*((?:'?"?[a-z0-9_]+'?"?\s*,?\s*)+)/gi,
    /permissions?\s+['"`]([a-z][a-z0-9_]+)['"`]/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      for (const name of match[1].match(/[a-z][a-z0-9_]+/g) || []) names.add(name);
    }
  }
  return [...names];
}

/**
 * Permission names quoted by display name in a "no permission" sentence, e.g.
 * "Request access to permission Logs Read Data to view this page."
 */
function permissionsFromSentence(sentence, displayNames) {
  let text = ` ${String(sentence || '').toLowerCase().replace(/[.,:;!?()]/g, ' ')} `;
  const found = [];
  // Longest names first, removed once matched, so "Logs Read Data" does not
  // also count as "Logs Read".
  for (const [display, name] of [...displayNames].sort((a, b) => b[0].length - a[0].length)) {
    const needle = ` ${display.toLowerCase()} `;
    if (text.includes(needle)) {
      found.push(name);
      text = text.split(needle).join('  ');
    }
  }
  return found;
}

function createApi({ site, apiKey, appKey, fetchImpl = fetch }) {
  const base = apiBase(site);
  async function call(method, urlPath, body) {
    let res;
    // Retry network errors, rate limits and server errors.
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetchImpl(base + urlPath, {
          method,
          headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
        if ((res.status === 429 || res.status >= 500) && attempt < 5) throw new Error(`HTTP ${res.status}`);
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
        await new Promise(r => setTimeout(r, attempt * 5000));
      }
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    org: async () => (await call('GET', '/api/v1/org')).orgs?.[0] || null,
    user: id => call('GET', `/api/v2/users/${encodeURIComponent(id)}`),
    permissions: async () => (await call('GET', '/api/v2/permissions')).data || [],
    createRole: async name => (await call('POST', '/api/v2/roles', { data: { type: 'roles', attributes: { name } } })).data,
    deleteRole: id => call('DELETE', `/api/v2/roles/${id}`),
    rolePermissions: async id => (await call('GET', `/api/v2/roles/${id}/permissions`)).data || [],
    grant: (roleId, permId) => call('POST', `/api/v2/roles/${roleId}/permissions`, { data: { type: 'permissions', id: permId } }),
    revoke: (roleId, permId) => call('DELETE', `/api/v2/roles/${roleId}/permissions`, { data: { type: 'permissions', id: permId } }),
    addUser: (roleId, userId) => call('POST', `/api/v2/roles/${roleId}/users`, { data: { type: 'users', id: userId } }),
    removeUser: (roleId, userId) => call('DELETE', `/api/v2/roles/${roleId}/users`, { data: { type: 'users', id: userId } })
  };
}

/** Routes to audit: unique navbar links from the fixture. */
function loadRoutes(only) {
  const links = require(path.join(rootDir, 'test/fixtures/datadog-nav-links.json'));
  return [...new Set(links.map(l => l.href))].filter(href => !only || href.startsWith(only)).sort();
}

/** Browser side: open pages as the test user and read their access. */
async function createBrowser({ site, statePath, setupContext, displayNames = new Map() }) {
  if (!fs.existsSync(statePath)) throw new Error(`Test user session not found: ${statePath}. Save it with: npm run capture:navbar -- --login --save-state ${statePath}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: statePath, viewport: { width: 1400, height: 900 } });
  if (setupContext) await setupContext(context); // tests: serve a fake Datadog
  const origin = siteUrl(site);

  // One page kept open on the API origin to read current_user quickly.
  let userPage = null;
  async function currentUser() {
    if (!userPage || userPage.isClosed()) {
      userPage = await context.newPage();
      await userPage.goto(`${origin}/api/v2/current_user`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    return userPage.evaluate(async () => {
      const res = await fetch('/api/v2/current_user', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return { status: res.status, permissions: [] };
      const json = await res.json();
      return {
        status: res.status,
        id: json.data?.id,
        permissions: (json.included || []).filter(i => i.type === 'permissions').map(i => i.attributes?.name).filter(Boolean)
      };
    });
  }

  // Raw 403 responses of the run, for audit/last-run-debug.json.
  const debug = [];

  async function probe(route) {
    const page = await context.newPage();
    const denied = [];
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (response.status() !== 403 || url.origin !== origin || !url.pathname.startsWith('/api/')) return;
      const body = await response.text().catch(() => '');
      denied.push({ api: url.pathname, missing: extractMissingPermissions(body) });
      debug.push({ route, api: url.pathname, body: body.slice(0, 300) });
    });
    try {
      // Retry transient network errors (Wi-Fi change, VPN, DNS) instead of
      // aborting a run that may have lasted hours.
      for (let attempt = 1; ; attempt++) {
        try {
          await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
          break;
        } catch (e) {
          const transient = /net::ERR_|Timeout|timed out/i.test(e.message);
          if (!transient || attempt >= 5) throw e;
          console.warn(`  network error on ${route} (${e.message.split('\n')[0]}), retry ${attempt}/4 in ${attempt * 10} s`);
          await new Promise(r => setTimeout(r, attempt * 10000));
        }
      }
      if (new URL(page.url()).pathname.startsWith('/account/login')) throw new Error('The test user session has expired.');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Only the page content: banners and menus elsewhere are not the page.
      const text = await page.evaluate(() => {
        const main = document.querySelector('#single-page-app_layout_page__main-content, [class*="layout_page__main"], main');
        return (main || document.body)?.innerText || '';
      });
      const match = text.match(/(do not|don't) have (the )?(required )?(permission|access)[^\n]{0,120}|missing (required )?permissions?[^\n]{0,120}|request access[^\n]{0,80}|an error occurred while loading the page/i);
      const notFound = /404:? page not found/i.test(text);
      if (match) debug.push({ route, pageText: match[0].slice(0, 200) });
      // Start of the page content, to tell an empty page from a real one.
      debug.push({ route, contentStart: text.replace(/\s+/g, ' ').trim().slice(0, 300), deniedApis: denied.length });
      return {
        denied,
        notFound,
        pageDenied: !!match,
        pageMissing: match ? [...new Set([...extractMissingPermissions(text), ...permissionsFromSentence(match[0], displayNames)])] : []
      };
    } finally {
      await page.close();
    }
  }

  // Background calls are recognised by the fixed list in rbac-discovery.js
  // (CHROME_APIS). Learning them from a "neutral" page proved unsafe: the
  // profile page also calls product APIs such as the logs facets.
  const noise = new Set();

  return { currentUser, probe, noise: () => noise, debug, close: () => browser.close() };
}

function maskEmail(email) {
  return String(email || '').replace(/^(.).*(@.*)$/, '$1***$2');
}

async function restoreUser(api, log = console.log) {
  if (!fs.existsSync(RESTORE_FILE)) {
    log('Nothing to restore.');
    return;
  }
  const state = JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8'));
  for (const roleId of state.previousRoleIds) await api.addUser(roleId, state.userId).catch(e => log(`  re-add role ${roleId}: ${e.message}`));
  if (state.auditRoleId) {
    await api.removeUser(state.auditRoleId, state.userId).catch(() => {});
    await api.deleteRole(state.auditRoleId).catch(e => log(`  delete audit role: ${e.message}`));
  }
  fs.rmSync(RESTORE_FILE);
  log(`Test user restored (${state.previousRoleIds.length} role(s)), audit role deleted.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const site = process.env.DD_SITE;
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) throw new Error('Set DD_API_KEY and DD_APP_KEY (admin keys of the TEST organization).');
  const api = createApi({ site, apiKey, appKey });

  if (args.restore) return restoreUser(api);
  if (fs.existsSync(RESTORE_FILE)) throw new Error(`A previous run did not finish (${path.relative(rootDir, RESTORE_FILE)}). Run with --restore first.`);

  const userId = args['user-id'] || process.env.DD_AUDIT_USER_ID;
  if (!userId) throw new Error('Pass the test user ID with --user-id <uuid> (or DD_AUDIT_USER_ID).');
  const statePath = path.resolve(args.state || '.auth/audit-user.json');
  const out = path.resolve(args.out || DEFAULT_OUT);
  // Pages already solved by an earlier (possibly interrupted) run.
  const FINAL = new Set(['open', 'requires', 'not-found']);
  const previous = args.resume && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const kept = (previous?.routes || []).filter(e => FINAL.has(e.status));
  const routes = loadRoutes(args.only).filter(r => !kept.some(e => e.route === r));
  if (args.resume) console.log(`Resume     : ${kept.length} page(s) already solved in ${path.relative(process.cwd(), out)}, ${routes.length} left`);

  // Read-only checks (also run in dry-run mode).
  const org = await api.org();
  const user = await api.user(userId);
  const previousRoleIds = (user.data?.relationships?.roles?.data || []).map(r => r.id);
  const allPermissions = await api.permissions();
  const permIdByName = new Map(allPermissions.map(p => [p.attributes.name, p.id]));
  const displayNames = new Map(allPermissions.filter(p => p.attributes.display_name).map(p => [p.attributes.display_name, p.attributes.name]));

  const browser = await createBrowser({ site, statePath, displayNames });
  try {
    const me = await browser.currentUser();
    if (me.status !== 200) throw new Error(`The test user session does not work (current_user -> ${me.status}). Save it again.`);
    if (me.id !== userId) throw new Error(`The saved session belongs to user ${me.id}, not to --user-id ${userId}.`);
    if (me.permissions.includes('user_access_manage')) {
      throw new Error('The test user can manage users (admin). Use a non-admin test user so the audit cannot lock anyone out.');
    }

    // Some sessions may not expose permissions in current_user: fall back to a delay.
    const exposesPermissions = me.permissions.length > 0 || previousRoleIds.length === 0;
    if (!exposesPermissions) console.warn('Warning: current_user does not list permissions; waiting a fixed 15 s after each role change.');

    console.log(`Organization : ${org?.name} (public_id ${org?.public_id})`);
    console.log(`Test user    : ${maskEmail(user.data?.attributes?.email)} with ${previousRoleIds.length} role(s), ${me.permissions.length} permission(s)`);
    console.log(`Permissions  : ${allPermissions.length} in this organization`);
    console.log(`Routes       : ${routes.length} navbar pages${args.only ? ` under ${args.only}` : ''}`);

    if (!args.apply) {
      console.log('\nDry run: nothing changed. To run the audit on this TEST organization:');
      console.log(`  npm run audit:rbac -- --apply --allowed-org ${org?.public_id} --user-id ${userId}${args['verify-mapping'] ? ' --verify-mapping' : ''}`);
      return;
    }
    if (!org || args['allowed-org'] !== org.public_id) {
      throw new Error(`--allowed-org must be this organization's public_id (${org?.public_id}). This guards against running on the wrong org.`);
    }

    // Mutations start here: always restore the test user afterwards.
    const role = await api.createRole(`${ROLE_PREFIX}${Date.now()}`);
    fs.mkdirSync(path.dirname(RESTORE_FILE), { recursive: true });
    fs.writeFileSync(RESTORE_FILE, JSON.stringify({ userId, previousRoleIds, auditRoleId: role.id }, null, 1));
    const onSignal = () => { console.log('\nInterrupted: restoring the test user...'); restoreUser(api).finally(() => process.exit(130)); };
    process.once('SIGINT', onSignal);

    try {
      await api.addUser(role.id, userId);
      for (const roleId of previousRoleIds) await api.removeUser(roleId, userId);

      let current = new Set((await api.rolePermissions(role.id)).map(p => p.attributes.name));
      // Without "Minimal Access Roles", Datadog keeps some restricted
      // permissions in every role: they form a baseline every user holds.
      const baseline = new Set();
      // Datadog applies role changes to API authorization later than it shows
      // them in current_user: without this wait, probes see the previous role.
      const settleMs = Number(args.settle ?? 30) * 1000;
      let firstChange = true;
      const settle = async () => {
        const ms = firstChange ? Math.max(settleMs, 60000) : settleMs;
        if (firstChange) console.log(`  waiting ${ms / 1000} s after each role change for Datadog to apply it (--settle)`);
        firstChange = false;
        await new Promise(r => setTimeout(r, ms));
      };
      // Permissions current_user never lists (restricted ones): learned once.
      const hiddenInSession = new Set();
      async function applyPermissions(names) {
        const target = new Set(names);
        const rejected = names.filter(n => !permIdByName.has(n));
        for (const name of current) {
          if (target.has(name) || baseline.has(name)) continue;
          try {
            await api.revoke(role.id, permIdByName.get(name));
          } catch (e) {
            if (!/cannot be removed/i.test(e.message)) throw e;
            baseline.add(name);
            console.log(`  ${name} cannot be removed in this org: kept as baseline`);
          }
        }
        for (const name of target) {
          if (current.has(name) || !permIdByName.has(name)) continue;
          try { await api.grant(role.id, permIdByName.get(name)); } catch (e) { rejected.push(name); }
        }
        current = new Set((await api.rolePermissions(role.id)).map(p => p.attributes.name));
        // Wait until the test user's session sees exactly these permissions.
        // current_user does not list the baseline (restricted) permissions.
        const visible = list => [...new Set(list)].filter(p => !baseline.has(p) && !hiddenInSession.has(p)).sort().join(',');
        const expected = visible(current);
        if (!exposesPermissions) {
          await settle();
          return { rejected };
        }
        let seen = null;
        let synced = false;
        for (let i = 0; i < 10 && !synced; i++) {
          seen = await browser.currentUser();
          synced = visible(seen.permissions) === expected;
          if (!synced) await new Promise(r => setTimeout(r, 2000));
        }
        if (!synced) {
          const have = new Set(seen?.permissions || []);
          const missingInSession = [...current].filter(p => !have.has(p) && !baseline.has(p) && !hiddenInSession.has(p));
          const extraInSession = [...have].filter(p => !current.has(p));
          if (extraInSession.length === 0) {
            // The role holds them but current_user does not list them: do not wait for them again.
            missingInSession.forEach(p => hiddenInSession.add(p));
            console.log(`  not listed by current_user, ignored when waiting from now on: ${missingInSession.join(', ')}`);
          } else {
            console.warn(`  session permissions differ from the role after 20 s (missing: ${missingInSession.slice(0, 5).join(', ') || '-'}; extra: ${extraInSession.slice(0, 5).join(', ')}); continuing`);
          }
        }
        await settle();
        return { rejected };
      }

      const log = msg => console.log(msg);
      const concurrency = Number(args.concurrency || 3);
      const universe = allPermissions.map(p => p.attributes.name);
      const docGroup = new Map(require(path.join(rootDir, 'test/fixtures/datadog-permissions.json')).permissions.map(p => [p.name, p.group]));
      function candidatesFor(route) {
        const menu = findMenuForHref(route);
        if (!menu || !menu.permissions) return [];
        const own = universe.filter(n => menu.permissions.some(pattern => permissionMatches(pattern, n)));
        const groups = new Set(own.map(n => docGroup.get(n)).filter(Boolean));
        return [...new Set([...own, ...universe.filter(n => groups.has(docGroup.get(n)))])].filter(n => !baseline.has(n));
      }
      const learned = new Set(); // APIs found denied on most pages, shared by both phases
      // Last resort for pages still denied with their menu's permissions: every
      // permission of the org (found by halving, so about log2(n) changes each).
      const widen = () => universe.filter(n => !baseline.has(n));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      function writeMatrix(entries, partial) {
        const solved = new Set(entries.map(e => e.route));
        const result = [
          ...kept.filter(e => !solved.has(e.route)),
          ...entries.map(e => ({ ...e, menu: findMenuForHref(e.route)?.id || null }))
        ].sort((a, b) => a.route.localeCompare(b.route));
        fs.writeFileSync(out, JSON.stringify({
          site: siteUrl(site),
          measuredAt: new Date().toISOString().slice(0, 10),
          partial,
          verifiedMapping: !!args['verify-mapping'],
          // Held by every role in this org; "open" pages may rely on them.
          baselinePermissions: [...new Set([...(previous?.baselinePermissions || []), ...baseline])].sort(),
          routes: result
        }, null, 1) + '\n');
        return result;
      }
      // Raw 403 bodies and "no permission" texts, to understand unknown pages (not committed).
      const debugFile = path.join(path.dirname(out), 'last-run-debug.json');
      // Saved after each step, so an interrupted run can continue with --resume.
      const checkpoint = (entries) => {
        writeMatrix(entries, true);
        fs.writeFileSync(debugFile, JSON.stringify(browser.debug, null, 1) + '\n');
      };
      let entries = await discoverRequirements({ routes, applyPermissions, probe: browser.probe, noise: browser.noise, learned, candidatesFor, widen, concurrency, log, onCheckpoint: checkpoint });

      if (args['verify-mapping']) {
        const universe = allPermissions.map(p => p.attributes.name);
        const candidates = new Map();
        for (const menu of DATADOG_MENUS.filter(m => m.permissions)) {
          const menuRoutes = routes.filter(r => findMenuForHref(r)?.id === menu.id);
          for (const perm of universe.filter(n => menu.permissions.some(p => permissionMatches(p, n)))) {
            candidates.set(perm, [...new Set([...(candidates.get(perm) || []), ...menuRoutes])]);
          }
        }
        entries = await verifyCandidates({ entries, candidates, applyPermissions, probe: browser.probe, noise: browser.noise, learned, concurrency, log });
      }

      const result = writeMatrix(entries, false);
      const counts = result.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
      console.log(`\nWrote ${path.relative(process.cwd(), out)}: ${JSON.stringify(counts)}`);
      if (baseline.size) console.log(`Baseline permissions (always held): ${[...baseline].sort().join(', ')}`);
      fs.writeFileSync(debugFile, JSON.stringify(browser.debug, null, 1) + '\n');
      console.log(`Diagnostics: ${path.relative(process.cwd(), debugFile)}`);
    } finally {
      process.removeListener('SIGINT', onSignal);
      await restoreUser(api);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { apiBase, extractMissingPermissions, permissionsFromSentence, createApi, loadRoutes, createBrowser };
