const test = require('node:test');
const assert = require('node:assert/strict');

require('../shared/menu-definitions.js');
const { DATADOG_MENUS, mapPermissionsToMenus, findMenuForHref } = globalThis.DD_SMART_MENU;
const navLinks = require('./fixtures/datadog-nav-links.json');
const { permissions, roles } = require('./fixtures/datadog-permissions.json');

const officialNames = new Set(permissions.map(p => p.name));

test('every Datadog navbar link belongs to a menu', () => {
  const unmatched = navLinks.filter(link => !findMenuForHref(link.href)).map(link => `${link.menu} > ${link.label} (${link.href})`);
  assert.deepEqual(unmatched, []);
});

test('the most specific path wins', () => {
  const cases = {
    '/logs': 'logs',
    '/logs/archive-search': 'logs_archives',
    '/software?lens=Ownership': 'software_catalog',
    '/software?selectedComponent=infrastructure': 'infrastructure',
    '/software?selectedComponent=endpoint': 'apm',
    '/security/overview': 'security',
    '/security/code-security/summary': 'code_security',
    '/security/ai-guard': 'ai_guard',
    '/actions/agents': 'agent_builder',
    '/llm/ai-agents-console': 'agent_console',
    '/organization-settings/users': 'user_management',
    '/organization-settings/teams': 'organization_settings',
    '/check/summary': 'monitors',
    '/network-path': 'network'
  };
  for (const [href, id] of Object.entries(cases)) {
    assert.equal(findMenuForHref(href)?.id, id, href);
  }
});

test('path prefixes stop at segment boundaries', () => {
  assert.equal(findMenuForHref('/cisco'), null);
  assert.equal(findMenuForHref('/events-foo'), null);
  assert.equal(findMenuForHref('https://docs.datadoghq.com/logs'), null);
});

test('every permission pattern matches at least one official permission', () => {
  const { permissionMatches } = globalThis.DD_SMART_MENU;
  const dead = DATADOG_MENUS.flatMap(menu => (menu.permissions || [])
    .filter(pattern => ![...officialNames].some(name => permissionMatches(pattern, name)))
    .map(pattern => `${menu.id}: ${pattern}`));
  assert.deepEqual(dead, []);
});

test('substring look-alikes do not grant unrelated menus', () => {
  // rum_apps_read used to grant Automation, audit_logs_read used to grant Logs.
  const menus = mapPermissionsToMenus(['rum_apps_read', 'network_connections_read', 'audit_logs_read', 'org_connections_read']);
  assert.ok(!menus.includes('automation'));
  assert.ok(!menus.includes('logs'));
  assert.ok(menus.includes('rum'));
  assert.ok(menus.includes('network'));
  assert.ok(menus.includes('audit_trail'));
});

test('admin role sees every menu', () => {
  assert.deepEqual(mapPermissionsToMenus(roles['Datadog Admin Role']).sort(), DATADOG_MENUS.map(m => m.id).sort());
});

test('read only role keeps telemetry and loses admin pages', () => {
  const menus = mapPermissionsToMenus(roles['Datadog Read Only Role']);
  for (const id of ['dashboards', 'logs', 'metrics', 'apm', 'monitors', 'infrastructure']) assert.ok(menus.includes(id), id);
  for (const id of ['user_management', 'service_accounts', 'api_keys']) assert.ok(!menus.includes(id), id);
});

test('menus without a dedicated permission are always visible', () => {
  assert.deepEqual(mapPermissionsToMenus([]).sort(), DATADOG_MENUS.filter(m => m.permissions === null).map(m => m.id).sort());
});
