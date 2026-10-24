/**
 * Datadog Smart Menu - Content Script
 *
 * Menu definitions come from shared/menu-definitions.js, loaded before this
 * file by the manifest.
 */

const { DATADOG_MENUS, ALL_MENU_IDS, mapPermissionsToMenus, findMenuForHref } = globalThis.DD_SMART_MENU;

const HIDDEN_CLASSES = ['dd-smart-menu-hidden', 'dd-smart-menu-collapsed'];
const NAV_ROOT_SELECTOR = 'nav, [class*="navbar_navbar"], [data-testid="sidebar"], .druids-sidebar';
// Datadog navbar containers: a top-level entry and a section inside its flyout.
const TOP_LEVEL_SELECTOR = '[class*="navbar-menu__list-item"]';
const SECTION_SELECTOR = '[class*="navbar-sub-menu__section"]';

let currentSettings = null;
let commandPaletteElement = null;
let detectedUserInfo = null;
let domObserver = null;
let paletteSelectedIndex = 0;

/**
 * Safe wrapper for chrome.runtime.sendMessage to handle invalid context gracefully
 */
function safeSendMessage(message, callback) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        if (callback) callback(response);
      });
    }
  } catch (e) {
    // Ignore context invalidation
  }
}

function isExtensionContextValid() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Initialize Content Script
(async function init() {
  console.log('[Datadog Smart Menu] Injected into Datadog page.');
  
  safeSendMessage({ action: 'GET_SETTINGS' }, async (settings) => {
    if (settings) {
      currentSettings = settings;

      if (currentSettings.autoDetectRights) {
        await fetchDatadogUserProfile();
      }

      applyMenuFilters();
      setupCommandPalette();
    }
  });

  if (isExtensionContextValid()) {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'APPLY_FILTERS' && message.settings) {
          currentSettings = message.settings;
          applyMenuFilters();
        }
      });
    } catch (e) {}
  }

  domObserver = new MutationObserver(debounce(() => {
    if (!isExtensionContextValid()) {
      if (domObserver) domObserver.disconnect();
      return;
    }
    if (currentSettings && currentSettings.enabled) {
      applyMenuFilters();
    }
  }, 250));

  domObserver.observe(document.body, { childList: true, subtree: true });
})();

/**
 * Fetch current Datadog user profile, roles & RBAC permissions via Datadog v2 API
 */
async function fetchDatadogUserProfile() {
  try {
    const res = await fetch('/api/v2/current_user', {
      headers: { 'Accept': 'application/json' },
      credentials: 'include'
    });

    if (res.ok) {
      const json = await res.json();
      const userAttr = json.data?.attributes || {};
      const email = userAttr.email || userAttr.handle || '';
      const name = userAttr.name || email.split('@')[0];

      // Extract included roles & permissions from API v2 response payload
      const included = json.included || [];
      const roles = included.filter(item => item.type === 'roles');
      const permissions = included.filter(item => item.type === 'permissions');

      const roleNames = roles.map(r => r.attributes?.name || '').filter(Boolean);
      const permNames = permissions.map(p => p.attributes?.name || '').filter(Boolean);

      console.log('[Datadog Smart Menu] Detected RBAC roles:', roleNames);
      console.log('[Datadog Smart Menu] Total RBAC permissions:', permNames.length);

      // Admin detection: org/user management rights or an admin role
      const isAdmin = permNames.includes('org_management') ||
                      permNames.includes('user_access_manage') ||
                      roleNames.some(r => r.toLowerCase().includes('admin'));

      // Map real RBAC permissions to allowed Datadog menu IDs
      const allowedFromPermissions = mapPermissionsToMenus(permNames);

      detectedUserInfo = {
        email,
        name,
        title: roleNames.length > 0 ? roleNames.join(', ') : (userAttr.title || 'Datadog User'),
        roles: roleNames,
        isAdmin,
        permissionsCount: permNames.length,
        allowedFromPermissions,
        source: 'API RBAC Datadog v2'
      };

      // Permission-based filtering is the source of truth for end-users.
      // If no permissions are returned, keep current settings untouched
      // (admin-configured profile or unfiltered default).
      if (currentSettings && currentSettings.autoDetectRights && permNames.length > 0 && allowedFromPermissions.length > 0) {
        currentSettings.activeProfile = 'custom';
        currentSettings.customMenus = allowedFromPermissions;
        safeSendMessage({ 
          action: 'SAVE_SETTINGS', 
          settings: currentSettings,
          detectedUserInfo 
        });
      }
      return;
    }
  } catch (err) {
    console.warn('[Datadog Smart Menu] Datadog API not accessible.', err);
  }

  // Fallback DOM inspection
  const userCardEl = document.querySelector('[data-testid="user-menu"], .druids-user-menu, [class*="user-menu"]');
  if (userCardEl) {
    const text = userCardEl.textContent || '';
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : 'Datadog User';

    detectedUserInfo = {
      email,
      name: email.split('@')[0],
      title: 'Session Datadog',
      source: 'DOM Datadog'
    };
  }
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Menus the current settings allow: either the permission-derived custom
 * list, or everything (unfiltered mode).
 */
function getAllowedMenus() {
  return currentSettings.activeProfile === 'custom'
    ? (currentSettings.customMenus || [])
    : ALL_MENU_IDS;
}

// Core Menu Filtering Logic

function setMenuVisibility(element, visible) {
  if (visible) {
    element.classList.remove(...HIDDEN_CLASSES);
    return;
  }
  const hideClass = currentSettings.collapseHiddenItems ? 'dd-smart-menu-collapsed' : 'dd-smart-menu-hidden';
  element.classList.add(hideClass);
  element.classList.remove(...HIDDEN_CLASSES.filter(c => c !== hideClass));
}

/**
 * Hide a container (section or top-level entry) when every Datadog link it
 * holds belongs to a menu the user cannot access. Links the extension does not
 * know about keep the container visible.
 */
function applyContainerVisibility(container, linkState) {
  const links = Array.from(container.querySelectorAll('a[href]')).filter(a => linkState.has(a) || isInternalLink(a));
  if (links.length === 0) return;
  const allHidden = links.every(a => linkState.get(a) === false);
  setMenuVisibility(container, !allHidden);
}

function isInternalLink(anchor) {
  const href = anchor.getAttribute('href') || '';
  return href.startsWith('/') && !href.startsWith('//');
}

function applyMenuFilters() {
  if (!isExtensionContextValid()) return;
  if (!currentSettings || !currentSettings.enabled) {
    showAllMenus();
    return;
  }

  const allowed = new Set(getAllowedMenus());
  const navRoots = document.querySelectorAll(NAV_ROOT_SELECTOR);
  if (navRoots.length === 0) return;

  const uniqueVisibleMenus = new Set();
  // anchor -> true (allowed) / false (not allowed); unknown links are absent.
  const linkState = new Map();

  navRoots.forEach((nav) => {
    nav.querySelectorAll('a[href]').forEach((anchor) => {
      if (!isInternalLink(anchor)) return;
      const menu = findMenuForHref(anchor.getAttribute('href'), window.location.origin);
      if (!menu) return;
      const isAllowed = allowed.has(menu.id);
      linkState.set(anchor, isAllowed);
      setMenuVisibility(anchor, isAllowed);
      if (isAllowed) uniqueVisibleMenus.add(menu.id);
    });

    nav.querySelectorAll(SECTION_SELECTOR).forEach(section => applyContainerVisibility(section, linkState));
    nav.querySelectorAll(TOP_LEVEL_SELECTOR).forEach(entry => applyContainerVisibility(entry, linkState));
  });

  const visibleCount = uniqueVisibleMenus.size > 0 ? uniqueVisibleMenus.size : allowed.size;

  safeSendMessage({
    action: 'UPDATE_BADGE_COUNT',
    visibleCount,
    detectedUserInfo
  });
}

function showAllMenus() {
  const elements = document.querySelectorAll('.dd-smart-menu-hidden, .dd-smart-menu-collapsed');
  elements.forEach((el) => {
    el.classList.remove('dd-smart-menu-hidden', 'dd-smart-menu-collapsed');
  });
}

/**
 * Setup Smart Menu Command Palette Shortcut (Only Ctrl+M or Cmd+M)
 */
function setupCommandPalette() {
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    // EXCLUSIVELY Ctrl+M / Cmd+M to avoid overriding Datadog native Ctrl+K
    if ((e.ctrlKey || e.metaKey) && key === 'm') {
      if (currentSettings && currentSettings.enableCommandPalette) {
        e.preventDefault();
        toggleCommandPalette();
      }
    } else if (e.key === 'Escape' && commandPaletteElement && commandPaletteElement.classList.contains('active')) {
      toggleCommandPalette(false);
    }
  });
}

function toggleCommandPalette(forceState) {
  if (!commandPaletteElement) {
    commandPaletteElement = document.createElement('div');
    commandPaletteElement.id = 'dd-smart-menu-palette-overlay';
    const huskyIconUrl = isExtensionContextValid() ? chrome.runtime.getURL('icons/icon48.png') : '';
    const badgeIconHtml = huskyIconUrl ? `<img src="${huskyIconUrl}" class="dd-palette-badge-icon" alt="Husky" />` : '🐺 ';

    commandPaletteElement.innerHTML = `
      <div class="dd-smart-menu-palette">
        <div class="dd-palette-header">
          <span class="dd-palette-search-icon">🔍</span>
          <input type="text" class="dd-palette-input" placeholder="Search a Datadog menu (e.g. APM, Logs, Dashboards)..." autofocus />
          <span class="dd-palette-badge">${badgeIconHtml} <span>Datadog Smart Menu (Ctrl+M)</span></span>
        </div>
        <div class="dd-palette-list" id="dd-palette-results"></div>
        <div class="dd-palette-footer">
          <span>Navigate with <span class="dd-palette-shortcut">↑</span> <span class="dd-palette-shortcut">↓</span> and confirm with <span class="dd-palette-shortcut">↵</span></span>
          <span>Close with <span class="dd-palette-shortcut">ESC</span></span>
        </div>
      </div>
    `;
    document.body.appendChild(commandPaletteElement);

    const input = commandPaletteElement.querySelector('.dd-palette-input');

    // Filter results as user types
    input.addEventListener('input', (e) => renderPaletteResults(e.target.value));

    // Full Keyboard Navigation (ArrowUp, ArrowDown, Enter, Escape)
    input.addEventListener('keydown', (e) => {
      const resultsContainer = document.getElementById('dd-palette-results');
      if (!resultsContainer) return;
      const items = resultsContainer.querySelectorAll('.dd-palette-item');
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteSelectedIndex = (paletteSelectedIndex + 1) % items.length;
        updatePaletteItemSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteSelectedIndex = (paletteSelectedIndex - 1 + items.length) % items.length;
        updatePaletteItemSelection(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[paletteSelectedIndex]) {
          items[paletteSelectedIndex].click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleCommandPalette(false);
      }
    });

    commandPaletteElement.addEventListener('click', (e) => {
      if (e.target === commandPaletteElement) toggleCommandPalette(false);
    });
  }

  const isActive = forceState !== undefined ? forceState : !commandPaletteElement.classList.contains('active');

  if (isActive) {
    commandPaletteElement.classList.add('active');
    renderPaletteResults('');
    setTimeout(() => {
      const input = commandPaletteElement.querySelector('.dd-palette-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    }, 50);
  } else {
    commandPaletteElement.classList.remove('active');
  }
}

/**
 * Update selected state & scroll focused item into view
 */
function updatePaletteItemSelection(items) {
  items.forEach((item, idx) => {
    if (idx === paletteSelectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function renderPaletteResults(query) {
  const container = document.getElementById('dd-palette-results');
  if (!container) return;

  paletteSelectedIndex = 0; // Reset active selection index

  const allowedList = getAllowedMenus();

  const filterText = query.toLowerCase().trim();

  const filtered = DATADOG_MENUS.filter(menu => {
    const matchesQuery = menu.name.toLowerCase().includes(filterText) || 
                         menu.keywords.some(k => k.includes(filterText));
    const isAllowed = allowedList.includes(menu.id);
    return matchesQuery && isAllowed;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #9CA3AF; font-size: 14px;">
        No matching menu found for your current permissions.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((menu, index) => `
    <div class="dd-palette-item ${index === 0 ? 'selected' : ''}" data-id="${menu.id}">
      <span class="dd-palette-item-icon">${menu.icon}</span>
      <div class="dd-palette-item-text">
        <div class="dd-palette-item-title">${menu.name}</div>
        <div class="dd-palette-item-category">${menu.category}</div>
      </div>
      <span style="font-size: 12px; color: #A78BFA;">Open ↵</span>
    </div>
  `).join('');

  container.querySelectorAll('.dd-palette-item').forEach((item, index) => {
    item.addEventListener('mouseenter', () => {
      paletteSelectedIndex = index;
      updatePaletteItemSelection(container.querySelectorAll('.dd-palette-item'));
    });

    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      const targetMenu = DATADOG_MENUS.find(m => m.id === id);
      if (targetMenu) {
        toggleCommandPalette(false);
        window.location.href = `${window.location.origin}${targetMenu.paths[0]}`;
      }
    });
  });
}
