#!/usr/bin/env node
/**
 * Preview which Datadog navbar entries the extension keeps for a set of
 * permissions, by running the real content script with Playwright against a
 * saved Datadog page (File > Save page as... while the navbar is rendered).
 *
 * Usage:
 *   node scripts/preview-menu.js --html datadog.html --role "Datadog Read Only Role"
 *   node scripts/preview-menu.js --html datadog.html --perms logs_read_data,dashboards_read
 *   add --screenshot out.png to capture the navbar
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const rootDir = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.html) throw new Error('Missing --html <saved Datadog page>');

  let permissions;
  if (args.perms) {
    permissions = args.perms.split(',').map(p => p.trim()).filter(Boolean);
  } else {
    const roleName = args.role || 'Datadog Read Only Role';
    const { roles } = require(path.join(rootDir, 'test/fixtures/datadog-permissions.json'));
    permissions = roles[roleName];
    if (!permissions) throw new Error(`Unknown role "${roleName}". Known: ${Object.keys(roles).join(', ')}`);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // Offline: only the saved file loads, Datadog's own scripts stay blocked.
  await page.route('**/*', route => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  page.on('console', m => args.debug && console.log('[console]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.resolve(args.html));

  // Clear classes left by a previous extension run when the page was saved.
  await page.evaluate(() => document.querySelectorAll('.dd-smart-menu-hidden, .dd-smart-menu-collapsed')
    .forEach(el => el.classList.remove('dd-smart-menu-hidden', 'dd-smart-menu-collapsed')));

  await page.addScriptTag({ path: path.join(rootDir, 'shared/menu-definitions.js') });
  const allowedMenus = await page.evaluate(perms => globalThis.DD_SMART_MENU.mapPermissionsToMenus(perms), permissions);
  const settings = {
    enabled: true, activeProfile: 'custom', customMenus: allowedMenus,
    autoDetectRights: false, enableCommandPalette: false, collapseHiddenItems: false
  };
  await page.evaluate((s) => {
    window.chrome = {
      runtime: {
        id: 'preview', lastError: null, getURL: p => p,
        sendMessage: (msg, cb) => cb && cb(msg.action === 'GET_SETTINGS' ? s : undefined),
        onMessage: { addListener() {} }
      }
    };
  }, settings);
  await page.addStyleTag({ path: path.join(rootDir, 'content/content.css') });
  await page.addScriptTag({ path: path.join(rootDir, 'content/content.js') });
  await page.waitForTimeout(300);

  const report = await page.evaluate(() => {
    const hidden = el => !!el.closest('.dd-smart-menu-hidden');
    const clean = t => (t || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[class*="navbar-menu__list-item"]')).map(entry => ({
      menu: clean(entry.querySelector('[class*="navbar-menu-item__label__text"]')?.textContent),
      hidden: hidden(entry),
      links: Array.from(entry.querySelectorAll('a[href^="/"]')).map(a => ({
        label: clean(a.querySelector('[class*="sub-menu-item__text"]')?.textContent || a.textContent),
        href: a.getAttribute('href'),
        hidden: hidden(a)
      }))
    }));
  });

  console.log(`Permissions: ${permissions.length}  ->  menus allowed: ${allowedMenus.length}\n`);
  for (const entry of report) {
    const name = entry.menu.includes('@') ? 'User menu' : entry.menu;
    const shown = entry.links.filter(l => !l.hidden).length;
    console.log(`${entry.hidden ? '✗' : '✓'} ${name}  (${shown}/${entry.links.length} links visible)`);
    if (!entry.hidden && args.verbose) {
      entry.links.filter(l => l.hidden).forEach(l => console.log(`     hidden: ${l.label} ${l.href}`));
    }
  }

  if (args.screenshot) {
    await page.screenshot({ path: args.screenshot, fullPage: false });
    console.log(`\nScreenshot: ${args.screenshot}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
