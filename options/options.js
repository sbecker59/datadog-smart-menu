/**
 * Datadog Smart Menu - Options Page Controller
 */

import { DATADOG_MENUS, DEFAULT_SETTINGS } from '../shared/profiles.js';

let currentSettings = { ...DEFAULT_SETTINGS };
let isAdmin = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  applyAdminGate();
  attachEvents();
});

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings', 'detectedUserInfo'], (result) => {
      if (result.settings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...result.settings };
      }
      isAdmin = !!result.detectedUserInfo && result.detectedUserInfo.isAdmin === true;
      populateFormFields();
      resolve();
    });
  });
}

/**
 * Advanced configuration (profiles, menu matrix, import/export) is admin-only.
 * End-users simply get fewer options, no message needed.
 */
function applyAdminGate() {
  if (isAdmin) return;

  const section = document.getElementById('profiles');
  if (section) section.classList.add('hidden');

  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('href') === '#profiles') {
      item.classList.add('hidden');
    }
  });

  const actions = document.querySelector('.top-bar .actions');
  if (actions) actions.classList.add('hidden');
}

function populateFormFields() {
  document.getElementById('opt-enabled').checked = currentSettings.enabled;
  document.getElementById('opt-auto-detect').checked = currentSettings.autoDetectRights;
  document.getElementById('opt-command-palette').checked = currentSettings.enableCommandPalette;
  document.getElementById('opt-collapse-hidden').checked = currentSettings.collapseHiddenItems;
}

function saveSettings() {
  // Collect state
  currentSettings.enabled = document.getElementById('opt-enabled').checked;
  currentSettings.autoDetectRights = document.getElementById('opt-auto-detect').checked;
  currentSettings.enableCommandPalette = document.getElementById('opt-command-palette').checked;
  currentSettings.collapseHiddenItems = document.getElementById('opt-collapse-hidden').checked;

  chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: currentSettings }, () => {
    showToast('Changes saved successfully!');
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast-notification');
  const msgEl = document.getElementById('toast-message');
  if (toast && msgEl) {
    msgEl.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }
}

function attachEvents() {
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset to the default configuration?')) {
      currentSettings = { ...DEFAULT_SETTINGS };
      populateFormFields();
      saveSettings();
    }
  });

  document.getElementById('btn-load-role').addEventListener('click', () => {
    const input = document.getElementById('role-name-input');
    const btn = document.getElementById('btn-load-role');
    const roleName = input.value.trim();
    if (!roleName) {
      showToast('Enter a Datadog role name first.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Loading…';
    chrome.runtime.sendMessage({ action: 'FETCH_ROLE_MENUS', roleName }, (res) => {
      btn.disabled = false;
      btn.textContent = 'Load permissions';

      if (chrome.runtime.lastError || !res || !res.ok) {
        showToast((res && res.error) || 'Failed to fetch role (open a Datadog tab first).');
        return;
      }

      currentSettings.activeProfile = 'custom';
      currentSettings.customMenus = res.menus;
      saveSettings();
      showToast(`Applied "${res.roleName}": ${res.menus.length} menus, ${res.permissionsCount} permissions.`);
    });
  });
}
