/**
 * Datadog Smart Menu - Options Page Controller
 */

import { DATADOG_MENUS, ROLE_PROFILES, DEFAULT_SETTINGS } from '../shared/profiles.js';

let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  renderProfiles();
  renderMenuMatrix();
  attachEvents();
});

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('settings', (result) => {
      if (result.settings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...result.settings };
      }
      populateFormFields();
      resolve();
    });
  });
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

function renderProfiles() {
  const container = document.getElementById('profiles-detail-list');
  if (!container) return;

  const profiles = Object.values(ROLE_PROFILES);
  container.innerHTML = profiles.map(p => `
    <div class="profile-card-option ${p.id === currentSettings.activeProfile ? 'active' : ''}" data-id="${p.id}">
      <div class="header-row">
        <span class="icon">${p.icon}</span>
        <span class="title">${p.name}</span>
      </div>
      <p class="desc">${p.description}</p>
    </div>
  `).join('');

  container.querySelectorAll('.profile-card-option').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      currentSettings.activeProfile = id;
      renderProfiles();
      saveSettings();
    });
  });
}

function renderMenuMatrix() {
  const container = document.getElementById('menu-matrix-grid');
  if (!container) return;

  container.innerHTML = DATADOG_MENUS.map(m => {
    const isChecked = (currentSettings.customMenus || []).includes(m.id);
    return `
      <label class="matrix-item">
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
    });
  });
}

function attachEvents() {
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset to the default configuration?')) {
      currentSettings = { ...DEFAULT_SETTINGS };
      populateFormFields();
      renderProfiles();
      renderMenuMatrix();
      saveSettings();
    }
  });

  // Export JSON
  document.getElementById('btn-export').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentSettings, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "datadog-smart-menu-config.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Import JSON
  const fileInput = document.getElementById('file-import');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedSettings = JSON.parse(event.target.result);
        currentSettings = { ...DEFAULT_SETTINGS, ...importedSettings };
        populateFormFields();
        renderProfiles();
        renderMenuMatrix();
        saveSettings();
        showToast('Configuration imported successfully!');
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  });
}
