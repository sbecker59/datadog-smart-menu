/**
 * Check the extension's menu decisions against the audited matrix
 * (audit/route-permissions.json, produced by npm run audit:rbac) on minimal
 * counterexamples and thousands of random custom roles.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('../shared/menu-definitions.js');
const { compareMapping, formatMismatches } = require('../scripts/lib/rbac-compare');
const { permissions } = require('./fixtures/datadog-permissions.json');

const MATRIX = path.join(__dirname, '..', 'audit', 'route-permissions.json');
const hasMatrix = fs.existsSync(MATRIX);

test('menus match the audited route permissions for random custom roles', {
  skip: hasMatrix ? false : 'no audit/route-permissions.json yet: run npm run audit:rbac on a test organization'
}, (t) => {
  const { routes: matrix, baselinePermissions = [] } = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const result = compareMapping({
    matrix,
    baseline: baselinePermissions,
    // Accepted exception: pages that open empty without any product
    // permission stay hidden from users who lack the product's permission.
    hideEmptyPages: true,
    menus: globalThis.DD_SMART_MENU,
    universe: permissions.map(p => p.name),
    iterations: 5000,
    seed: 20261025
  });
  assert.ok(result.routes > 0, 'the matrix has no usable route');
  if (result.accepted.length) {
    t.diagnostic(`${result.accepted.length} empty page(s) kept hidden on purpose: ${result.accepted.map(a => a.route).join(', ')}`);
  }
  assert.equal(result.mismatches.length, 0,
    `${result.mismatches.length} link(s) shown or hidden wrongly over ${result.roles} random roles:\n${formatMismatches(result.mismatches)}`);
});
