#!/usr/bin/env node
/**
 * Capture the Datadog navbar as rendered for a test account and write it to
 * test/fixtures/datadog-nav-links.json (used by the unit and e2e tests).
 *
 * Live, with a saved session (recommended: avoids reCAPTCHA, works with SSO/2FA):
 *   1. node scripts/capture-navbar.js --login --save-state .auth/datadog.json
 *      Opens a browser: log in by hand; the session is saved once the navbar shows.
 *   2. node scripts/capture-navbar.js --state .auth/datadog.json
 *      (or DD_STORAGE_STATE_B64=<base64 of that file>, as used in CI)
 *
 * Live, with the login form (may hit reCAPTCHA from CI runners):
 *   DD_TEST_USERNAME=... DD_TEST_PASSWORD=... node scripts/capture-navbar.js
 *   Optional: DD_TEST_TOTP_SECRET (base32) if the account uses an authenticator app.
 *
 * DD_SITE selects the Datadog site, as a site name (datadoghq.eu, us3.datadoghq.com)
 * or an app URL (https://app.datadoghq.eu). Default: datadoghq.eu.
 *
 * Offline (from a page saved with "Save page as..."):
 *   node scripts/capture-navbar.js --from-html datadog.html
 *
 * Options: --out <file> (default: the fixture), --headed (show the browser).
 * Personal data (user e-mail, organization name, org UUID links) is removed.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const rootDir = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(rootDir, 'test/fixtures/datadog-nav-links.json');
// Fewer links than this means the login or the navbar layout changed:
// refuse to overwrite the fixture with a partial capture.
const MIN_LINKS = 100;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i];
  }
  return args;
}

/**
 * Datadog app URL from DD_SITE. Accepts the standard Datadog site names
 * ("datadoghq.eu", "us3.datadoghq.com", "ddog-gov.com") or a full URL.
 */
function siteUrl(site) {
  const value = (site || 'datadoghq.eu').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  const host = value.toLowerCase();
  // Root domains are served from "app."; regional sites (us3., ap1., ...) as is.
  const isRoot = ['datadoghq.com', 'datadoghq.eu', 'ddog-gov.com'].includes(host);
  return `https://${isRoot ? 'app.' + host : host}`;
}

/** RFC 6238 TOTP code (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/[\s=-]/g, '').toUpperCase()) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error('DD_TEST_TOTP_SECRET is not valid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, '0');
}

/**
 * Runs in the page: read every navbar entry, its flyout sections and links.
 */
function readNavbar() {
  const clean = (el) => {
    if (!el) return '';
    const copy = el.cloneNode(true);
    // Drop "new" / "preview" badges and docs links rendered inside labels.
    copy.querySelectorAll('[class*="status"], [class*="badge"], [class*="title-link-icon"]').forEach(n => n.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  return Array.from(document.querySelectorAll('[class*="navbar-menu__list-item"]')).map((entry) => {
    // Walk section titles and flyout links in document order: each link takes
    // the last title seen. Works whether or not sections have a container.
    let nodes = entry.querySelectorAll('[class*="is-section-title"], a[class*="navbar-sub-menu-item__label"]');
    // Entries without a flyout (e.g. Cloud Cost) only have their own link.
    if (nodes.length === 0) nodes = entry.querySelectorAll('a[href]');
    const items = [];
    let section = null;
    nodes.forEach((node) => {
      if (node.matches('[class*="is-section-title"]')) {
        section = clean(node).replace(/\s*Docs$/, '');
        return;
      }
      if (!node.closest('[class*="is-section-title"]') || node.matches('a[class*="navbar-sub-menu-item__label"]')) {
        items.push({ section, label: clean(node.querySelector('[class*="sub-menu-item__text"]') || node), href: node.getAttribute('href') });
      }
    });
    return { menu: clean(entry.querySelector('[class*="navbar-menu-item__label__text"]')), items };
  });
}

/** Keep internal links only and strip personal data. */
function sanitize(entries) {
  const links = [];
  for (const entry of entries) {
    // The user menu label is the user's e-mail / organization name.
    const isUserMenu = entry.items.some(i => i.href === '/personal-settings');
    const menu = isUserMenu ? 'User menu' : entry.menu;
    let currentSection = null;
    for (const item of entry.items) {
      const href = (item.href || '').replace(/#.*$/, '');
      if (!href.startsWith('/') || href.startsWith('//') || /orgUuid=/i.test(href)) continue;
      let section = item.section || null;
      if (isUserMenu) {
        // Section titles there embed the e-mail / org name: use the first link label.
        if (section !== currentSection?.raw) currentSection = { raw: section, label: item.label };
        section = currentSection.label;
      }
      links.push({ menu, section, label: item.label, href });
    }
  }
  return links;
}

async function login(page, site) {
  const username = process.env.DD_TEST_USERNAME;
  const password = process.env.DD_TEST_PASSWORD;
  if (!username || !password) throw new Error('Set DD_TEST_USERNAME and DD_TEST_PASSWORD (or use --from-html).');

  await page.goto(`${site}/account/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL(url => !url.pathname.startsWith('/account/login'), { timeout: 30000 }).catch(() => {}),
    page.getByRole('button', { name: /^log in$/i }).click()
  ]);

  // Optional second factor (authenticator app).
  const codeInput = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i]').first();
  if (await codeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (!process.env.DD_TEST_TOTP_SECRET) throw new Error('The account asks for a 2FA code: set DD_TEST_TOTP_SECRET.');
    await codeInput.fill(totp(process.env.DD_TEST_TOTP_SECRET));
    await codeInput.press('Enter');
    await page.waitForURL(url => !url.pathname.startsWith('/account'), { timeout: 30000 });
  }

  const pathname = new URL(page.url()).pathname;
  if (pathname.includes('recaptcha')) {
    throw new Error('Datadog asked for a reCAPTCHA: use a saved session instead (--login --save-state, then DD_STORAGE_STATE_B64).');
  }
  if (pathname.startsWith('/account/login')) {
    throw new Error(`Login failed (still on ${pathname}). Check the credentials, SSO or 2FA settings.`);
  }
}

/** Playwright storage state from --state <file> or DD_STORAGE_STATE_B64. */
function loadStorageState(args) {
  if (typeof args.state === 'string') return JSON.parse(fs.readFileSync(args.state, 'utf8'));
  if (process.env.DD_STORAGE_STATE_B64) return JSON.parse(Buffer.from(process.env.DD_STORAGE_STATE_B64, 'base64').toString('utf8'));
  return null;
}

/** Manual login in a visible browser, then save the session for later runs. */
async function saveSession(args) {
  const site = siteUrl(process.env.DD_SITE);
  const out = typeof args['save-state'] === 'string' ? args['save-state'] : '.auth/datadog.json';
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${site}/account/login`);
    console.log('Log in to Datadog in the opened browser (5 minutes max)...');
    await page.waitForSelector('[class*="navbar-menu__list-item"]', { timeout: 5 * 60 * 1000 });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await context.storageState({ path: out });
    fs.chmodSync(out, 0o600);
    console.log(`Session saved to ${out}. Keep it secret: it grants access to the account.`);
    console.log(`For CI: base64 -w0 ${out}  -> GitHub secret DD_STORAGE_STATE_B64`);
  } finally {
    await browser.close();
  }
}

async function captureLive(args) {
  const site = siteUrl(process.env.DD_SITE);
  const browser = await chromium.launch({ headless: !args.headed });
  try {
    const storageState = loadStorageState(args);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...(storageState ? { storageState } : {}) });
    const page = await context.newPage();
    if (!storageState) await login(page, site);
    await page.goto(`${site}/dashboard/lists`, { waitUntil: 'domcontentloaded' });
    if (storageState && new URL(page.url()).pathname.startsWith('/account')) {
      throw new Error('The saved Datadog session has expired: refresh it with --login --save-state.');
    }
    await page.waitForSelector('[class*="navbar-menu__list-item"]', { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Flyouts may only render on hover: hover entries that have no section yet.
    const entries = page.locator('[class*="navbar-menu__list-item"]');
    const count = await entries.count();
    for (let i = 0; i < count; i++) {
      const entry = entries.nth(i);
      if (await entry.locator('[class*="navbar-sub-menu__section"]').count() === 0) {
        await entry.hover().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    return await page.evaluate(readNavbar);
  } finally {
    await browser.close();
  }
}

async function captureFromHtml(file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Offline: only the saved file loads, Datadog's scripts stay blocked.
    await page.route('**/*', route => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    await page.goto('file://' + path.resolve(file));
    return await page.evaluate(readNavbar);
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.login) return saveSession(args);
  const entries = args['from-html'] ? await captureFromHtml(args['from-html']) : await captureLive(args);
  const links = sanitize(entries);

  if (links.length < MIN_LINKS) {
    throw new Error(`Only ${links.length} navbar links captured (expected at least ${MIN_LINKS}); fixture left unchanged.`);
  }

  if (/@/.test(JSON.stringify(links))) {
    throw new Error('Personal data (an e-mail address) is still present in the capture; fixture left unchanged.');
  }

  const out = args.out || DEFAULT_OUT;
  fs.writeFileSync(out, JSON.stringify(links, null, 1) + '\n');
  const menus = new Set(links.map(l => l.menu));
  console.log(`Captured ${links.length} links in ${menus.size} navbar entries -> ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { totp, sanitize, siteUrl };
