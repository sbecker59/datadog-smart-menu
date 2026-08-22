/**
 * Datadog Smart Menu - Extension Popup Controller
 */

import { DATADOG_MENUS, DEFAULT_SETTINGS } from '../shared/profiles.js';

let currentSettings = { ...DEFAULT_SETTINGS };
let detectedUserInfo = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  attachEventListeners();
});

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings', 'detectedUserInfo'], (result) => {
      if (result.settings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...result.settings };
      }
      if (result.detectedUserInfo) {
        detectedUserInfo = result.detectedUserInfo;
      }
      updateUI();
      resolve();
    });
  });
}

function saveSettings() {
  chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: currentSettings }, () => {
    updateUI();
  });
}

function updateUI() {
  document.getElementById('master-toggle').checked = currentSettings.enabled;
  document.getElementById('toggle-palette').checked = currentSettings.enableCommandPalette;
  document.getElementById('toggle-collapse').checked = currentSettings.collapseHiddenItems;

  const profileLabel = currentSettings.activeProfile === 'custom'
    ? 'Filtered by permissions'
    : 'Unfiltered';
  document.getElementById('detected-role-text').textContent = profileLabel;

  // User identity display
  const userEmailEl = document.getElementById('user-email-text');
  const sourceBadgeEl = document.getElementById('detection-source-badge');

  if (detectedUserInfo && detectedUserInfo.email) {
    if (userEmailEl) userEmailEl.textContent = `${detectedUserInfo.email} (${detectedUserInfo.title || 'Datadog'})`;
    if (sourceBadgeEl) sourceBadgeEl.textContent = detectedUserInfo.source || 'Auto';
  } else {
    if (userEmailEl) userEmailEl.textContent = 'Not connected to Datadog HQ';
    if (sourceBadgeEl) sourceBadgeEl.textContent = 'Manual';
  }

  // Settings entry point is reserved for identified admins
  const isAdmin = !!detectedUserInfo && detectedUserInfo.isAdmin === true;
  document.getElementById('btn-open-options').style.display = isAdmin ? '' : 'none';

  const visibleCount = currentSettings.activeProfile === 'custom'
    ? (currentSettings.customMenus || []).length
    : DATADOG_MENUS.length;
  const hiddenCount = DATADOG_MENUS.length - visibleCount;

  document.getElementById('visible-count-num').textContent = `${visibleCount}`;
  document.getElementById('hidden-count-num').textContent = `${hiddenCount}`;
}

function attachEventListeners() {
  document.getElementById('master-toggle').addEventListener('change', (e) => {
    currentSettings.enabled = e.target.checked;
    saveSettings();
  });

  document.getElementById('toggle-palette').addEventListener('change', (e) => {
    currentSettings.enableCommandPalette = e.target.checked;
    saveSettings();
  });

  document.getElementById('toggle-collapse').addEventListener('change', (e) => {
    currentSettings.collapseHiddenItems = e.target.checked;
    saveSettings();
  });

  document.getElementById('btn-open-options').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
}
