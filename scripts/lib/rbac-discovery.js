/**
 * Discover, for each navbar route, a set of permissions that is enough to
 * open it, by changing the permissions of a test role and probing the pages.
 *
 * Pure orchestration: Datadog access is injected, so it can be tested offline.
 *
 *   applyPermissions(names) -> Promise<{ rejected: string[] }>
 *       Make the test role hold exactly `names` (and wait until it applies).
 *   probe(route) -> Promise<{ accessible: boolean, missing: string[], evidence?: object }>
 *       Open the page as the test user. `missing` lists permission names
 *       Datadog reported as missing (403 "Missing required permission").
 */

const key = perms => [...perms].sort().join(',');
const union = (a, b) => [...new Set([...a, ...b])].sort();
const isSubset = (a, b) => a.every(x => b.includes(x));

async function probeAll(routes, probe, concurrency) {
  const results = new Map();
  let next = 0;
  async function worker() {
    while (next < routes.length) {
      const route = routes[next++];
      results.set(route, await probe(route));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, routes.length)) }, worker));
  return results;
}

/**
 * Phase 1: start from an empty role, then grant what each page reports as
 * missing until it opens. Routes needing the same set share one role update.
 */
async function discoverRequirements({ routes, applyPermissions, probe, maxRounds = 6, concurrency = 3, log = () => {} }) {
  const entries = new Map(routes.map(route => [route, { route, status: 'pending', requires: [], sufficient: [], insufficient: [], evidence: null }]));

  const settle = (entry, result, perms) => {
    entry.evidence = result.evidence || null;
    if (result.accessible) {
      entry.status = perms.length === 0 ? 'open' : 'requires';
      entry.requires = [...perms].sort();
      entry.sufficient = perms.length === 0 ? [] : [[...perms].sort()];
      return null;
    }
    const added = (result.missing || []).filter(p => !perms.includes(p));
    if (added.length === 0) {
      entry.status = 'unknown';
      entry.reason = perms.length === 0
        ? 'denied without naming a missing permission'
        : `still denied with [${perms.join(', ')}] and no new missing permission`;
      entry.requires = [...perms].sort();
      return null;
    }
    return union(perms, added);
  };

  // Round 0: empty role.
  log('Round 0: empty role');
  let rejected = (await applyPermissions([])).rejected || [];
  let pending = new Map(); // key -> { perms, routes }
  const round0 = await probeAll(routes, probe, concurrency);
  for (const route of routes) {
    const next = settle(entries.get(route), round0.get(route), []);
    if (next) {
      const k = key(next);
      if (!pending.has(k)) pending.set(k, { perms: next, routes: [] });
      pending.get(k).routes.push(route);
    }
  }

  for (let round = 1; round <= maxRounds && pending.size > 0; round++) {
    log(`Round ${round}: ${pending.size} permission set(s), ${[...pending.values()].reduce((n, g) => n + g.routes.length, 0)} route(s)`);
    const nextPending = new Map();
    for (const { perms, routes: groupRoutes } of pending.values()) {
      ({ rejected } = await applyPermissions(perms));
      if (rejected && rejected.length) {
        for (const route of groupRoutes) {
          Object.assign(entries.get(route), { status: 'unknown', requires: perms, reason: `could not grant [${rejected.join(', ')}]` });
        }
        continue;
      }
      const results = await probeAll(groupRoutes, probe, concurrency);
      for (const route of groupRoutes) {
        const next = settle(entries.get(route), results.get(route), perms);
        if (next) {
          const k = key(next);
          if (!nextPending.has(k)) nextPending.set(k, { perms: next, routes: [] });
          nextPending.get(k).routes.push(route);
        }
      }
    }
    pending = nextPending;
  }

  for (const { perms, routes: left } of pending.values()) {
    for (const route of left) {
      Object.assign(entries.get(route), { status: 'unknown', requires: perms, reason: `not resolved after ${maxRounds} rounds` });
    }
  }
  return [...entries.values()];
}

/**
 * Phase 2 (optional): check the extension's "any one of these permissions"
 * model. For each permission p a menu accepts, give the role only p and probe
 * the menu's routes whose discovered set is not already covered by p.
 *
 *   candidates: Map<permission, string[] routes>
 */
async function verifyCandidates({ entries, candidates, applyPermissions, probe, concurrency = 3, log = () => {} }) {
  const byRoute = new Map(entries.map(e => [e.route, e]));
  let done = 0;
  for (const [perm, routes] of candidates) {
    done++;
    const targets = routes.filter(r => byRoute.get(r)?.status === 'requires' && !isSubset(byRoute.get(r).requires, [perm]));
    if (targets.length === 0) continue;
    log(`Verify ${done}/${candidates.size}: [${perm}] on ${targets.length} route(s)`);
    const { rejected } = await applyPermissions([perm]);
    if (rejected && rejected.length) continue;
    const results = await probeAll(targets, probe, concurrency);
    for (const route of targets) {
      const entry = byRoute.get(route);
      const list = results.get(route).accessible ? entry.sufficient : entry.insufficient;
      if (!list.some(s => key(s) === perm)) list.push([perm]);
    }
  }
  return entries;
}

module.exports = { discoverRequirements, verifyCandidates, isSubset, union };
