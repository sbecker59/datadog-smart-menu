/**
 * Compare the extension's menu decisions with an audited route -> permissions
 * matrix, on minimal counterexamples and on randomly generated roles.
 *
 * A link is "shown" when the extension allows its menu; it is "accessible"
 * when the route is open or one of its verified sufficient permission sets is
 * held. Mismatch types:
 *   - shown-but-denied: the extension shows a link that would answer 403;
 *   - hidden-but-accessible: the extension hides a page the user can open.
 *
 * `hideEmptyPages`: pages that open with no product permission (status
 * "open": empty or onboarding pages) may stay hidden from users without the
 * product's permission. Such cases are returned in `accepted`, not as
 * mismatches. Pages that a permission outside the table would open are
 * still mismatches.
 *
 * `baseline` lists permissions every role holds in the audited org (restricted
 * permissions Datadog does not let you remove): they are added to every role.
 */

/** Small seeded PRNG (mulberry32) so failures are reproducible. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isSubset = (a, b) => a.every(x => b.has(x));

function isAccessible(entry, held) {
  if (entry.status === 'open') return true;
  return (entry.sufficient || []).some(set => isSubset(set, held));
}

/** Expand menu permission patterns ("logs_*") to concrete permission names. */
function expandPatterns(patterns, universe, permissionMatches) {
  return universe.filter(name => patterns.some(pattern => permissionMatches(pattern, name)));
}

function compareMapping({ matrix, menus, universe, baseline = [], hideEmptyPages = false, iterations = 2000, seed = 42, maxRolePermissions = 30 }) {
  const { mapPermissionsToMenus, findMenuForHref, permissionMatches } = menus;
  const patternsOf = menus.permissionPatterns || (menu => (menu.permissions || []).flat());
  const entries = matrix.filter(e => e.status === 'open' || e.status === 'requires')
    .map(e => ({ ...e, menu: findMenuForHref(e.route) }))
    .filter(e => e.menu);

  const mismatches = new Map(); // route|type -> mismatch
  const accepted = new Map(); // route -> menu id, see hideEmptyPages
  const record = (entry, type, role, source) => {
    const id = `${entry.route}|${type}`;
    const current = mismatches.get(id);
    if (!current) {
      mismatches.set(id, { route: entry.route, menuId: entry.menu.id, type, example: [...role].sort(), count: 1, source });
    } else {
      current.count++;
      if (role.length < current.example.length) current.example = [...role].sort();
    }
  };
  const check = (rawRole, source) => {
    const role = [...new Set([...rawRole, ...baseline])];
    const held = new Set(role);
    const shown = new Set(mapPermissionsToMenus(role));
    for (const entry of entries) {
      const isShown = shown.has(entry.menu.id);
      const ok = isAccessible(entry, held);
      // Examples list the permissions on top of the baseline.
      const example = rawRole.filter(p => !baseline.includes(p));
      if (isShown && !ok) record(entry, 'shown-but-denied', example, source);
      if (!isShown && ok) {
        if (hideEmptyPages && entry.status === 'open') accepted.set(entry.route, entry.menu.id);
        else record(entry, 'hidden-but-accessible', example, source);
      }
    }
  };

  // Minimal counterexamples: each verified sufficient set alone, and each
  // permission a menu accepts alone.
  for (const entry of entries) {
    for (const set of entry.sufficient || []) check(set, 'sufficient-set');
    if (entry.status === 'open') check([], 'empty-role');
    for (const perm of entry.menu.permissions ? expandPatterns(patternsOf(entry.menu), universe, permissionMatches) : []) {
      check([perm], 'menu-permission');
    }
  }

  // Random roles, biased toward permissions that matter for the menus.
  const relevant = [...new Set(entries.flatMap(e => [
    ...(e.sufficient || []).flat(),
    ...(e.menu.permissions ? expandPatterns(patternsOf(e.menu), universe, permissionMatches) : [])
  ]))];
  const random = prng(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  for (let i = 0; i < iterations; i++) {
    const size = Math.floor(random() * (Math.min(maxRolePermissions, new Set(universe).size) + 1));
    const role = new Set();
    while (role.size < size) role.add(random() < 0.7 && relevant.length ? pick(relevant) : pick(universe));
    check([...role], 'random');
  }

  return {
    routes: entries.length,
    roles: iterations,
    mismatches: [...mismatches.values()].sort((a, b) => a.menuId.localeCompare(b.menuId) || a.route.localeCompare(b.route)),
    accepted: [...accepted].map(([route, menuId]) => ({ route, menuId })).sort((a, b) => a.route.localeCompare(b.route))
  };
}

function formatMismatches(mismatches, limit = 40) {
  return mismatches.slice(0, limit).map(m =>
    `${m.type.padEnd(22)} ${m.menuId.padEnd(24)} ${m.route}  e.g. role [${m.example.join(', ') || 'no permission'}]`
  ).join('\n') + (mismatches.length > limit ? `\n... ${mismatches.length - limit} more` : '');
}

module.exports = { compareMapping, formatMismatches, isAccessible, prng };
