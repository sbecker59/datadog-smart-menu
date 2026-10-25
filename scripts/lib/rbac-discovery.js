/**
 * Discover, for each navbar route, a set of permissions that is enough to
 * open it, by changing the permissions of a test role and probing the pages.
 *
 * Pure orchestration: Datadog access is injected, so it can be tested offline.
 *
 *   applyPermissions(names) -> Promise<{ rejected: string[] }>
 *       Make the test role hold exactly `names` (and wait until it applies).
 *   probe(route) -> Promise<{ denied: [{ api, missing }], pageDenied, pageMissing, evidence }>
 *       Open the page as the test user and report every API call answered
 *       403 (with the permission names Datadog said were missing) and whether
 *       the page itself shows a "no permission" message.
 *       (A simplified { accessible, missing } result is accepted too.)
 *   noise() -> Set<string>   API paths to ignore (denied on every page, e.g.
 *       org info or the incidents banner), refreshed by the caller.
 */

// Above this share of a batch, an API denied everywhere is page chrome, not
// the page's own data.
const NOISE_RATIO = 0.6;
const MIN_BATCH_FOR_NOISE = 10;

/** Turn a raw probe result into { accessible, missing }, ignoring noise APIs. */
function classify(result, noise) {
  if (!result.denied) return result;
  const denied = result.denied.filter(d => !noise.has(d.api));
  const missing = [...new Set([...denied.flatMap(d => d.missing || []), ...(result.pageDenied ? result.pageMissing || [] : [])])];
  return {
    accessible: denied.length === 0 && !result.pageDenied,
    missing,
    evidence: {
      ...(result.evidence || {}),
      deniedApis: [...new Set(denied.map(d => d.api))].slice(0, 10),
      ignoredApis: [...new Set(result.denied.filter(d => noise.has(d.api)).map(d => d.api))].slice(0, 10),
      pageDenied: !!result.pageDenied
    }
  };
}

const key = perms => [...perms].sort().join(',');
const union = (a, b) => [...new Set([...a, ...b])].sort();
const isSubset = (a, b) => a.every(x => b.includes(x));

async function probeAll(routes, probe, concurrency, { noise = () => new Set(), learned = new Set(), log = () => {} } = {}) {
  const raw = new Map();
  let next = 0;
  let done = 0;
  const started = Date.now();
  async function worker() {
    while (next < routes.length) {
      const route = routes[next++];
      raw.set(route, await probe(route));
      done++;
      if (done % 20 === 0 || done === routes.length) {
        log(`    probed ${done}/${routes.length} page(s) (${Math.round((Date.now() - started) / 1000)} s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, routes.length)) }, worker));

  // Noise: APIs from the caller, plus APIs denied on most pages of this batch.
  const ignored = new Set([...noise(), ...learned]);
  if (routes.length >= MIN_BATCH_FOR_NOISE) {
    const counts = new Map();
    for (const result of raw.values()) {
      for (const api of new Set((result.denied || []).map(d => d.api))) counts.set(api, (counts.get(api) || 0) + 1);
    }
    const frequent = [...counts].filter(([api, n]) => n / routes.length > NOISE_RATIO && !ignored.has(api)).map(([api]) => api);
    if (frequent.length) log(`    ignoring API(s) denied on most pages: ${frequent.join(', ')}`);
    // Remember them for later, smaller batches of the same run.
    frequent.forEach(api => { ignored.add(api); learned.add(api); });
  }
  return new Map([...raw].map(([route, result]) => [route, classify(result, ignored)]));
}

/**
 * Phase 1: start from an empty role, then grant what each page reports as
 * missing until it opens. Routes needing the same set share one role update.
 */
async function discoverRequirements({ routes, applyPermissions, probe, noise, learned = new Set(), maxRounds = 6, concurrency = 3, log = () => {} }) {
  const probeOptions = { noise, learned, log };
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
  const round0 = await probeAll(routes, probe, concurrency, probeOptions);
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
      const results = await probeAll(groupRoutes, probe, concurrency, probeOptions);
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
async function verifyCandidates({ entries, candidates, applyPermissions, probe, noise, learned = new Set(), concurrency = 3, log = () => {} }) {
  const byRoute = new Map(entries.map(e => [e.route, e]));
  let done = 0;
  for (const [perm, routes] of candidates) {
    done++;
    const targets = routes.filter(r => byRoute.get(r)?.status === 'requires' && !isSubset(byRoute.get(r).requires, [perm]));
    if (targets.length === 0) continue;
    log(`Verify ${done}/${candidates.size}: [${perm}] on ${targets.length} route(s)`);
    const { rejected } = await applyPermissions([perm]);
    if (rejected && rejected.length) continue;
    const results = await probeAll(targets, probe, concurrency, { noise, learned, log });
    for (const route of targets) {
      const entry = byRoute.get(route);
      const list = results.get(route).accessible ? entry.sufficient : entry.insufficient;
      if (!list.some(s => key(s) === perm)) list.push([perm]);
    }
  }
  return entries;
}

module.exports = { discoverRequirements, verifyCandidates, classify, isSubset, union };
