/**
 * Build a minimal Datadog-like page from test/fixtures/datadog-nav-links.json.
 *
 * It keeps the navbar class names the content script relies on (top-level
 * entries, flyout sections, links) so the real extension can run against it
 * without a Datadog account. The "User menu" links are rendered like Datadog's
 * account popover: outside the sidebar, under the top bar avatar.
 */
const navLinks = require('../fixtures/datadog-nav-links.json');

const P = 'single-page-app_navbar_';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNavbarHtml(links = navLinks) {
  const menus = new Map();
  for (const link of links) {
    if (!menus.has(link.menu)) menus.set(link.menu, new Map());
    const sections = menus.get(link.menu);
    const sectionName = link.section || link.menu;
    if (!sections.has(sectionName)) sections.set(sectionName, []);
    sections.get(sectionName).push(link);
  }

  const accountLinks = menus.get('User menu') ? Array.from(menus.get('User menu').values()).flat() : [];
  menus.delete('User menu');

  const entries = Array.from(menus, ([menu, sections]) => {
    const sectionHtml = Array.from(sections, ([section, items]) => `
        <div class="${P}navbar-sub-menu__section" data-section="${escapeHtml(section)}">
          ${items.map(item => `
          <a class="${P}navbar-sub-menu-item__label ${P}navbar-sub-menu__item" href="${escapeHtml(item.href)}">
            <span class="${P}navbar-sub-menu-item__text">${escapeHtml(item.label)}</span>
          </a>`).join('')}
        </div>`).join('');
    return `
    <li class="${P}navbar-menu__list-item" data-menu="${escapeHtml(menu)}">
      <span class="${P}navbar-menu-item__label__text">${escapeHtml(menu)}</span>
      <div class="${P}navbar-sub-menu__content">${sectionHtml}
      </div>
    </li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Datadog navbar fixture</title></head>
<body>
  <nav class="${P}navbar">
    <ul>${entries}
    </ul>
  </nav>
  <div class="${P}top-bar-avatar-popover" data-menu="User menu">
    ${accountLinks.map(item => `
    <a class="${P}top-bar-avatar-popover-link ${P}top-bar-avatar-popover-menu-item" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}
  </div>
  <main>Fixture page</main>
</body>
</html>`;
}

module.exports = { buildNavbarHtml, navLinks };
