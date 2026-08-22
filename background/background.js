/**
 * Datadog Smart Menu - Background Service Worker (Manifest V3)
 */

import { DEFAULT_SETTINGS, DATADOG_MENUS, mapPermissionsToMenus } from '../shared/profiles.js';

const DATADOG_TAB_PATTERNS = [
  '*://*.datadoghq.com/*',
  '*://*.datadoghq.eu/*',
  '*://*.ddog-gov.com/*'
];

// Initialize extension settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get('settings');
  if (!existing.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    console.log('[Datadog Smart Menu] Extension initialized with default settings.');
  }
  updateBadge(DEFAULT_SETTINGS);
});

// Update badge count or state
function updateBadge(settings) {
  if (!settings.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#6B7280' });
    return;
  }

  const count = settings.activeProfile === 'custom'
    ? (settings.customMenus || []).length
    : DATADOG_MENUS.length;

  chrome.action.setBadgeText({ text: `${count}` });
  chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
}

// Listen for settings changes from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_SETTINGS') {
    chrome.storage.sync.get('settings', (result) => {
      sendResponse(result.settings || DEFAULT_SETTINGS);
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'SAVE_SETTINGS') {
    const dataToSave = { settings: request.settings };
    if (request.detectedUserInfo) {
      dataToSave.detectedUserInfo = request.detectedUserInfo;
    }

    chrome.storage.sync.set(dataToSave, () => {
      updateBadge(request.settings);
      
      // Notify active Datadog tabs to re-apply menu filters
      chrome.tabs.query({ url: DATADOG_TAB_PATTERNS }, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { action: 'APPLY_FILTERS', settings: request.settings }).catch(() => {
            // Tab might not have content script loaded yet
          });
        });
      });

      sendResponse({ status: 'success' });
    });
    return true;
  }

  if (request.action === 'UPDATE_BADGE_COUNT') {
    if (request.visibleCount !== undefined) {
      chrome.action.setBadgeText({ text: `${request.visibleCount}` });
      chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    }
    if (request.detectedUserInfo) {
      chrome.storage.sync.set({ detectedUserInfo: request.detectedUserInfo });
    }
  }

  if (request.action === 'FETCH_ROLE_MENUS') {
    handleFetchRoleMenus(request.roleName)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

/**
 * Fetch a Datadog role permissions by name and map them to menu IDs.
 * Uses the origin of an open Datadog tab so the session cookies apply.
 */
async function handleFetchRoleMenus(roleName) {
  const name = (roleName || '').trim();
  if (!name) throw new Error('Role name is required.');

  const tabs = await chrome.tabs.query({ url: DATADOG_TAB_PATTERNS });
  if (!tabs || tabs.length === 0) {
    throw new Error('Open a Datadog tab first, then try again.');
  }
  const origin = new URL(tabs[0].url).origin;
  const headers = { Accept: 'application/json' };

  const rolesRes = await fetch(`${origin}/api/v2/roles?page[size]=100`, { headers, credentials: 'include' });
  if (rolesRes.status === 401 || rolesRes.status === 403) {
    throw new Error('Not allowed to list Datadog roles with this session.');
  }
  if (!rolesRes.ok) throw new Error(`Datadog Roles API error (${rolesRes.status}).`);

  const rolesJson = await rolesRes.json();
  const wanted = name.toLowerCase();
  const role = (rolesJson.data || []).find(
    (r) => (r.attributes?.name || '').toLowerCase() === wanted
  );
  if (!role) throw new Error(`Role "${name}" not found in this organization.`);

  const permsRes = await fetch(`${origin}/api/v2/roles/${role.id}/permissions`, { headers, credentials: 'include' });
  if (!permsRes.ok) throw new Error(`Datadog Permissions API error (${permsRes.status}).`);

  const permsJson = await permsRes.json();
  const permNames = (permsJson.data || [])
    .map((p) => p.attributes?.name || '')
    .filter(Boolean);

  return {
    ok: true,
    roleName: role.attributes.name,
    menus: mapPermissionsToMenus(permNames),
    permissionsCount: permNames.length
  };
}
