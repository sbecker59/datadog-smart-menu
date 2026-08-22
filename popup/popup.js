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

function showFeedback(message, isError = false) {
  const el = document.getElementById('admin-feedback');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
}

function updateUI() {
  document.getElementById('master-toggle').checked = currentSettings.enabled;
  document.getElementById('toggle-palette').checked = currentSettings.enableCommandPalette;
  document.getElementById('toggle-collapse').checked = currentSettings.collapseHiddenItems;
  document.getElementById('toggle-auto-detect').checked = currentSettings.autoDetectRights;

  const profileLabel = currentSettings.activeProfile === 'custom'
    ? 'Filtered by permissions'
    : 'Unfiltered';
  document.getElementById('detected-role-text').textContent = profileLabel;

  // User identity display
  const userEmailEl = document.getElementById('user-email-text');
  const sourceBadgeEl = document.getElementById('detection-source-badge');

  if (detectedUserInfo && detectedUserInfo.email) {
    userEmailEl.textContent = `${detectedUserInfo.email} (${detectedUserInfo.title || 'Datadog'})`;
    sourceBadgeEl.textContent = detectedUserInfo.source || 'Auto';
  } else {
    userEmailEl.textContent = 'Not connected to Datadog HQ';
    sourceBadgeEl.textContent = 'Manual';
  }

  // Configuration section is strictly reserved for identified admins
  const isAdmin = !!detectedUserInfo && detectedUserInfo.isAdmin === true;
  document.getElementById('admin-section').classList.toggle('hidden', !isAdmin);

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

  document.getElementById('toggle-auto-detect').addEventListener('change', (e) => {
    currentSettings.autoDetectRights = e.target.checked;
    saveSettings();
  });

  document.getElementById('btn-load-role').addEventListener('click', () => {
    const input = document.getElementById('role-name-input');
    const btn = document.getElementById('btn-load-role');
    const roleName = input.value.trim();
    if (!roleName) {
      showFeedback('Enter a Datadog role name first.', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    chrome.runtime.sendMessage({ action: 'FETCH_ROLE_MENUS', roleName }, (res) => {
      btn.disabled = false;
      btn.textContent = 'Load';

      if (chrome.runtime.lastError || !res || !res.ok) {
        showFeedback((res && res.error) || 'Failed to fetch role (open a Datadog tab first).', true);
        return;
      }

      // A manually loaded role IS the source of truth: disable session
      // auto-detection so it cannot overwrite this configuration on the
      // next Datadog page load. Re-enable "Auto permissions detection"
      // to switch back to permission auto mode.
      currentSettings.activeProfile = 'custom';
      currentSettings.customMenus = res.menus;
      currentSettings.autoDetectRights = false;
      saveSettings();
      showFeedback(`Applied "${res.roleName}": ${res.menus.length} menus. Auto-detection disabled.`);
    });
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset the extension to its default configuration?')) return;
    currentSettings = { ...DEFAULT_SETTINGS };
    saveSettings();
    showFeedback('Configuration reset to defaults.');
  });
}
