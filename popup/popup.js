/**
 * Datadog Smart Menu - Extension Popup Controller
 */

import { DATADOG_MENUS, ROLE_PROFILES, DEFAULT_SETTINGS } from '../shared/profiles.js';

let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  renderProfiles();
  renderCustomChecklist();
  attachEventListeners();
});

let detectedUserInfo = null;

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

  const profile = ROLE_PROFILES[currentSettings.activeProfile] || ROLE_PROFILES.dev;
  document.getElementById('detected-role-text').textContent = `Active profile: ${profile.name.split(' (')[0]}`;

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

  const visibleCount = profile.id === 'custom' 
    ? currentSettings.customMenus.length 
    : profile.allowedMenus.length;
  
  const hiddenCount = DATADOG_MENUS.length - visibleCount;

  document.getElementById('visible-count-num').textContent = `${visibleCount}`;
  document.getElementById('hidden-count-num').textContent = `${hiddenCount}`;

  // Custom section visibility
  const customContainer = document.getElementById('custom-menus-container');
  if (currentSettings.activeProfile === 'custom') {
    customContainer.classList.remove('hidden');
  } else {
    customContainer.classList.add('hidden');
  }

  // Active state on profile cards
  document.querySelectorAll('.profile-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (id === currentSettings.activeProfile) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

function renderProfiles() {
  const container = document.getElementById('profiles-grid');
  if (!container) return;

  const profiles = Object.values(ROLE_PROFILES);
  container.innerHTML = profiles.map(p => `
    <div class="profile-card ${p.id === currentSettings.activeProfile ? 'active' : ''}" data-id="${p.id}" title="${p.description}">
      <span class="icon">${p.icon}</span>
      <span class="name">${p.name.split(' (')[0]}</span>
    </div>
  `).join('');

  container.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      currentSettings.activeProfile = id;
      saveSettings();
    });
  });
}

function renderCustomChecklist() {
  const container = document.getElementById('custom-checklist');
  if (!container) return;

  container.innerHTML = DATADOG_MENUS.map(m => {
    const isChecked = (currentSettings.customMenus || []).includes(m.id);
    return `
      <label class="custom-item">
        <input type="checkbox" data-id="${m.id}" ${isChecked ? 'checked' : ''}>
        <span>${m.icon} ${m.name}</span>
      </label>
    `;
  }).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.getAttribute('data-id');
      let custom = currentSettings.customMenus || [];
      if (chk.checked) {
        if (!custom.includes(id)) custom.push(id);
      } else {
        custom = custom.filter(x => x !== id);
      }
      currentSettings.customMenus = custom;
      saveSettings();
    });
  });
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
