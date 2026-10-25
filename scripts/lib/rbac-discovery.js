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

// Background calls made by every Datadog page (org info, incidents banner,
// Cmd+K, notifications, on-call, audit config): never the page's own data.
const CHROME_APIS = [
  /^\/api\/v1\/org\/[^/]+$/,
  /^\/api\/v2\/incidents\/search-incidents$/,
  /^\/api\/ui\/cmd-k\//,
  /^\/api\/v1\/audit\/config$/,
  /^\/api\/unstable\/on-call\/notification-rules\//,
  /^\/api\/ui\/on-call\/org-settings\/seats\//,
  /^\/api\/v2\/notifications\/notify\//,
  /^\/api\/ui\/billing\/seats\//
];
const isChromeApi = api => CHROME_APIS.some(re => re.test(api));

// Above this share of a batch, an API denied everywhere is page chrome, not
// the page's own data.
const NOISE_RATIO = 0.6;
const MIN_BATCH_FOR_NOISE = 30;

/** Turn a raw probe result into { accessible, missing }, ignoring noise APIs. */
function classify(result, noise) {
  if (!result.denied) return result;
  if (result.notFound) return { accessible: false, notFound: true, missing: [], evidence: { notFound: true } };
  const ignore = api => noise.has(api) || isChromeApi(api);
  const denied = result.denied.filter(d => !ignore(d.api));
  const missing = [...new Set([...denied.flatMap(d => d.missing || []), ...(result.pageDenied ? result.pageMissing || [] : [])])];
  return {
    accessible: denied.length === 0 && !result.pageDenied,
    missing,
    evidence: {
      ...(result.evidence || {}),
      deniedApis: [...new Set(denied.map(d => d.api))].slice(0, 10),
      ignoredApis: [...new Set(result.denied.filter(d => ignore(d.api)).map(d => d.api))].slice(0, 10),
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
/**
 * Datadog's 403 bodies rarely name the missing permission. For pages still
 * denied, search among candidate permissions (the menu's permissions and
 * their documentation group; if that is not enough, every permission of the
 * org via `widen`):
 *   1. grant every candidate: still denied -> try the wider set, else report
 *      a permission outside the candidates;
 *   2. find the necessary permissions by halving: remove half of the
 *      candidates; if the page still opens none of them is needed, otherwise
 *      split that half again. About log2(n) role changes per necessary
 *      permission instead of n;
 *   3. confirm the necessary set alone (and counter-check each permission);
 *      when it is not enough, look for single extra permissions that complete
 *      it ("one of these" alternatives), again by halving.
 * Role changes are slow (Datadog applies them tens of seconds later), so the
 * number of applyPermissions calls is what matters.
 */
async function eliminate({ entries, routes, candidates, widen, applyPermissions, probeAll: probeGroup, log }) {
  const set = (route, fields) => Object.assign(entries.get(route), fields);
  let C = [...new Set(candidates)].sort();
  if (C.length === 0 && !widen) {
    routes.forEach(r => set(r, { status: 'unknown', reason: 'denied, and no candidate permission to try' }));
    return;
  }

  // 1. Everything granted (then the wider set for pages still denied).
  let reachable = [];
  if (C.length) {
    log(`  Elimination over ${C.length} candidate permission(s) for ${routes.length} page(s)`);
    await applyPermissions(C);
    const all = await probeGroup(routes);
    reachable = routes.filter(r => all.get(r).accessible);
    const denied = routes.filter(r => !all.get(r).accessible);
    if (denied.length && widen) {
      const wider = [...new Set([...C, ...widen(denied[0])])].sort();
      log(`  ${denied.length} page(s) still denied: widening to ${wider.length} permission(s)`);
      await eliminate({ entries, routes: denied, candidates: wider, applyPermissions, probeAll: probeGroup, log });
    } else {
      for (const r of denied) {
        set(r, { status: 'unknown', requires: C, reason: `denied even with all ${C.length} candidate permission(s): the page needs a permission outside them`, evidence: all.get(r).evidence });
      }
    }
  } else {
    return eliminate({ entries, routes, candidates: widen(routes[0]), applyPermissions, probeAll: probeGroup, log });
  }
  if (reachable.length === 0) return;

  // 2. Necessary permissions, by halving.
  const necessary = new Map(reachable.map(r => [r, new Set()]));
  async function findNecessary(subset, pages) {
    if (subset.length === 0 || pages.length === 0) return;
    log(`    without ${subset.length === 1 ? subset[0] : `${subset.length} permissions (${subset[0]}...)`}`);
    await applyPermissions(C.filter(p => !subset.includes(p)));
    const results = await probeGroup(pages);
    const broken = pages.filter(r => !results.get(r).accessible);
    if (broken.length === 0) return;
    if (subset.length === 1) {
      broken.forEach(r => necessary.get(r).add(subset[0]));
      return;
    }
    const half = Math.ceil(subset.length / 2);
    await findNecessary(subset.slice(0, half), broken);
    await findNecessary(subset.slice(half), broken);
  }
  if (C.length === 1) reachable.forEach(r => necessary.get(r).add(C[0]));
  else {
    const half = Math.ceil(C.length / 2);
    await findNecessary(C.slice(0, half), reachable);
    await findNecessary(C.slice(half), reachable);
  }

  // 3. Confirm each necessary set alone, or complete it with alternatives.
  const groups = new Map();
  for (const r of reachable) {
    const S = [...necessary.get(r)].sort();
    if (!groups.has(key(S))) groups.set(key(S), { S, routes: [] });
    groups.get(key(S)).routes.push(r);
  }
  for (const { S, routes: group } of groups.values()) {
    let opened = [];
    let incomplete = group;
    if (S.length > 0) {
      await applyPermissions(S);
      const results = await probeGroup(group);
      opened = group.filter(r => results.get(r).accessible);
      incomplete = group.filter(r => !results.get(r).accessible);
    }

    if (opened.length) {
      // Counter-check: remove each permission of S again, alone. One flaky
      // probe during the search must not make a permission "necessary".
      const confirmed = new Map(opened.map(r => [r, new Set(S)]));
      for (const perm of S) {
        log(`    check ${perm} is needed`);
        await applyPermissions(S.filter(p => p !== perm));
        const check = await probeGroup(opened);
        opened.filter(r => check.get(r).accessible).forEach(r => confirmed.get(r).delete(perm));
      }
      for (const r of opened) {
        const finalSet = [...confirmed.get(r)].sort();
        if (finalSet.length === S.length) {
          set(r, { status: 'requires', requires: S, sufficient: [S], reason: undefined });
          continue;
        }
        await applyPermissions(finalSet);
        const ok = (await probeGroup([r])).get(r).accessible;
        set(r, ok
          ? { status: 'requires', requires: finalSet, sufficient: [finalSet], reason: undefined }
          : { status: 'requires', requires: S, sufficient: [S], reason: `counter-check removed [${S.filter(p => !finalSet.includes(p)).join(', ')}] but the page does not open without them` });
      }
    }
    if (incomplete.length === 0) continue;

    // S is not enough on its own: the page also needs one permission among
    // several. Find every single permission that completes S, by halving.
    const others = C.filter(p => !S.includes(p));
    const alternatives = new Map(incomplete.map(r => [r, []]));
    async function findAlternatives(subset, pages) {
      if (subset.length === 0 || pages.length === 0) return;
      log(`    with [${S.join(', ') || 'baseline'}] + ${subset.length === 1 ? subset[0] : `${subset.length} permissions (${subset[0]}...)`}`);
      await applyPermissions([...S, ...subset]);
      const results = await probeGroup(pages);
      const ok = pages.filter(r => results.get(r).accessible);
      if (ok.length === 0) return;
      if (subset.length === 1) {
        ok.forEach(r => alternatives.get(r).push([...S, subset[0]].sort()));
        return;
      }
      const half = Math.ceil(subset.length / 2);
      await findAlternatives(subset.slice(0, half), ok);
      await findAlternatives(subset.slice(half), ok);
    }
    await findAlternatives(others, incomplete);
    for (const r of incomplete) {
      const alts = alternatives.get(r);
      set(r, alts.length
        ? { status: 'requires', requires: alts[0], sufficient: alts, reason: undefined }
        : { status: 'requires', requires: C, sufficient: [C], reason: `opens with all candidates; [${S.join(', ') || 'no permission'}] plus any single other one is not enough: not minimized` });
    }
  }
}

async function discoverRequirements({ routes, applyPermissions, probe, noise, learned = new Set(), candidatesFor, widen, maxRounds = 6, concurrency = 3, log = () => {} }) {
  const probeOptions = { noise, learned, log };
  const entries = new Map(routes.map(route => [route, { route, status: 'pending', requires: [], sufficient: [], insufficient: [], evidence: null }]));

  const settle = (entry, result, perms) => {
    entry.evidence = result.evidence || null;
    if (result.notFound) {
      entry.status = 'not-found';
      entry.reason = 'page not available in this organization (404)';
      return null;
    }
    if (result.accessible) {
      entry.status = perms.length === 0 ? 'open' : 'requires';
      entry.requires = [...perms].sort();
      entry.sufficient = perms.length === 0 ? [] : [[...perms].sort()];
      return null;
    }
    const added = (result.missing || []).filter(p => !perms.includes(p));
    if (added.length === 0) {
      entry.status = 'unknown';
      entry.needsSearch = true;
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

  // Pages denied without a named permission: search by elimination.
  if (candidatesFor) {
    const groups = new Map();
    for (const entry of entries.values()) {
      if (!entry.needsSearch) continue;
      const C = union(entry.requires, candidatesFor(entry.route) || []);
      if (!groups.has(key(C))) groups.set(key(C), { C, routes: [] });
      groups.get(key(C)).routes.push(entry.route);
    }
    if (groups.size) log(`Elimination: ${groups.size} group(s) of pages denied without a named permission`);
    for (const { C, routes: group } of groups.values()) {
      await eliminate({
        entries, routes: group, candidates: C, widen, applyPermissions, log,
        probeAll: list => probeAll(list, probe, concurrency, probeOptions)
      });
    }
  }
  for (const entry of entries.values()) delete entry.needsSearch;
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

module.exports = { discoverRequirements, verifyCandidates, classify, isChromeApi, isSubset, union };
