/**
 * Datadog Smart Menu - Background Service Worker (Manifest V3)
 */

import { DEFAULT_SETTINGS, ROLE_PROFILES } from '../shared/profiles.js';

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

  const profile = ROLE_PROFILES[settings.activeProfile] || ROLE_PROFILES.dev;
  const count = profile.id === 'custom' 
    ? settings.customMenus.length 
    : profile.allowedMenus.length;

  chrome.action.setBadgeText({ text: `${count}` });
  chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
}

// Listen for settings changes from popup/options or content script
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
      chrome.tabs.query({ url: ['*://*.datadoghq.com/*', '*://*.datadoghq.eu/*', '*://*.us3.datadoghq.com/*', '*://*.us5.datadoghq.com/*'] }, (tabs) => {
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
});
