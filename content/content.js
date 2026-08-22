/**
 * Datadog Smart Menu - Content Script
 */

const DATADOG_MENUS = [
  { id: 'dashboards', name: 'Dashboards', icon: '📊', selector: 'dashboards, /dashboard, /dash', keywords: ['dashboard', 'overview', 'chart', 'widget'], category: 'Core' },
  { id: 'infrastructure', name: 'Infrastructure', icon: '🖥️', selector: 'infrastructure, /infrastructure, /host', keywords: ['host', 'container', 'k8s', 'kubernetes', 'serverless', 'process'], category: 'Core' },
  { id: 'monitors', name: 'Monitors & Alerts', icon: '🔔', selector: 'monitors, /monitors, /watchdog', keywords: ['alert', 'watchdog', 'downtime', 'slo'], category: 'Core' },
  { id: 'error_tracking', name: 'Error Tracking', icon: '🐛', selector: 'error tracking, /error-tracking', keywords: ['error tracking'], category: 'Telemetry' },
  { id: 'observability_pipelines', name: 'Observability Pipelines', icon: '🛠️', selector: 'observability pipelines, /observability-pipelines', keywords: ['observability pipelines'], category: 'Telemetry' },
  { id: 'logs_archives', name: 'Log Archives', icon: '🗄️', selector: 'logs archives, /logs/archives, /archives', keywords: ['archive'], category: 'Telemetry' },
  { id: 'apm', name: 'APM & Tracing', icon: '⚡', selector: 'apm, /apm, /services', keywords: ['service', 'trace', 'catalog', 'profiling', 'error'], category: 'Telemetry' },
  { id: 'logs', name: 'Logs', icon: '📝', selector: 'logs, /logs', keywords: ['log', 'pattern', 'pipeline', 'analytics'], category: 'Telemetry' },
  { id: 'metrics', name: 'Metrics', icon: '📈', selector: 'metrics, /metric', keywords: ['explorer', 'summary', 'custom metric'], category: 'Telemetry' },
  { id: 'ux_monitoring', name: 'Digital Experience (UX / RUM)', icon: '👥', selector: 'ux_monitoring, /rum, /synthetics', keywords: ['rum', 'synthetics', 'session', 'replay', 'product'], category: 'Experience' },
  { id: 'security', name: 'Security & Compliance', icon: '🛡️', selector: 'security, /security, /appsec', keywords: ['security', 'appsec', 'audit', 'csm', 'threat', 'vulnerability'], category: 'Security' },
  { id: 'network', name: 'Network', icon: '🌐', selector: 'network, /network', keywords: ['npm', 'network', 'dns', 'device'], category: 'Telemetry' },
  { id: 'automation', name: 'Automation', icon: '🤖', selector: 'automation, /workflow-automation, /automations', keywords: ['automation', 'app builder', 'workflow automation'], category: 'Operations' },
  { id: 'bits_ai', name: 'Bits AI', icon: '✨', selector: 'bits assistant, bits ai, /bits', keywords: ['bits assistant', 'bits ai', 'bits chat'], category: 'Operations' },
  { id: 'ci_visibility', name: 'CI Visibility', icon: '🧪', selector: 'ci visibility, /ci', keywords: ['ci visibility', 'test optimization'], category: 'Operations' },
  { id: 'llm_observability', name: 'LLM Observability', icon: '🧠', selector: 'llm observability, /llm-observability, /llmobs', keywords: ['llm observability'], category: 'Telemetry' },
  { id: 'incidents', name: 'Service Mgmt & Incidents', icon: '🚨', selector: 'incidents, /incidents, /on-call', keywords: ['incident', 'on-call', 'change', 'workflow'], category: 'Operations' },
  { id: 'notebooks', name: 'Notebooks', icon: '📓', selector: 'notebooks, /notebook', keywords: ['note', 'postmortem', 'runbook'], category: 'Operations' },
  { id: 'cost_management', name: 'Cloud Cost Mgmt (FinOps)', icon: '💰', selector: 'cost_management, /cost, /billing', keywords: ['finops', 'billing', 'cost', 'usage', 'budget'], category: 'Business' },
  { id: 'integrations', name: 'Integrations', icon: '🔌', selector: 'integrations, /account/settings', keywords: ['integrations', 'api', 'plugin', 'aws configurations', 'gcp', 'azure', 'agent'], category: 'Admin' },
  { id: 'organization_settings', name: 'Organization Settings', icon: '⚙️', selector: 'organization_settings, /organization-settings', keywords: ['user', 'role', 'permission', 'team'], category: 'Admin' }
];

const ALL_MENU_IDS = DATADOG_MENUS.map(m => m.id);

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

/**
 * Ordered permission-to-menu mapping, most specific rules first.
 * Source: https://docs.datadoghq.com/account_management/rbac/permissions/
 */
const PERMISSION_MENU_MAP = [
  ['logs_archives', ['logs_read_archives', 'logs_write_archives', 'logs_write_archive_search']],
  ['observability_pipelines', ['observability_pipeline']],
  ['error_tracking', ['error_tracking']],
  ['llm_observability', ['llm_observability']],
  ['ci_visibility', ['ci_visibility', 'test_optimization', 'ci_provider', 'ci_ingestion', 'cd_visibility', 'code_analysis', 'code_coverage', 'dora_', 'quality_gates', 'static_analysis']],
  ['bits_ai', ['assistant_access', 'bits_investigations', 'bits_dev_']],
  ['security', ['bits_security', 'security_', 'appsec_', 'ai_guard', 'data_scanner', 'audit_logs_']],
  ['automation', ['workflows_', 'workflow_automation', 'apps_', 'agent_builder', 'actions_interface', 'connections_', 'execution_groups', 'on_prem_runner', 'app_builder', 'mcp_']],
  ['incidents', ['incident_', 'cases_', 'on_call_', 'status_pages']],
  ['ux_monitoring', ['rum_', 'synthetics_', 'product_analytics', 'audience_management', 'dem_journey', 'feature_flag']],
  ['cost_management', ['cloud_cost_management', 'ccm_', 'billing_', 'usage_']],
  ['integrations', ['integrations', 'aws_configuration', 'azure_configuration', 'gcp_configuration', 'oci_configuration', 'api_keys', 'client_tokens', 'org_app_keys', 'user_app_keys', 'repo_info', 'repo_settings']],
  ['organization_settings', ['org_management', 'org_group', 'org_connections', 'user_access', 'service_account', 'teams_manage', 'governance_console', 'workload_identity', 'coterm']],
  ['infrastructure', ['infrastructure_', 'guardrails', 'agent_upgrade', 'agent_flare', 'fleet_policies', 'orchestration_', 'terraform_state', 'process_tags', 'processes_generate', 'containers_generate', 'disaster_recovery', 'serverless_']],
  ['apm', ['apm_', 'continuous_profiler', 'debugger_', 'live_debugger', 'dbm_', 'data_streams_']],
  ['monitors', ['monitors_', 'monitor_config', 'slos_', 'watchdog']],
  ['network', ['network_connections', 'network_health', 'ndm_']],
  ['logs', ['logs_', 'telemetry_rules', 'events_write', 'event_correlation', 'generate_log_reports', 'manage_log_reports', 'saved_views', 'facets_']],
  ['metrics', ['metric_tags', 'metrics_metadata', 'host_tags', 'reference_tables', 'ddsql_editor']],
  ['notebooks', ['notebooks']],
  ['dashboards', ['dashboards_', 'embeddable_graphs', 'product_dashboards']]
];

/**
 * Map list of technical permission names to accessible Datadog menu IDs
 */
function mapPermissionsToMenus(permNames) {
  const menus = new Set();
  menus.add('dashboards'); // Dashboards basic access

  permNames.forEach(p => {
    for (const [menuId, tokens] of PERMISSION_MENU_MAP) {
      if (tokens.some(token => p.includes(token))) {
        menus.add(menuId);
        break;
      }
    }
  });

  return Array.from(menus);
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
function applyMenuFilters() {
  if (!isExtensionContextValid()) return;
  if (!currentSettings || !currentSettings.enabled) {
    showAllMenus();
    return;
  }

  const allowedList = getAllowedMenus();

  const navContainers = document.querySelectorAll('nav, [data-testid="sidebar"], .druids-sidebar, [class*="sidebar"]');
  if (!navContainers || navContainers.length === 0) return;

  const uniqueVisibleMenus = new Set();

  navContainers.forEach((nav) => {
    const menuItems = nav.querySelectorAll('a, button, [role="link"], [data-dd-action-name]');
    
    menuItems.forEach((item) => {
      const text = (item.textContent || '').toLowerCase();
      const href = (item.getAttribute('href') || '').toLowerCase();
      const actionName = (item.getAttribute('data-dd-action-name') || '').toLowerCase();

      const matchedMenu = DATADOG_MENUS.find(m => {
        const selParts = m.selector.split(',').map(s => s.trim().toLowerCase());
        return selParts.some(part => actionName.includes(part) || href.includes(part)) ||
               m.keywords.some(kw => text.includes(kw));
      });

      if (matchedMenu) {
        const isAllowed = allowedList.includes(matchedMenu.id);

        if (isAllowed) {
          item.classList.remove('dd-smart-menu-hidden', 'dd-smart-menu-collapsed');
          uniqueVisibleMenus.add(matchedMenu.id);
        } else {
          if (currentSettings.collapseHiddenItems) {
            item.classList.add('dd-smart-menu-collapsed');
            item.classList.remove('dd-smart-menu-hidden');
          } else {
            item.classList.add('dd-smart-menu-hidden');
            item.classList.remove('dd-smart-menu-collapsed');
          }
        }
      }
    });
  });

  const visibleCount = uniqueVisibleMenus.size > 0 ? uniqueVisibleMenus.size : allowedList.length;

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
        const pageLink = document.querySelector(`a[href*="${id}"], [data-dd-action-name*="${id}"]`);
        if (pageLink && pageLink.href) {
          window.location.href = pageLink.href;
        } else {
          window.location.href = `${window.location.origin}/${id}`;
        }
      }
    });
  });
}
